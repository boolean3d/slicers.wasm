# SetSize with -1 takes the window's best size, as wxMSW/wxGTK (z80. The port's DoSetSize asked)
# DoGetBestSize() for a -1 width/height (wxSIZE_AUTO); wx's own ports ask GetBestSize(), which prefers
# DoGetBestClientSize() + border. A control that gives its size only through DoGetBestClientSize (univ wxTextCtrl) got the
# base class answer instead: wxWindowBase::DoGetBestSize -> min size defaulted to 1x1. Seen: KiCad's grid footprint cell
# (a wxComboCtrl editor) - wxComboCtrlBase::PositionTextCtrl does m_text->SetSize(x, y, w, -1): its text box came out
# 478x1 px (best 15), so the editor showed no text and no caret while typing still worked.
# Every tree; run in owx or pwx.
import sys
p = 'src/wasm/window.cpp'
s = open(p).read()
if '(z80)' in s:
    sys.exit(0)
a = '\n            size = DoGetBestSize();\n'
b = '\n                size = DoGetBestSize();\n'
if s.count(a) != 1 or s.count(b) != 1:
    print('z80: DoSetSize anchors not found once in', p, ', skipped'); sys.exit(0)
s = s.replace(a, '\n            size = GetBestSize();   // (z80) as wxMSW/wxGTK: DoGetBestClientSize first, cached\n', 1)
s = s.replace(b, '\n                size = GetBestSize();   // (z80)\n', 1)
open(p, 'w').write(s)
print('z80: SetSize -1 = GetBestSize')
