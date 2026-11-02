#!/usr/bin/env python3
"""Creality Print's web pages (resources/web: home page, setup guide, login, device pages) are clients of Creality's cloud
(api.crealitycloud.com, Firebase analytics). The browser build never talks to a maker server, so each page gets a
Content-Security-Policy that keeps every load on our own host: the browser refuses the rest before any request leaves,
and the pages see an offline network. Their request wrapper (axios) rejects a refused request with "Network Error" and the
home page's callers leave that rejection unhandled (an uncaught error in the tab), so each page also gets a small script that
marks a refused request's rejection handled; any other rejection is left alone. The page files are otherwise stock.

usage: web-pages-offline.py <resources dir>   (edits <dir>/web/**/*.html in place; run on a copy, never the source tree)
"""
import os, re, sys

CSP = ("default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; "
       "connect-src 'self' data: blob:; img-src 'self' data: blob:; font-src 'self' data:; "
       "media-src 'self' data: blob:; frame-src 'self' data: blob:")
META = '<meta http-equiv="Content-Security-Policy" content="%s">' % CSP
QUIET = ('<script>addEventListener("unhandledrejection",function(e){var r=e.reason;'
         'if(r&&r.isAxiosError&&!r.response)e.preventDefault()})</script>')

web = os.path.join(sys.argv[1], 'web')
done = 0
for root, _, names in os.walk(web):
    for n in names:
        if not n.endswith('.html'):
            continue
        p = os.path.join(root, n)
        t = open(p, encoding='utf-8', errors='surrogateescape').read()
        if 'http-equiv="Content-Security-Policy"' in t:
            continue
        m = re.search(r'<head[^>]*>', t, re.I)
        t = t[:m.end()] + META + QUIET + t[m.end():] if m else META + QUIET + t
        os.unlink(p)  # the copy is hard-linked to the source tree: write a new file, never through the link
        open(p, 'w', encoding='utf-8', errors='surrogateescape').write(t)
        done += 1
print('web pages kept on our host:', done)
