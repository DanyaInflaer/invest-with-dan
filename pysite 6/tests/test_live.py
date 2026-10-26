"""Проверки автообновления на подготовленных примерах ответов Банка России и МосБиржи.

Живые сайты в тестах не используются. Запуск: python -m unittest discover tests
"""
import datetime as dt
import json
import os
import pathlib
import sys
import tempfile
import unittest

os.environ["LIVE_DATA"] = "off"
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import live_data  # noqa: E402
import app as site  # noqa: E402

CBR_DAILY = (
    '<?xml version="1.0" encoding="windows-1251"?>'
    '<ValCurs Date="21.10.2026" name="Foreign Currency Market">'
    '<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal>'
    '<Name>Доллар США</Name><Value>82,8504</Value><VunitRate>82,8504</VunitRate></Valute>'
    '<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal>'
    '<Name>Евро</Name><Value>93,2316</Value><VunitRate>93,2316</VunitRate></Valute>'
    '<Valute ID="R01375"><NumCode>156</NumCode><CharCode>CNY</CharCode><Nominal>10</Nominal>'
    '<Name>Юань</Name><Value>123,869</Value><VunitRate>12,3869</VunitRate></Valute>'
    '<Valute ID="R01820"><NumCode>392</NumCode><CharCode>JPY</CharCode><Nominal>100</Nominal>'
    '<Name>Иена</Name><Value>53,1038</Value><VunitRate>0,531038</VunitRate></Valute>'
    '</ValCurs>'
).encode("windows-1251")


def soap(rows):
    items = "".join(f"<KR><DT>{d}T00:00:00+03:00</DT><Rate>{r}</Rate></KR>" for d, r in rows)
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
        '<KeyRateXMLResponse xmlns="http://web.cbr.ru/"><KeyRateXMLResult>'
        f'<KeyRate xmlns="">{items}</KeyRate>'
        '</KeyRateXMLResult></KeyRateXMLResponse></soap:Body></soap:Envelope>'
    ).encode("utf-8")


KEY_ROWS = [
    ("2025-12-19", 16), ("2026-02-13", 15.5), ("2026-03-20", 15), ("2026-04-24", 14.5),
    ("2026-06-19", 14.25), ("2026-07-24", 14), ("2026-09-11", 14),
]

MOEX = lambda sec, v: json.dumps({"marketdata": {  # noqa: E731
    "columns": ["SECID", "CURRENTVALUE", "LASTVALUE", "LASTCHANGEPRC"],
    "data": [[sec, v, 2426.09, 0.52]]}}).encode()


class Parsers(unittest.TestCase):
    def test_cbr_daily(self):
        r = live_data.parse_cbr_daily(CBR_DAILY)
        self.assertEqual(r["date"], "2026-10-21")
        self.assertAlmostEqual(r["USD"], 82.8504)
        self.assertAlmostEqual(r["CNY"], 12.3869)       # номинал 10 учтён
        self.assertAlmostEqual(r["EUR"], 93.2316)

    def test_cbr_daily_missing_currency(self):
        bad = CBR_DAILY.decode("windows-1251").replace("CNY", "XXX").encode("windows-1251")
        with self.assertRaises(ValueError):
            live_data.parse_cbr_daily(bad)

    def test_keyrate_soap(self):
        rows = live_data.parse_keyrate_soap(soap(KEY_ROWS[::-1]))   # порядок в ответе не важен
        self.assertEqual(rows[0], ("2025-12-19", 16.0))
        self.assertEqual(rows[-1], ("2026-09-11", 14.0))

    def test_keyrate_soap_empty(self):
        with self.assertRaises(ValueError):
            live_data.parse_keyrate_soap(soap([]))

    def test_keyrate_html(self):
        html = ("<table><tr><th>Дата</th><th>Ставка</th></tr>"
                "<tr><td>24.07.2026</td><td>14,00</td></tr>"
                "<tr><td>19.06.2026</td>\n<td class='x'>14,25</td></tr></table>")
        rows = live_data.parse_keyrate_html(html)
        self.assertEqual(rows, [("2026-06-19", 14.25), ("2026-07-24", 14.0)])

    def test_moex(self):
        r = live_data.parse_moex(MOEX("IMOEX", 2430.5))
        self.assertEqual(r["value"], 2430.5)
        self.assertEqual(r["change_pct"], 0.52)

    def test_moex_closed_market_uses_last_value(self):
        self.assertEqual(live_data.parse_moex(MOEX("IMOEX", None))["value"], 2426.09)

    def test_since_and_rate_on(self):
        daily = KEY_ROWS + [("2026-09-12", 14), ("2026-09-13", 14)]
        self.assertEqual(live_data.key_rate_since(sorted(daily)), "2026-07-24")
        self.assertEqual(live_data.rate_on(KEY_ROWS, dt.date(2026, 1, 31)), 16.0)
        self.assertEqual(live_data.rate_on(KEY_ROWS, dt.date(2026, 5, 31)), 14.5)
        self.assertIsNone(live_data.rate_on(KEY_ROWS, dt.date(2025, 12, 1)))


class FakeNet:
    """Подменяет сетевой запрос: отдаёт примеры или имитирует сбой."""
    def __init__(self, fail=()):
        self.fail = set(fail)

    def __call__(self, url, data=None, headers=None):
        for marker, body in (("XML_daily", CBR_DAILY), ("DailyInfo", soap(KEY_ROWS)),
                             ("IMOEX", MOEX("IMOEX", 2426.09)), ("RTSI", MOEX("RTSI", 914.0)),
                             ("RssPress", Blog.RSS)):
            if marker in url:
                if marker in self.fail:
                    raise OSError("нет связи")
                return body
        raise AssertionError("неожиданный адрес " + url)


class Refresh(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        live_data.CACHE_FILE = pathlib.Path(self.tmp.name) / "cache.json"
        live_data.reset_for_tests()
        self._orig = live_data._http

    def tearDown(self):
        live_data._http = self._orig
        self.tmp.cleanup()

    def test_all_sources(self):
        live_data._http = FakeNet()
        s = live_data.refresh()
        self.assertTrue(all(v["ok"] for v in s["status"].values()))
        self.assertEqual(s["key_rate"], 14.0)
        self.assertEqual(s["key_since"], "2026-07-24")
        self.assertAlmostEqual(s["rates"]["USD"], 82.8504)
        self.assertEqual(s["imoex"]["value"], 2426.09)
        self.assertEqual(s["rtsi"]["value"], 914.0)
        self.assertEqual(s["news"][0]["title"], "Банк России снизил ставку")
        self.assertTrue(live_data.CACHE_FILE.exists())

    def test_one_source_fails_others_still_update(self):
        live_data._http = FakeNet(fail=["XML_daily"])
        s = live_data.refresh()
        self.assertFalse(s["status"]["rates"]["ok"])
        self.assertTrue(s["status"]["key"]["ok"])
        self.assertNotIn("rates", s)

    def test_failure_keeps_previous_values(self):
        live_data._http = FakeNet()
        live_data.refresh()
        live_data._http = FakeNet(fail=["XML_daily", "DailyInfo", "IMOEX", "RssPress"])
        s = live_data.refresh()
        self.assertFalse(any(v["ok"] for v in s["status"].values()))
        self.assertAlmostEqual(s["rates"]["USD"], 82.8504)     # старые значения остались
        self.assertEqual(s["key_rate"], 14.0)

    def test_soap_failure_falls_back_to_html(self):
        html = b"<tr><td>24.07.2026</td><td>13,50</td></tr>"

        def net(url, data=None, headers=None):
            if "DailyInfo" in url:
                raise OSError("soap закрыт")
            if "hd_base/KeyRate" in url:
                return html
            return FakeNet()(url, data, headers)
        live_data._http = net
        s = live_data.refresh()
        self.assertTrue(s["status"]["key"]["ok"])
        self.assertEqual(s["key_rate"], 13.5)


class Extras(unittest.TestCase):
    def setUp(self):
        live_data.reset_for_tests()
        self.client = site.app.test_client()

    def test_faq_is_in_page_and_structured_data(self):
        html = self.client.get("/").get_data(as_text=True)
        self.assertEqual(html.count("<details>"), 7)
        import re
        ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(ld["@type"], "FAQPage")
        self.assertEqual(len(ld["mainEntity"]), 7)

    def test_faq_follows_key_rate(self):
        self.assertIn("Сейчас она 13,5%", site.build_faq(13.5, None)[0][1])
        self.assertIn("Ближайшее заседание: 18 декабря", site.build_faq(14, "18 декабря")[0][1])

    def test_decision_note_and_power_calc_present(self):
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn("сохранил ключевую ставку на уровне 14%", html)
        self.assertIn('id="power-form"', html)
        self.assertIn('value="6.35"', html)

    def test_static_build_has_no_localhost(self):
        os.environ["STATIC_BUILD"] = "1"
        try:
            html = self.client.get("/").get_data(as_text=True)
            robots = self.client.get("/robots.txt").get_data(as_text=True)
            self.assertNotIn("localhost", html)
            self.assertNotIn("canonical", html)
            self.assertNotIn("Sitemap", robots)
        finally:
            del os.environ["STATIC_BUILD"]

    def test_robots_and_sitemap(self):
        os.environ["SITE_URL"] = "https://example.github.io/my-site"
        try:
            robots = self.client.get("/robots.txt").get_data(as_text=True)
            self.assertIn("Sitemap: https://example.github.io/my-site/sitemap.xml", robots)
            sm = self.client.get("/sitemap.xml")
            self.assertIn("<loc>https://example.github.io/my-site/</loc>", sm.get_data(as_text=True))
            self.assertIn("xml", sm.mimetype)
            html = self.client.get("/").get_data(as_text=True)
            self.assertIn('<link rel="canonical" href="https://example.github.io/my-site/">', html)
        finally:
            del os.environ["SITE_URL"]


class Page(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        live_data.CACHE_FILE = pathlib.Path(self.tmp.name) / "cache.json"
        live_data.reset_for_tests()
        self._orig = live_data._http
        self.client = site.app.test_client()

    def tearDown(self):
        live_data._http = self._orig
        self.tmp.cleanup()

    def test_page_without_live_data_uses_fallbacks(self):
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn("82,85", html)                       # запасной курс
        self.assertIn("обновляются автоматически", html)
        self.assertIn("Ближайшее заседание" if site.next_meeting(dt.date.today()) else "ключевая ставка", html)

    def test_page_with_new_key_rate_changes_everywhere(self):
        rows = KEY_ROWS + [("2026-10-23", 13.5)]
        live_data._http = lambda url, data=None, headers=None: (
            soap(rows) if "DailyInfo" in url else FakeNet()(url, data, headers))
        live_data.refresh()
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn('<dd>13,5%</dd>', html)               # сводка
        self.assertIn("Ключевая ставка 13,5% действует с 23 октября", html)
        self.assertIn("до 13,5%", html)                     # вводный текст графика
        self.assertIn('"keyRate": 13.5', html)              # данные для калькулятора
        self.assertIn("Разрыв между ними сейчас 7,15 п. п.", html)

    def test_live_view_values(self):
        live_data._http = FakeNet()
        live_data.refresh()
        v = site.live_view(now=dt.datetime(2026, 10, 24, 12, 0, tzinfo=site.MSK))
        self.assertEqual(v["key_series"][0], 16.0)          # декабрь 2025
        self.assertEqual(v["key_series"][4], 14.5)          # апрель 2026
        self.assertEqual(v["key_series"][-1], 14.0)         # сентябрь 2026
        self.assertEqual(v["next_meeting"], "18 декабря")   # заседание 23 октября уже прошло
        self.assertIn("назначено на 18 декабря", v["scale_sub"])
        v2 = site.live_view(now=dt.datetime(2026, 12, 19, 12, 0, tzinfo=site.MSK))
        self.assertIsNone(v2["next_meeting"])               # даты в списке закончились
        self.assertNotIn("Следующее заседание", v2["scale_sub"])
        self.assertIn(("Доллар (ЦБ)", "82,85 ₽"), v["glance"])
        self.assertIn(("Индекс МосБиржи", "2 426"), v["glance"])
        self.assertEqual(v["invest"][2]["n"], "К предыдущему закрытию +0,52%. Индекс РТС 914.")
        self.assertIn("21 октября", v["invest"][3]["k"])

    def test_failure_note_is_shown(self):
        live_data._http = FakeNet(fail=["IMOEX"])
        live_data.refresh()
        v = site.live_view()
        self.assertIn("Не удалось обновить: индексы мосбиржи", v["live_note"])


class Pwa(unittest.TestCase):
    def test_pwa_files_served(self):
        c = site.app.test_client()
        m = c.get("/manifest.webmanifest")
        self.assertEqual(m.status_code, 200)
        self.assertTrue(json.loads(m.data)["icons"])
        sw = c.get("/sw.js")
        self.assertEqual(sw.status_code, 200)
        self.assertNotIn("__VERSION__", sw.get_data(as_text=True))
        self.assertNotIn("__PRECACHE__", sw.get_data(as_text=True))
        for n in ("icon-192.png", "icon-512.png", "apple-touch-icon.png"):
            self.assertEqual(c.get("/icons/" + n).status_code, 200)

    def test_page_has_pdf_and_invest(self):
        html = site.app.test_client().get("/").get_data(as_text=True)
        for key in ('id="pdf-btn"', 'id="invest-form"', 'id="ipoteka"', 'rel="manifest"'):
            self.assertIn(key, html)


class Tools(unittest.TestCase):
    def test_tools_section(self):
        html = site.app.test_client().get("/").get_data(as_text=True)
        page = site.app.test_client().get("/").get_data(as_text=True)
        for key in ('id="loan-form"', 'id="net-form"', 'id="rent-form"', 'id="bud-form"'):
            self.assertIn(key, page)
        for key in ('id="instrumenty"', 'id="tax-form"', 'id="ded-form"', 'id="pen-form"', 'id="cmp-form"'):
            self.assertIn(key, html)
        self.assertNotIn("{{", html)
        self.assertEqual(site.TAX["free_base"] * site.TAX["free_rate"] / 100, 160_000)


class Blog(unittest.TestCase):
    RSS = ('<?xml version="1.0"?><rss version="2.0"><channel>'
           '<item><title>Банк России снизил ставку</title><link>https://www.cbr.ru/press/1/</link>'
           '<pubDate>Fri, 23 Oct 2026 13:30:00 +0300</pubDate></item>'
           '<item><title>Без ссылки</title><link>javascript:x</link></item></channel></rss>').encode("utf-8")

    def test_parse_rss(self):
        items = live_data.parse_rss(self.RSS)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["date"], "2026-10-23")
        with self.assertRaises(ValueError):
            live_data.parse_rss(b"<rss><channel></channel></rss>")

    def test_events_from_history(self):
        import blog
        live = {"key_history": [["2026-06-01", 14.5], ["2026-06-02", 14.5], ["2026-07-24", 14.0], ["2026-09-12", 14.0]]}
        ev = blog.key_events(live, [], [])
        self.assertEqual(len(ev), 1)
        self.assertEqual((ev[0]["old"], ev[0]["new"], ev[0]["exact"]), (14.5, 14.0, True))

    def test_new_decision_makes_new_post(self):
        live_data.reset_for_tests()
        live_data._state.update({"key_history": [["2026-01-01", 16.0], ["2026-11-20", 15.0]], "key_rate": 15.0})
        after = site.get_posts()
        self.assertTrue(any(p["kind"] == "auto" and "15%" in p["title"] for p in after))
        self.assertIn("snizhenie-stavki-i-vklad", {p["slug"] for p in after})
        live_data.reset_for_tests()

    def test_pages_and_sitemap(self):
        c = site.app.test_client()
        index = c.get("/razbory/")
        self.assertEqual(index.status_code, 200)
        slugs = [p["slug"] for p in site.get_posts()]
        self.assertGreaterEqual(len(slugs), 5)
        for slug in slugs:
            r = c.get(f"/razbory/{slug}/")
            self.assertEqual(r.status_code, 200)
            self.assertIn("application/ld+json", r.get_data(as_text=True))
        self.assertEqual(c.get("/razbory/net-takogo/").status_code, 404)
        os.environ["SITE_URL"] = "https://example.com/site/"
        try:
            xml = c.get("/sitemap.xml").get_data(as_text=True)
        finally:
            del os.environ["SITE_URL"]
        self.assertIn("https://example.com/site/razbory/snizhenie-stavki-i-vklad/", xml)

    def test_theme_toggle_everywhere(self):
        c = site.app.test_client()
        for url in ("/", "/razbory/", "/razbory/inflyaciya-i-vklad/"):
            html = c.get(url).get_data(as_text=True)
            self.assertIn('id="theme-btn"', html, url)
            self.assertIn("localStorage", html, url)
        self.assertIn('id="regions-sort"', c.get("/").get_data(as_text=True))

    def test_quiz(self):
        quiz = site.build_quiz(14.0, 6.35)
        self.assertEqual(len(quiz), 7)
        for q in quiz:
            self.assertTrue(0 <= q["correct"] < len(q["options"]))
            self.assertEqual(len(set(q["options"])), len(q["options"]))
            self.assertTrue(q["why"])
        self.assertEqual(quiz[2]["options"][quiz[2]["correct"]], "14%")       # верный ответ про текущую ставку
        self.assertGreater(len({q["correct"] for q in quiz}), 2)               # верные ответы на разных местах
        self.assertIn('id="kviz"', site.app.test_client().get("/").get_data(as_text=True))

    def test_scenarios(self):
        for k in ("pess", "base", "opt"):
            self.assertIn(k, site.SCENARIOS)
        self.assertTrue(all(v == 0 for v in site.SCENARIOS["base"]["shift"].values()))
        shifts = {name: sc["shift"] for name, sc in site.SCENARIOS.items()}
        for kind in site.SCENARIO_NOTES:
            self.assertLess(shifts["pess"][kind] if kind in ("dep", "bond", "stock", "house") else -shifts["pess"][kind], 1)
        page = site.app.test_client().get("/").get_data(as_text=True)
        for key in ('id="scenarios"', 'data-scn-key="pess"', 'data-scn-key="opt"', 'id="fork-body"', 'id="scn-copy"', 'id="scn-reset"'):
            self.assertIn(key, page)
        self.assertGreaterEqual(page.count('data-scn="'), 15)

    def test_goal_and_fx(self):
        page = site.app.test_client().get("/").get_data(as_text=True)
        for key in ('id="goal-form"', 'id="fx-form"'):
            self.assertIn(key, page)
        live_data.reset_for_tests()
        fx = site.fx_view()
        self.assertFalse(fx["live"])
        self.assertEqual(fx["USD"], site.FX_FALLBACK["USD"])
        live_data._state.update({"rates": {"date": "2026-10-23", "USD": 80.0, "EUR": 90.0, "CNY": 11.0}})
        fx = site.fx_view()
        self.assertTrue(fx["live"])
        self.assertEqual((fx["USD"], fx["date"]), (80.0, "23 октября 2026"))
        live_data.reset_for_tests()

    def test_accessibility_landmarks(self):
        c = site.app.test_client()
        for url in ("/", "/razbory/", "/razbory/inflyaciya-i-vklad/"):
            html = c.get(url).get_data(as_text=True)
            self.assertIn('<main id="main">', html, url)
            self.assertIn('class="skip"', html, url)
            self.assertIn('media="print" onload', html, url)      # шрифты не блокируют показ страницы
        home = c.get("/").get_data(as_text=True)
        self.assertEqual(home.count("<h1"), 1)

    def test_calendar(self):
        self.assertEqual(len(site.MEETINGS), 8)
        self.assertEqual(sorted(site.MEETINGS), site.MEETINGS)
        cal = site.calendar_view(dt.date(2026, 10, 26))
        self.assertEqual([m["status"] for m in cal], ["past"] * 7 + ["next"])
        self.assertEqual(cal[0]["decision"], "Ставка снижена с 16% до 15,5%")
        self.assertEqual(cal[5]["decision"], "Ставка сохранена на уровне 14%")
        self.assertEqual(cal[0]["weekday"], "пятница")
        self.assertIsNone(cal[-1]["decision"])
        self.assertEqual(site.calendar_view(dt.date(2026, 12, 18))[-1]["status"], "next")     # в день заседания оно ещё «следующее»
        self.assertEqual(site.calendar_view(dt.date(2027, 1, 1))[-1]["status"], "past")
        page = site.app.test_client().get("/").get_data(as_text=True)
        self.assertEqual(page.count('class="cal-item '), 8)
        self.assertIn('id="cal-ics"', page)
        # точные даты в автоматических разборах берутся из календаря заседаний
        dates = {p["slug"]: p["date"] for p in site.get_posts() if p["kind"] == "auto"}
        self.assertEqual(dates["klyuchevaya-stavka-2026-06"], "2026-06-19")

    def test_main_page_links_blog(self):
        html = site.app.test_client().get("/").get_data(as_text=True)
        self.assertIn('id="razbory"', html)
        self.assertIn('href="razbory/"', html)


if __name__ == "__main__":
    unittest.main()
