#!/usr/bin/env python3
# Orca's resources/images with Bambu Lab's marks taken out, as the Bambu build's remove-maker-branding.py does (the rule of
# these builds: no maker logo; the plain-text credit stays). Edits <orca>/resources/images in place, before
# staging (the package reads resources from there). Orca's own logo stays. Safe to run twice.
#   python3 remove-maker-branding-orca.py <orca>/resources <bambu remove-maker-branding.py>
# - BambuStudio*.svg/png draw nothing: PresetComboBoxes draws BambuStudioBlack in place of the word "Bambu" in preset names
# - monitor_placeholder.svg (Device tab, a job with no picture): the grey square without the logo
# - the plate-type labels on the bed lose "Bambu": the "Plate names" block of remove-maker-branding.py (one copy of that code)
# - the front strip's four-piece mark (and "Bambu" in the SuperTack strip): the "Plate strip mark" block of remove-maker-branding.py
#   (13 of Orca's 14 strip files are byte-identical to Bambu's; Orca's ep_bottom is an older drawing with the mark in the
#   middle of the strip, after "PETG/ABS/TPU/PA/PC": ORCA_STRIP measured on a render, 1/8 unit)
# (the bed's own mark, bbl-3dp-logo.svg, is bed-mark-off.py's)
import os, sys
out, mf = sys.argv[1], sys.argv[2]
src = open(mf, encoding='utf-8').read()
img = os.path.join(out, 'images')
for n in sorted(os.listdir(img)):
    if not n.startswith('BambuStudio'): continue
    p = os.path.join(img, n)
    if n.endswith('.svg'):
        head = open(p, encoding='utf-8').read().split('>', 1)[0] + '>'
        open(p, 'w', encoding='utf-8').write(head + '\n</svg>\n')
    elif n.endswith('.png'):
        g = {}; exec(src[src.index('def empty_png'):src.index('def edit')], {'struct': __import__('struct'), 'zlib': __import__('zlib')}, g); g['empty_png'](p)
p = os.path.join(img, 'monitor_placeholder.svg')
s = open(p, encoding='utf-8').read()
open(p, 'w', encoding='utf-8').write(s.split('>', 1)[0] + '>\n' + s.split('\n')[1] + '\n</svg>\n')
ORCA_STRIP = {'ep_bottom': ('341bb0b377ff33221aeb35706db5a24eeb13189172e55dba966d36fa55e74ae0', '#CED1D2', [(164.8, 12.7, 176.5, 28.9)])}
def section(head, stop):
    i = src.index(head); return src[i:src.index(stop, i + 1)]
if 'transform="translate(' in open(os.path.join(img, 'bbl_bed_pei_middle.svg'), encoding='utf-8').read():
    print('maker-free-orca: plate names already done')
else:
    exec(section('# ── Plate names', '\n# ── '), {'out': out, 'os': os, 'sys': sys, '__name__': 'maker_free_orca'})
strip = open(os.path.join(img, 'bbl_bed_pei_bottom.svg'), encoding='utf-8').read().rstrip().split('\n')
if len(strip) > 1 and strip[-2].startswith('<rect x='):   # the cover the strip block appends before </svg>
    print('maker-free-orca: plate strip mark already done')
else:
    code = section('# ── Plate strip mark', "print('maker-free: done'"); loop = 'for name, (sha, colour, boxes) in STRIP_MARK.items():'
    assert code.count(loop) == 1, 'remove-maker-branding.py strip block changed: look again'
    code = code.replace(loop, 'STRIP_MARK.update(ORCA_STRIP)\n' + loop)
    exec(code, {'out': out, 'os': os, 'sys': sys, 'ORCA_STRIP': ORCA_STRIP, '__name__': 'maker_free_orca'})
print('maker-free-orca: done', out)
