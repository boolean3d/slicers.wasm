# Leaving the page with unsaved work: the browser's beforeunload runs the app's close event, and the slicer asks
# "Save the project?" in a modal dialog. A modal loop suspends the wasm stack (JSPI), which beforeunload cannot do
# ("SuspendError: trying to suspend without WebAssembly.promising"; the browser gives no time for a dialog anyway).
# While the close event runs from beforeunload, a wxModalDialogHook (wx's own way to answer a modal dialog without
# showing it) answers every modal Cancel at once, as Escape would. The slicer then vetoes the close and the callback
# returns a string, so the browser asks "Leave site?" itself: the desktop's "unsaved changes" stop, in the browser's
# words. Nothing unsaved: no dialog, no veto, the page leaves. Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/app.cpp', '#include "wx/window.h"\n', '#include "wx/window.h"\n#include "wx/modalhook.h"\n')
sub('src/wasm/app.cpp', '''    wxApp* app = static_cast<wxApp*>(userData);

    wxCloseEvent event(wxEVT_CLOSE_WINDOW);
    event.SetCanVeto(true);
    app->HandleCloseEvent(&event);
''', '''    wxApp* app = static_cast<wxApp*>(userData);

    // no modal dialog can run inside beforeunload: each one answers Cancel without showing
    class UnloadModalHook : public wxModalDialogHook
    {
    protected:
        int Enter(wxDialog*) wxOVERRIDE { return wxID_CANCEL; }
        void Exit(wxDialog*) wxOVERRIDE { }
    } hook;
    hook.Register();

    wxCloseEvent event(wxEVT_CLOSE_WINDOW);
    event.SetCanVeto(true);
    app->HandleCloseEvent(&event);
    hook.Unregister();
''')
