# Pointers above 2 GB read right in the shared JavaScript (z74, kicad-gerbers-7 10-27; : mandatory before KiCad
# ships). A program whose heap grows past 2 GB (KiCad: ~3.1 GB with a schematic open) gets addresses >= 2^31. EM_ASM 'p'
# arguments arrive unsigned, and `ptr >> 2` / `>> 3` on such a number is NEGATIVE (>> is a signed 32-bit shift), so a
# heap index went below zero: drawLines/drawPolygon read undefined points, a graphics path or text measure wrote nowhere.
# Values that come from a wasm export or a plain JS-library argument (no 'p' signature) arrive SIGNED: _wxWasmKeyBuf()
# for key names, and the cursor/icon pixels of wxpage_set_cursor_image/set_icon_image, which then threw RangeError.
# Fix: unsigned shifts (>>>) and `ptr >>>= 0` where a pointer may arrive signed (a no-op on one already unsigned).
# Small heaps are unchanged.
#
# Run in a wx tree (no arguments): patches build/wasm/wx.js, as the other edits.
# Run with files: patches each wxgc.js (spike/wxgc/js) and wxpage.js (spike/slicer-wx/js, bulk/recipe-*/) given.
# Marker (z74) per line; re-running changes nothing. A line whose anchor is absent (older trees) is reported, the rest applied.
import os, sys

EDITS = {
    'wx.js': [
        ('  var wxPutStr = function (str, ptr, max) {\n',
         '  var wxPutStr = function (str, ptr, max) {\n    ptr >>>= 0;   // (z74) a wasm export returns it signed\n'),
        ('  var drawLines = function (id, n, ptr) {\n    var ctx = getContext(id);\n\n    if (n > 0) {\n      var index = ptr >> 2;\n',
         '  var drawLines = function (id, n, ptr) {\n    var ctx = getContext(id);\n\n    if (n > 0) {\n      var index = ptr >>> 2;   // (z74) above 2 GB\n'),
        ('  var drawPolygon = function (id, n, ptr, fillEvenOdd, fill, stroke) {\n    var ctx = getContext(id);\n\n    if (n > 0) {\n      var index = ptr >> 2;\n',
         '  var drawPolygon = function (id, n, ptr, fillEvenOdd, fill, stroke) {\n    var ctx = getContext(id);\n\n    if (n > 0) {\n      var index = ptr >>> 2;   // (z74) above 2 GB\n'),
    ],
    'wxgc.js': [
        ('  var i = ptr >> 3;\n', '  var i = ptr >>> 3;   // (z74) above 2 GB\n'),
        ('  Module.HEAPF64.set(r, out >> 3);\n', '  Module.HEAPF64.set(r, out >>> 3);   // (z74)\n'),
        ('  Module.HEAPF64.set(widths, out >> 3);\n', '  Module.HEAPF64.set(widths, out >>> 3);   // (z74)\n'),
    ],
    'wxpage.js': [
        ('  wxpage_set_cursor_image: function(ptr, w, h, hx, hy) {\n',
         '  wxpage_set_cursor_image: function(ptr, w, h, hx, hy) {\n    ptr >>>= 0;   // (z74) a JS-library argument arrives signed\n'),
        ('  wxpage_set_icon_image: function(ptr, w, h) {\n',
         '  wxpage_set_icon_image: function(ptr, w, h) {\n    ptr >>>= 0;   // (z74)\n'),
    ],
}

def patch(path):
    kind = os.path.basename(path)
    if kind not in EDITS:
        print('z74: not a file it knows (wx.js, wxgc.js, wxpage.js):', path); return 1
    s = open(path).read()
    done = 0; missing = []
    for a, b in EDITS[kind]:
        if b in s: continue                     # this one already in
        if s.count(a) != 1: missing.append(a); continue
        s = s.replace(a, b, 1); done += 1
    for a in missing:
        print('z74: anchor not found once in %s, left alone:' % path, a.strip().splitlines()[-1].strip()[:60])
    if not done:
        return 1 if missing else 0
    open(path, 'w').write(s)
    print('z74: patched %d line(s) in' % done, path)
    return 0

files = sys.argv[1:] or ['build/wasm/wx.js']
bad = sum(patch(f) for f in files)
sys.exit(0 if not sys.argv[1:] else (1 if bad else 0))   # in a wx build (no args) never stop the build, as the other edits
