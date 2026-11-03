# Double-clicks reach the program, as on desktop. The wasm port never made one: mouse.cpp takes the click count from
# event.detail only #ifdef HAS_MOUSE_DETAIL (Emscripten's mouse event has no detail), so every press was a plain
# LEFT_DOWN and no wxEVT_*_DCLICK ever happened: a double-click in a text box selected no word (PrusaSlicer's
# Object manipulation number boxes: double-click + type inserted into the old value), nor anything else that
# answers double-clicks (list rows, 3D view). Now, as GTK (gdk 2BUTTON_PRESS; wxGTK sends DOWN then DCLICK):
# a press of the same button within wxSYS_DCLICK_MSEC and wxSYS_DCLICK_X/Y of the previous press is sent as
# DOWN followed by DCLICK; a third press starts over (GTK's triple press makes no wx event). Times come from the
# browser event (taken before the input queue), not from when the queue runs. Run in owx/pwx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    # z15 later rewrites the mouse callback's queue call: the double-press helper marks this one as applied
    if 'MouseCallback' in a and 'static bool IsDoublePress(' in s: return
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/app.cpp', '''EM_BOOL MouseCallback(int eventType, const EmscriptenMouseEvent *e, void *userData)
{
    const EmscriptenMouseEvent copy = *e;
    wxWasmQueueInput([=]() { MouseCallbackNow(eventType, &copy, userData); });
    return true;
}''', '''// GTK's double press: same button, close in time and place to the press before, and not a third press
static bool IsDoublePress(int eventType, const EmscriptenMouseEvent *e)
{
    static double lastTime = -1e9;
    static long lastX = 0, lastY = 0;
    static int lastButton = -1;
    static bool lastWasDouble = false;
    if (eventType != EMSCRIPTEN_EVENT_MOUSEDOWN)
        return false;
    const bool isDouble = !lastWasDouble && e->button == lastButton
        && e->timestamp - lastTime <= wxSystemSettings::GetMetric(wxSYS_DCLICK_MSEC)
        && std::abs(e->screenX - lastX) <= wxSystemSettings::GetMetric(wxSYS_DCLICK_X)
        && std::abs(e->screenY - lastY) <= wxSystemSettings::GetMetric(wxSYS_DCLICK_Y);
    lastTime = e->timestamp; lastX = e->screenX; lastY = e->screenY; lastButton = e->button;
    lastWasDouble = isDouble;
    return isDouble;
}

EM_BOOL MouseCallback(int eventType, const EmscriptenMouseEvent *e, void *userData)
{
    const EmscriptenMouseEvent copy = *e;
    const bool isDouble = IsDoublePress(eventType, e);
    wxWasmQueueInput([=]() {
        MouseCallbackNow(eventType, &copy, userData);
        if (isDouble)
        {
            // wxGTK: the second press is a DOWN, then the DCLICK (gdk's 2BUTTON_PRESS)
            wxMouseEvent event;
            if (EmscriptenMouseEventToWXEvent(eventType, copy, &event))
            {
                event.SetEventType(event.GetEventType() == wxEVT_RIGHT_DOWN ? wxEVT_RIGHT_DCLICK
                                 : event.GetEventType() == wxEVT_MIDDLE_DOWN ? wxEVT_MIDDLE_DCLICK : wxEVT_LEFT_DCLICK);
                event.m_clickCount = 2;
                static_cast<wxApp*>(userData)->HandleMouseEvent(&event);
            }
        }
    });
    return true;
}''')

sub('src/wasm/app.cpp', '''#include "wx/modalhook.h"
''', '''#include "wx/modalhook.h"
#include "wx/settings.h"
#include <cstdlib>
''')
