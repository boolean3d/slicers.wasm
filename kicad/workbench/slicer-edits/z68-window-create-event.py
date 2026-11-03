# A window says it exists (z68: wxWindowWasm::Create sends wxEVT_CREATE, as wxMSW (MSWCreate))
# and wxGTK (GTKHandleRealized) do for every window. The port never sent it. wxCompositeWindow (generic wxSearchCtrl,
# wxComboCtrl/wxComboBox in wxUniv, generic spin/date/time controls, wxDataView editors) hooks its parts' focus and key
# events when a part's create event comes up to it (include/wx/compositewin.h OnWindowCreate), so in the browser those
# controls never forwarded their parts' keys or focus to the control, unlike desktop (KiCad: the symbol chooser filter,
# Project Template Selector search and Find combo took no typing). The event is a command event, so it goes up to the
# parent; it is sent right after the window joins its parent, as wxMSW does inside Create (compositewin.h relies on that:
# the part is not yet stored in the composite's member). Only lines are added. Trees without the anchor skip.
import sys
p = 'src/wasm/window.cpp'
s = open(p).read()
if '(z68)' in s:
    sys.exit(0)
a = "    wxWindowWasm::DoMoveWindow(x, y, w, h);   // this class's own, not a derived control's\n"
if s.count(a) != 1:
    print('z68: anchor not found once in', p, ', skipped'); sys.exit(0)
add = '''
    // (z68) the window says it exists, as wxMSW/wxGTK: the event goes up to the parent, where a composite control
    // (wxSearchCtrl, wxComboCtrl, spin/date controls) hooks its parts' focus and key events
    wxWindowCreateEvent createEvent(static_cast<wxWindow*>(this));
    createEvent.SetEventObject(this);
    HandleWindowEvent(createEvent);
'''
s = s.replace(a, a + add, 1)
open(p, 'w').write(s)
print('z68: create event sent')
