# The mouse wheel goes up the window tree until a window uses it, as on the desktop: wxMSW returns an unprocessed
# WM_MOUSEWHEEL to DefWindowProc, which hands it to the parent; GTK propagates an unhandled scroll-event to the
# parent widget. The port gave it only to the window under the mouse, so over a picture, a label or a plain panel
# inside a scrolled window nothing scrolled (PrusaSlicer's wizard printer pages: the CORE family could not be
# reached with the wheel). Stops at the top-level window. Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/app.cpp', '''    wxPoint mousePosition = wxGetMousePosition();
    event->SetPosition(mousePosition);
    wxWindow *window = GetMouseWindow(mousePosition);

    if (window != NULL)
    {
        SendMouseEventToWindow(event, window);
    }
}''', '''    wxPoint mousePosition = wxGetMousePosition();
    wxWindow *window = GetMouseWindow(mousePosition);

    // unused by a window: its parent gets it (desktop), up to the top-level window
    for ( ; window != NULL; window = window->GetParent())
    {
        if (window->IsEnabled())
        {
            wxMouseEvent copy(*event);
            copy.SetPosition(window->ScreenToClient(mousePosition));
            copy.SetEventObject(window);
            copy.SetId(window->GetId());
            if (window->HandleWindowEvent(copy))
                break;
        }
        if (window->IsTopLevel())
            break;
    }
}''')
