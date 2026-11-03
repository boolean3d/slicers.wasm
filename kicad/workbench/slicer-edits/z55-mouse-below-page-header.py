# Mouse and touch positions are measured from the program's area, not from the top of the page (z55, hub-screens-5 10-26).
# The page may put a header above the program (#main-window lowered: the Boolean3d workspace bar, 32 px). The port
# already knows it: wx.js keeps wxPageMainTop (#main-window offsetTop, sent with every resize) and ResizeCallbackNow
# takes it off the height. But mouse and touch input still used the page's clientY as the wx position, so every click
# landed one header height BELOW the pointer (a menu item under the one clicked). The page bar worked around it by
# shifting cy before posting (a patch, removed). Now FillMouse and wxWasmInTouchPoint give wx (targetY/canvasY) the
# position inside #main-window, as a desktop toolkit gives positions inside the window's client area; clientY and
# screenY stay the page's. With no header (top 0) nothing changes. Trees without wxPageMainTop (no off-thread input) skip.
# The recipe's own lines (targetY = cy ...) stay as they are and a line after them takes the header off: the off-thread
# recipe's applied-check looks for its lines word for word, and a first form that rewrote them made every later
# apply.sh fail ("owx-cpp.diff" hunks FAILED). That first form is turned into this one.
import sys
p = 'src/wasm/app.cpp'
s = open(p).read()
if '(z55b)' in s:
    sys.exit(0)
if 'wxPageMainTop' not in s or 'static void FillMouse(' not in s:
    print('z55: no page-input block with a page header offset here, skipped'); sys.exit(0)

# the first form (rewrote the recipe's lines): back to the recipe's text
first = [
    ('''// the page's header height above #main-window (z55): wx positions start under it
static int wxWasmPageTop() { return EM_ASM_INT({ return wxPageMainTop | 0; }); }

''', ''),
    ('''    const int top = wxWasmPageTop();   // (z55) wx's position is inside #main-window, under the page's header
    m.targetX = cx; m.targetY = cy - top;
    m.canvasX = cx; m.canvasY = cy - top;
''', '''    m.targetX = cx; m.targetY = cy;   // the document was the target: targetX == clientX
    m.canvasX = cx; m.canvasY = cy;
'''),
    ('''    const int top = wxWasmPageTop();   // (z55) wx's position is inside #main-window, under the page's header
    p.targetX = cx; p.targetY = cy - top; p.canvasX = cx; p.canvasY = cy - top;
''', '''    p.targetX = cx; p.targetY = cy; p.canvasX = cx; p.canvasY = cy;   // the document was the target: targetX == clientX
'''),
]
for a, b in first:
    s = s.replace(a, b)

helper_a = 'static void FillMouse(EmscriptenMouseEvent& m,'
helper_b = '''// the page's header height above #main-window (z55b): wx positions start under it
static int wxWasmPageTop() { return EM_ASM_INT({ return wxPageMainTop | 0; }); }

''' + helper_a

mouse_a = '''    m.targetX = cx; m.targetY = cy;   // the document was the target: targetX == clientX
    m.canvasX = cx; m.canvasY = cy;
'''
mouse_b = mouse_a + '''    { const int top = wxWasmPageTop(); m.targetY -= top; m.canvasY -= top; }   // (z55b) inside #main-window, under the page's header
'''

touch_a = '''    p.targetX = cx; p.targetY = cy; p.canvasX = cx; p.canvasY = cy;   // the document was the target: targetX == clientX
'''
touch_b = touch_a + '''    { const int top = wxWasmPageTop(); p.targetY -= top; p.canvasY -= top; }   // (z55b) inside #main-window, under the page's header
'''

for a, b in ((helper_a, helper_b), (mouse_a, mouse_b), (touch_a, touch_b)):
    assert s.count(a) == 1, 'z55: expected text not found once: ' + a[:60]
    s = s.replace(a, b)
open(p, 'w').write(s)
print('z55: mouse/touch below the page header')
