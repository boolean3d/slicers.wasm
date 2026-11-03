# A window's WarpPointer does nothing, quietly (z76, kicad-gerbers 10-28). A browser page cannot move the pointer (only
# Pointer Lock hides it, and that needs a user gesture), so the port's wxWindow::WarpPointer can only refuse. It refused
# with wxFAIL_MSG, an assert on every call: KiCad warps on every wheel notch while "Center and warp cursor on zoom" is on
# (its default: WX_VIEW_CONTROLS::onWheel -> CenterOnCursor -> KIPLATFORM::UI::WarpPointer -> wxWindow::WarpPointer),
# on arrow-key cursor moves and on autopan. wxGTK under Wayland does the same quiet nothing (gdk_device_warp is a no-op
# there); the program learns the warp failed from its own platform layer (KiCad: kiplatform-wasm WarpPointer now returns
# false, fixes/kicad-mouse.diff, which also turns cursor warping off in the browser so the wheel zooms about the cursor).
# Cause of the wheel zooming toward the top-left (kg7-14 -> kg7-16): each notch moved the point under the cursor to the
# view centre (SetCenter) and the warp that should have followed the cursor there never happened; three notches from
# (650,300) put the sheet corner at (511,266) by that model, (503,264) on screen. Positions and button state in the port
# are right: wxGetMousePosition / wxGetMouseState come from wxApp::m_mouseState, set from every mouse event before it is
# sent (app.cpp UpdateMouseState), buttons from the DOM 'buttons' field (mouse.cpp SetMouseState).
# Every tree; run in owx or pwx.
import sys
p = 'src/wasm/window.cpp'
s = open(p).read()
if '(z76)' in s:
    sys.exit(0)
a = '''void wxWindowWasm::WarpPointer(int WXUNUSED(x), int WXUNUSED(y))
{
    wxFAIL_MSG("WarpPointer is not supported");
}
'''
if s.count(a) != 1:
    print('z76: WarpPointer anchor not found once in', p, ', skipped'); sys.exit(0)
s = s.replace(a, '''void wxWindowWasm::WarpPointer(int WXUNUSED(x), int WXUNUSED(y))
{
    // (z76) a page cannot move the pointer: nothing happens, as wxGTK under Wayland (no assert on every call)
}
''', 1)
open(p, 'w').write(s)
print('z76: WarpPointer quiet')
