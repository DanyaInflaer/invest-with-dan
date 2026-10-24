"""Собирает один готовый файл dist/index.html (стили и скрипт внутри).

Перед сборкой скрипт один раз обновляет курсы, ключевую ставку и индексы биржи.
Такой файл можно выложить на любой бесплатный хостинг (GitHub Pages, Netlify, Cloudflare Pages)
без Python на сервере.

Адрес сайта для поисковиков: задайте переменную SITE_URL (например, https://имя.github.io/my-site/).

Запуск:
    python build_static.py                 обычная сборка; если сеть недоступна, берутся прошлые значения
    python build_static.py --require-live  завершится с ошибкой, если не обновился ни один источник
                                           (так работает автосборка на GitHub: старый сайт не затирается)
"""
import os
import pathlib
import shutil
import sys
import time

os.environ["STATIC_BUILD"] = "1"
os.environ["LIVE_DATA"] = "off"      # фоновый поток не нужен: обновляем один раз вручную ниже

import live_data  # noqa: E402
from app import STATIC_PRECACHE, app, sw_source  # noqa: E402

ROOT = pathlib.Path(__file__).parent


def main() -> int:
    state = live_data.refresh()
    status = state.get("status", {})
    for name, (title, _fn) in live_data.SOURCES.items():
        s = status.get(name, {})
        print(f"  {title}: {'обновлено' if s.get('ok') else 'НЕ ОБНОВЛЕНО (' + str(s.get('error')) + ')'}")

    if "--require-live" in sys.argv and not any(s.get("ok") for s in status.values()):
        print("Ни один источник не ответил, сборка остановлена, чтобы не опубликовать устаревшие данные.")
        return 1

    html = app.test_client().get("/").get_data(as_text=True)
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    html = html.replace(
        '<link rel="stylesheet" href="/static/style.css">',
        "<style>\n" + css + "\n</style>",
    )
    html = html.replace(
        '<script src="/static/app.js"></script>',
        "<script>\n" + js + "\n</script>",
    )
    assert "/static/" not in html, "в файле остались ссылки на static"

    out = ROOT / "dist"
    out.mkdir(exist_ok=True)
    (out / "index.html").write_text(html, encoding="utf-8")
    # для поисковиков; адрес сайта берётся из переменной SITE_URL (например, https://имя.github.io/my-site/)
    client = app.test_client()
    (out / "robots.txt").write_text(client.get("/robots.txt").get_data(as_text=True), encoding="utf-8")
    if os.environ.get("SITE_URL"):
        (out / "sitemap.xml").write_text(client.get("/sitemap.xml").get_data(as_text=True), encoding="utf-8")
    # установка как приложение и работа без сети
    shutil.copy(ROOT / "static" / "manifest.webmanifest", out / "manifest.webmanifest")
    shutil.copytree(ROOT / "static" / "icons", out / "icons", dirs_exist_ok=True)
    (out / "sw.js").write_text(sw_source(STATIC_PRECACHE, str(int(time.time()))), encoding="utf-8")
    print(f"Готово: {out / 'index.html'} ({len(html) // 1024} КБ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
