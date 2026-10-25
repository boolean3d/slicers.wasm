#!/usr/bin/env python3
# The browser build's copy of Bambu Studio's resources/images, resources/web and resources/hms, with what links a person back to
# Bambu Lab taken out: no maker logo, no Bambu account sign-in, no store,
# no telemetry page. The plain-text credit to Bambu Lab stays (memory credit-not-claim-bambu). Every other file is the
# same bytes. Run by browser-build/CMakeLists.txt at configure time; the build preloads <out>/images and <out>/web, and the page
# server's resources folder links these two in place of Bambu's (build.sh).
#   python3 remove-maker-branding.py <bambu>/resources <out>
import os, shutil, struct, sys, zlib

src, out = sys.argv[1], sys.argv[2]
for d in ('images', 'web', 'hms'):
    shutil.rmtree(os.path.join(out, d), ignore_errors=True)
    shutil.copytree(os.path.join(src, d), os.path.join(out, d), symlinks=False)

# ── Printer messages: Bambu ships the HMS texts of its newer printers only; desktop downloads the others' (X1C = 00M,
# P1S = 01P) from Bambu's servers on first connect, which the browser build never asks. printer-messages/ holds those files as
# desktop Bambu Studio downloaded them (copied from a Windows desktop's %APPDATA%/BambuStudio/hms, 10-24), so the
# printer's error and HMS boxes show their words. HMS.cpp's list of shipped printer types gains them (CMakeLists). ──
extra = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'printer-messages')
for n in sorted(os.listdir(extra)):
    shutil.copyfile(os.path.join(extra, n), os.path.join(out, 'hms', n))


def empty_svg(path):
    """Same size and view box, nothing drawn."""
    head = open(path, encoding='utf-8').read().split('>', 1)[0] + '>'
    open(path, 'w', encoding='utf-8').write(head + '\n</svg>\n')


def empty_png(path):
    """Same size, fully transparent."""
    w, h = struct.unpack('>II', open(path, 'rb').read()[16:24])
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\0' + b'\0' * (4 * w) for _ in range(h))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def edit(rel, find, replace):
    p = os.path.join(out, rel)
    s = open(p, encoding='utf-8').read()
    if find not in s:
        sys.exit(f'maker-free: {rel}: text not found: {find[:60]!r}')
    open(p, 'w', encoding='utf-8').write(s.replace(find, replace))


# ── Logos: Bambu Lab's mark and the Bambu Studio icon draw nothing ──
img = os.path.join(out, 'images')
for n in sorted(os.listdir(img)):
    p = os.path.join(img, n)
    logo = n.startswith('BambuStudio') or n in ('splash_logo.svg', 'liveview_logo.svg', 'bbl-3dp-logo.svg', 'topbar_logo.svg')
    if logo and n.endswith('.svg'): empty_svg(p)
    elif logo and n.endswith('.png'): empty_png(p)
# the Device tab's picture of a job with no picture: the grey square without the logo on it
p = os.path.join(img, 'monitor_placeholder.svg')
s = open(p, encoding='utf-8').read()
open(p, 'w', encoding='utf-8').write(s.split('>', 1)[0] + '>\n' + s.split('\n')[1] + '\n</svg>\n')
# the home page's and the setup wizard's welcome page's Bambu Studio mark (web/image/logo.png: guide/1)
for d in (('homepage3', 'img'), ('image',)):
    for n in ('logo.png', 'logo2.png'):
        p = os.path.join(out, 'web', *d, n)
        if os.path.exists(p): empty_png(p)

# ── Setup wizard: no "Customer Experience Improvement Program" page. The tab answers it as "No" (the desktop's skip
# button: nothing is collected) and goes on; Back from the next pages returns to the region page before it. ──
edit('web/guide/3/index.html', '<body onLoad="OnInit()">', '<body onLoad="OnInit()" style="visibility:hidden">')
edit('web/guide/3/3.js', "\t\tm_Region=strRegion.toLowerCase();\n}",
     "\t\tm_Region=strRegion.toLowerCase();\n\n\tGotoSkipPage();   // browser build: never asks to join the program\n}")
edit('web/guide/21/index.html', "onclick=\"window.open('../3/index.html','_self')\"", "onclick=\"window.open('../11/index.html','_self')\"")
edit('web/guide/22/22.js', 'document.location.href="../3/index.html";', 'document.location.href="../11/index.html";')

# ── Home: no Bambu account sign-in (it needs Bambu's closed plug-in; a Bambu password never passes through our site)
# and no Maker's Supply store. ──
edit('web/homepage3/left.html', '</head>',
     '<style>/* browser build: no Bambu account, no store */ #LoginArea, .BtnItem[menu="makersupply"] { display: none !important; }</style>\n</head>')
# ── Plate names: the plate-type labels drawn on the bed read "Bambu Textured PEI Plate", "Bambu Cool Plate"...; the maker's
# name (the first word) goes, the rest stays where the label sits: the middle labels stay centred, the side labels keep their
# start (top, read downwards). The letters are outlines (one or more paths per letter), so words are found from the gaps. ──
import re


def path_box(d):
    """Box of a path's end and control points (enough to tell letters and words apart)."""
    t = re.findall(r'[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?', d)
    xs, ys, x, y, sx, sy, cmd, i = [], [], 0.0, 0.0, 0.0, 0.0, 'M', 0
    take = {'M': 2, 'L': 2, 'T': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'A': 7, 'Z': 0}
    while i < len(t):
        if t[i].isalpha(): cmd = t[i]; i += 1
        C, rel = cmd.upper(), cmd.islower()
        if C == 'Z': x, y = sx, sy; continue
        n = [float(v) for v in t[i:i + take[C]]]; i += take[C]
        if C == 'H': x = x + n[0] if rel else n[0]
        elif C == 'V': y = y + n[0] if rel else n[0]
        elif C == 'A': x, y = (x + n[5], y + n[6]) if rel else (n[5], n[6])
        else:
            pts = [(n[k] + (x if rel else 0), n[k + 1] + (y if rel else 0)) for k in range(0, len(n), 2)]
            for px, py in pts[:-1]: xs.append(px); ys.append(py)
            x, y = pts[-1]
        if C == 'M': sx, sy = x, y; cmd = 'l' if rel else 'L'
        xs.append(x); ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def drop_first_word(rel, down):
    p = os.path.join(out, rel); s = open(p, encoding='utf-8').read()
    paths = list(re.finditer(r'<path d="([^"]+)"[^>]*/>', s))
    boxes = [path_box(m.group(1)) for m in paths]
    # reading position of each path: x for the middle labels, y for the side labels (read downwards)
    span = [(b[1], b[3]) if down else (b[0], b[2]) for b in boxes]
    across = max((b[2] - b[0]) if down else (b[3] - b[1]) for b in boxes)
    order = sorted(range(len(paths)), key=lambda k: span[k][0])
    end, first = span[order[0]][1], [order[0]]
    for k in order[1:]:
        if span[k][0] - end > 0.25 * across: break   # the space after the first word
        first.append(k); end = max(end, span[k][1])
    rest = [k for k in order if k not in first]
    if len(first) != 5 or not rest: sys.exit(f'maker-free: {rel}: first word is {len(first)} outlines, not "Bambu"')
    move = min(span[k][0] for k in rest) - span[order[0]][0]
    dx, dy = (0, -move) if down else (-move / 2, 0)
    out_s, last = [], 0
    for k, m in enumerate(paths):
        out_s.append(s[last:m.start()]); last = m.end()
        if k in first: continue
        assert 'transform=' not in m.group(0), rel
        out_s.append(m.group(0)[:-2].rstrip() + f' transform="translate({dx:.3f} {dy:.3f})"/>')
    out_s.append(s[last:])
    open(p, 'w', encoding='utf-8').write(''.join(out_s))


for kind in ('ep', 'pc', 'pei', 'pte', 'st'):
    drop_first_word(f'images/bbl_bed_{kind}_middle.svg', False)
    drop_first_word(f'images/bbl_bed_{kind}_left.svg', True)
# ── Plate strip mark: the front strip of each plate type (images/bbl_bed_*_{bottom,bottom_n,left_bottom}.svg, drawn on the
# bed under "PLA/ABS/PETG") starts with Bambu Lab's four-piece mark, and the SuperTack strip names the plate "Bambu Cool Plate".
# Each file draws the mark its own way (holes in the strip, pieces of it, or pieces laid on it), so the mark is covered with
# the strip's own colour where it sits; the plate icon and words next to it stay. Places were measured on Bambu Studio's
# 2.3 files (a render, 1/8 unit); a file that is no longer those bytes stops the build. Shared with Orca (remove-maker-branding-orca.py). ──
import hashlib
STRIP_MARK = {  # file: (sha256 of Bambu's file, strip colour, [(x0, y0, x1, y1) to cover])
    'ep_bottom':       ('eeaef967dfcc287e46f7ef62108fea5bafba4e6b8e3a8bf9d4c13f135e107bb2', '#B3B3B3', [(60.6, 9.5, 72.6, 25.1)]),
    'ep_bottom_n':     ('eeaef967dfcc287e46f7ef62108fea5bafba4e6b8e3a8bf9d4c13f135e107bb2', '#B3B3B3', [(60.6, 9.5, 72.6, 25.1)]),
    'ep_left_bottom':  ('3fde1d1fb38087a7a121a37d9c027d61cce71e61d92e55bb7230270e088167e6', '#B3B3B3', [(4.5, 3.4, 17.6, 20.5)]),
    'pc_bottom':       ('232779cde96c7cf7a644a55570ba2d9dced0b06cb94d447831781a858c8203e1', '#CFD2D3', [(29.2, 12.8, 41.1, 28.4)]),
    'pc_left_bottom':  ('748c2165fde50422d1fb6c8a43ffaab922edeeda0a3b88a76e6a59f08cba6bd1', '#A9ABAA', [(4.2, 3.8, 17.4, 20.9)]),
    'pei_bottom':      ('975dabb8af5477f4e85e93d560ded59c045e32aaae0a58194c5f35b921cbf538', '#CFD2D3', [(29.8, 13.2, 41.8, 28.9)]),
    'pei_bottom_n':    ('6a80cd46e6d98597a9b17656727d497ed9271aa9e3281e0f07826b5b7173ea58', '#B3B3B3', [(61.4, 13.2, 73.4, 28.8)]),
    'pei_left_bottom': ('748c2165fde50422d1fb6c8a43ffaab922edeeda0a3b88a76e6a59f08cba6bd1', '#A9ABAA', [(4.2, 3.8, 17.4, 20.9)]),
    'pte_bottom':      ('aab7aff7ec3cadc9bbfed39ad30faae35d32a24ac60d60f164ecab82e45aecbd', '#CFD2D3', [(29.8, 13.2, 41.8, 28.9)]),
    'pte_bottom_n':    ('6a80cd46e6d98597a9b17656727d497ed9271aa9e3281e0f07826b5b7173ea58', '#B3B3B3', [(61.4, 13.2, 73.4, 28.8)]),
    'pte_left_bottom': ('748c2165fde50422d1fb6c8a43ffaab922edeeda0a3b88a76e6a59f08cba6bd1', '#A9ABAA', [(4.2, 3.8, 17.4, 20.9)]),
    'st_bottom':       ('fae6fbfecd5fe0326ee43295cad9fdaee800dfe61677ad5d7d84cfd140cd079e', '#CED1D2',
                        [(43.4, 12.8, 55.4, 28.4), (235.4, 16.6, 273.9, 24.8)]),   # the mark; the word "Bambu" before "Cool Plate"
    'st_bottom_n':     ('8685e5a67645c1c6784c82ee1bb3e93117f60e75f341c37e1ca4e309ed10ed6d', '#B3B3B3', [(278.0, 9.8, 290.0, 25.4)]),
    'st_left_bottom':  ('d55bb45ae5713645d87c4ffbb6ec1caf48a2620b9e5695384e889042ab2f55e4', '#B3B3B3', [(4.5, 3.3, 17.6, 20.3)]),
}
for name, (sha, colour, boxes) in STRIP_MARK.items():
    p = os.path.join(out, 'images', f'bbl_bed_{name}.svg')
    s = open(p, 'rb').read()
    if hashlib.sha256(s).hexdigest() != sha:
        sys.exit(f'maker-free: bbl_bed_{name}.svg is not the file the mark was measured on: measure it again')
    s = s.decode('utf-8'); end = s.rindex('</svg>')
    cover = ''.join(f'<rect x="{x0 - 0.3:.1f}" y="{y0 - 0.3:.1f}" width="{x1 - x0 + 0.6:.1f}" height="{y1 - y0 + 0.6:.1f}" fill="{colour}"/>\n'
                    for x0, y0, x1, y1 in boxes)
    open(p, 'w', encoding='utf-8').write(s[:end] + cover + s[end:])
print('maker-free: done', out)
