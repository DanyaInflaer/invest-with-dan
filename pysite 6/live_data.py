"""Автоматическое получение данных из открытых источников.

Что обновляется само:
  * курсы доллара, евро и юаня (Банк России, XML_daily);
  * ключевая ставка и её история (Банк России, веб-сервис DailyInfo, запасной вариант: страница cbr.ru);
  * индексы МосБиржи и РТС (Московская биржа, ISS API).

Остальные показатели (инфляция, зарплаты, безработица, бедность, инвестиции, регионы, ставки по вкладам
и ипотеке) публикуют Росстат и Минэкономразвития без удобного открытого API. Они лежат в app.py и
меняются вручную.

Как это работает:
  * get_live() сразу возвращает последние известные значения (из памяти или файла data/cache.json);
  * если данные старше CACHE_TTL, в фоне запускается обновление, страница при этом не ждёт;
  * если источник не отвечает, остаются прошлые значения, а на странице есть пометка.
"""
from __future__ import annotations

import bisect
import copy
import datetime as dt
import json
import os
import pathlib
import re
import threading
import urllib.request
import xml.etree.ElementTree as ET

CACHE_FILE = pathlib.Path(__file__).parent / "data" / "cache.json"
CACHE_TTL = 30 * 60          # как часто обновлять, секунд
HTTP_TIMEOUT = 8             # ожидание ответа одного источника, секунд
USER_AGENT = "Mozilla/5.0 (compatible; invest-site/1.0)"

CBR_DAILY_URL = "https://www.cbr.ru/scripts/XML_daily.asp"
CBR_SOAP_URL = "https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx"
CBR_KEYRATE_PAGE = "https://www.cbr.ru/hd_base/KeyRate/"
MOEX_URL = ("https://iss.moex.com/iss/engines/stock/markets/index/securities/{sec}.json"
            "?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,CURRENTVALUE,LASTVALUE,LASTCHANGEPRC")

HISTORY_FROM = dt.date(2025, 11, 1)   # с какой даты нужна история ключевой ставки

_lock = threading.Lock()
_state: dict = {}
MAX_BODY = 5 * 1024 * 1024
_thread_started = False
_loaded = False


# ----------------------------------------------------------------------
# Сеть
# ----------------------------------------------------------------------
def _http(url: str, data: bytes | None = None, headers: dict | None = None) -> bytes:
    """Один HTTP-запрос. В тестах эту функцию подменяют."""
    if not url.startswith("https://"):
        raise ValueError("разрешены только https-адреса")
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        body = resp.read(MAX_BODY + 1)
        if len(body) > MAX_BODY:
            raise ValueError("ответ источника слишком большой")
        return body


def safe_xml(xml_bytes: bytes):
    """Разбор XML от внешнего источника без DOCTYPE/ENTITY (защита от «миллиарда смехов» и XXE)."""
    head = xml_bytes[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in xml_bytes.upper():
        raise ValueError("XML с DOCTYPE/ENTITY отклонён")
    return ET.fromstring(xml_bytes)


# ----------------------------------------------------------------------
# Разбор ответов (чистые функции, их проверяют тесты)
# ----------------------------------------------------------------------
def parse_cbr_daily(xml_bytes: bytes) -> dict:
    """XML_daily.asp -> {'date': '2026-10-21', 'USD': 82.85, 'EUR': ..., 'CNY': ...}."""
    root = safe_xml(xml_bytes)
    d, m, y = root.attrib["Date"].split(".")
    out = {"date": f"{y}-{m}-{d}"}
    for v in root.iter("Valute"):
        code = v.findtext("CharCode")
        if code in ("USD", "EUR", "CNY"):
            nominal = float(v.findtext("Nominal", "1").replace(",", "."))
            value = float(v.findtext("Value").replace(",", "."))
            out[code] = value / nominal
    for code in ("USD", "EUR", "CNY"):
        if code not in out:
            raise ValueError(f"в ответе ЦБ нет курса {code}")
    return out


def parse_keyrate_soap(xml_bytes: bytes) -> list[tuple[str, float]]:
    """Ответ KeyRateXML -> [('2026-07-24', 14.0), ...] по возрастанию даты."""
    root = safe_xml(xml_bytes)
    rows = []
    for el in root.iter():
        if el.tag.split("}")[-1] != "KR":
            continue
        date_txt = rate_txt = None
        for ch in el:
            name = ch.tag.split("}")[-1]
            if name == "DT":
                date_txt = (ch.text or "")[:10]
            elif name == "Rate":
                rate_txt = (ch.text or "").replace(",", ".")
        if date_txt and rate_txt:
            rows.append((date_txt, float(rate_txt)))
    if not rows:
        raise ValueError("в ответе ЦБ нет значений ключевой ставки")
    return sorted(set(rows))


def parse_keyrate_html(html: str) -> list[tuple[str, float]]:
    """Страница cbr.ru/hd_base/KeyRate/ -> то же самое, что parse_keyrate_soap."""
    rows = []
    for d, r in re.findall(r"(\d{2}\.\d{2}\.\d{4})\s*</td>\s*<td[^>]*>\s*([\d]+(?:[.,]\d+)?)", html):
        day, month, year = d.split(".")
        rows.append((f"{year}-{month}-{day}", float(r.replace(",", "."))))
    if not rows:
        raise ValueError("на странице ЦБ не найдена таблица ключевой ставки")
    return sorted(set(rows))


def parse_moex(json_bytes: bytes) -> dict:
    """Ответ ISS по одному индексу -> {'value': 2426.09, 'change_pct': 0.5}."""
    md = json.loads(json_bytes)["marketdata"]
    cols = md["columns"]
    row = dict(zip(cols, md["data"][0]))
    value = row.get("CURRENTVALUE") or row.get("LASTVALUE")   # вне торгов текущего значения может не быть
    if value is None:
        raise ValueError("в ответе биржи нет значения индекса")
    return {"value": float(value), "change_pct": row.get("LASTCHANGEPRC")}


def parse_rss(xml_bytes: bytes, limit: int = 8) -> list[dict]:
    """RSS 2.0 -> [{'title', 'link', 'date'}]; берём только заголовок и ссылку на источник."""
    root = safe_xml(xml_bytes)
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        if not title or not re.match(r"https://([a-z0-9-]+\.)*cbr\.ru/", link):
            continue
        date = None
        raw = (it.findtext("pubDate") or "").strip()
        if raw:
            try:
                from email.utils import parsedate_to_datetime
                date = parsedate_to_datetime(raw).date().isoformat()
            except (TypeError, ValueError):
                date = None
        items.append({"title": title, "link": link, "date": date})
        if len(items) >= limit:
            break
    if not items:
        raise ValueError("в ленте нет новостей")
    return items


def key_rate_since(rows: list[tuple[str, float]]) -> str:
    """Дата, с которой действует последнее значение ставки."""
    last = rows[-1][1]
    since = rows[-1][0]
    for d, r in reversed(rows):
        if r != last:
            break
        since = d
    return since


def rate_on(rows: list[tuple[str, float]], day: dt.date) -> float | None:
    """Ставка, действовавшая в указанный день (None, если данных за эту дату ещё нет)."""
    keys = [r[0] for r in rows]
    i = bisect.bisect_right(keys, day.isoformat())
    return rows[i - 1][1] if i else None


# ----------------------------------------------------------------------
# Загрузка по источникам
# ----------------------------------------------------------------------
def _fetch_rates() -> dict:
    return {"rates": parse_cbr_daily(_http(CBR_DAILY_URL))}


def _fetch_key_rate() -> dict:
    today = dt.date.today()
    body = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
        '<KeyRateXML xmlns="http://web.cbr.ru/">'
        f"<fromDate>{HISTORY_FROM.isoformat()}</fromDate><toDate>{today.isoformat()}</toDate>"
        "</KeyRateXML></soap:Body></soap:Envelope>"
    ).encode("utf-8")
    try:
        rows = parse_keyrate_soap(_http(CBR_SOAP_URL, data=body, headers={
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": '"http://web.cbr.ru/KeyRateXML"',
        }))
    except Exception:
        # запасной путь: обычная страница с таблицей
        url = (f"{CBR_KEYRATE_PAGE}?UniDbQuery.Posted=True"
               f"&UniDbQuery.From={HISTORY_FROM.strftime('%d.%m.%Y')}&UniDbQuery.To={today.strftime('%d.%m.%Y')}")
        rows = parse_keyrate_html(_http(url).decode("utf-8", "replace"))
    return {"key_history": rows, "key_rate": rows[-1][1], "key_since": key_rate_since(rows)}


def _fetch_moex() -> dict:
    imoex = parse_moex(_http(MOEX_URL.format(sec="IMOEX")))
    try:
        rtsi = parse_moex(_http(MOEX_URL.format(sec="RTSI")))
    except Exception:
        rtsi = None            # индекс РТС необязателен
    return {"imoex": imoex, "rtsi": rtsi}


CBR_NEWS_URL = "https://www.cbr.ru/rss/RssPress"      # пресс-релизы Банка России


def _fetch_news() -> dict:
    return {"news": parse_rss(_http(CBR_NEWS_URL))}


SOURCES = {
    "rates": ("Курсы валют ЦБ", _fetch_rates),
    "key": ("Ключевая ставка", _fetch_key_rate),
    "moex": ("Индексы МосБиржи", _fetch_moex),
    "news": ("Новости Банка России", _fetch_news),
}


# ----------------------------------------------------------------------
# Кэш и обновление
# ----------------------------------------------------------------------
def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _load_cache() -> None:
    global _loaded
    with _lock:
        if _loaded:
            return
        _loaded = True
        try:
            _state.update(json.loads(CACHE_FILE.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass


def _save_cache() -> None:
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(_state, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass


def refresh() -> dict:
    """Обновляет все источники. Каждый источник независим: сбой одного не мешает остальным."""
    _load_cache()
    for name, (_title, fetch) in SOURCES.items():
        try:
            result = fetch()
            ok = True
            err = None
        except Exception as e:               # сеть, формат ответа, таймаут
            result, ok, err = None, False, f"{type(e).__name__}: {e}"
        with _lock:
            status = _state.setdefault("status", {})
            if ok:
                _state.update(result)
                status[name] = {"ok": True, "at": _now(), "error": None}
            else:
                prev = status.get(name, {})
                status[name] = {"ok": False, "at": prev.get("at"), "error": err}
    with _lock:
        _state["checked_at"] = _now()
        _save_cache()
        return copy.deepcopy(_state)


def _stale() -> bool:
    checked = _state.get("checked_at")
    if not checked:
        return True
    age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(checked)
    return age.total_seconds() > CACHE_TTL


def _loop() -> None:
    while True:
        if _stale():
            try:
                refresh()
            except Exception:
                pass
        threading.Event().wait(60)


def get_live() -> dict:
    """Последние известные данные. Не блокирует страницу: обновление идёт в фоновом потоке.

    Поток запускается при первом вызове. Чтобы отключить сетевые запросы (например, в тестах),
    задайте переменную окружения LIVE_DATA=off.
    """
    global _thread_started
    _load_cache()
    if os.environ.get("LIVE_DATA", "on").lower() != "off" and not _thread_started:
        _thread_started = True
        threading.Thread(target=_loop, name="live-data", daemon=True).start()
    with _lock:
        return copy.deepcopy(_state)


def reset_for_tests() -> None:
    global _loaded, _thread_started
    with _lock:
        _state.clear()
        _loaded = True
        _thread_started = True
