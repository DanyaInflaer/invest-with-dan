"""Защита сайта: политика безопасности контента (CSP), заголовки, защита от встраивания.

Скрипты на страницах встроенные, поэтому вместо опасного 'unsafe-inline' для скриптов
в политику подставляются хэши (sha256) каждого исполняемого скрипта: любой чужой
внедрённый скрипт браузер просто не выполнит.
"""
import base64
import hashlib
import re

SCRIPT_RE = re.compile(r"<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>", re.S | re.I)


def script_hashes(html: str) -> list[str]:
    """Хэши встроенных исполняемых скриптов (JSON-LD и данные не исполняются, их пропускаем)."""
    out = []
    for m in SCRIPT_RE.finditer(html):
        attrs = m.group("attrs")
        if "src=" in attrs:
            continue
        t = re.search(r'type\s*=\s*["\']([^"\']+)', attrs)
        if t and t.group(1).lower() not in ("text/javascript", "module"):
            continue
        digest = hashlib.sha256(m.group("body").encode("utf-8")).digest()
        out.append("'sha256-" + base64.b64encode(digest).decode() + "'")
    return sorted(set(out))


def csp_policy(html: str, meta: bool = False) -> str:
    scripts = " ".join(["'self'"] + script_hashes(html))
    parts = [
        "default-src 'none'",
        f"script-src {scripts}",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",   # стили только внешние шрифты и свои
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
    ]
    if not meta:                      # в <meta> эти директивы не работают
        parts.append("frame-ancestors 'none'")
    return "; ".join(parts)


META_REFERRER = '<meta name="referrer" content="strict-origin-when-cross-origin">'


def inject_meta(html: str) -> str:
    """Для статического хостинга без своих заголовков (GitHub Pages): политика в <meta>."""
    tags = ('<meta http-equiv="Content-Security-Policy" content="' + csp_policy(html, meta=True) + '">\n'
            + META_REFERRER + "\n")
    anchor = '<meta charset="utf-8">'          # кодировка должна остаться в первых 1024 байтах
    return html.replace(anchor, anchor + "\n" + tags, 1) if anchor in html else html


HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


def apply_headers(resp, secure: bool = False):
    for k, v in HEADERS.items():
        resp.headers.setdefault(k, v)
    if resp.mimetype == "text/html":
        body = resp.get_data(as_text=True)
        resp.headers["Content-Security-Policy"] = csp_policy(body)
    if secure:
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp
