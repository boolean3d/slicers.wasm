# Clicks inside a transient popup reach the window under the mouse. wxPopupTransientWindow captures the mouse when
# shown (to see a click outside it and close), and the port gave every captured event to the capturing window, so the
# rows, buttons and links inside a popup never got their clicks (Bambu Studio's printer list). GTK's pointer grab
# and wxOSX's OnIdle release do the same thing this does: inside the popup, the window under the mouse; outside, the
# capturing window. Run in owx.
def sub(p, a, b, done=None):
    s = open(p).read()
    if (done or b) in s: return   # done: the edit's mark where a tree carries it at another spot (prusa's wx 3.2)
    assert s.count(a) == 1, (p, a)
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/app.cpp', '''    wxWindow *captureWindow = wxWindow::GetCapture();
    if (captureWindow != NULL)
    {
        return captureWindow;
    }''', '''    wxWindow *captureWindow = wxWindow::GetCapture();
    if (captureWindow != NULL)
    {
#if wxUSE_POPUPWIN
        // a transient popup captures the mouse to hear clicks outside it; inside it, the window under the mouse
        wxWindow *popup = wxGetTopLevelParent(captureWindow);
        if (wxDynamicCast(popup, wxPopupTransientWindow) && popup->IsShown())
        {
            wxWindow *under = wxFindWindowAtPoint(position);
            if (under != NULL && wxGetTopLevelParent(under) == popup)
                return under;
        }
#endif
        return captureWindow;
    }''')

s = open('src/wasm/app.cpp').read()
if 'wx/popupwin.h' not in s:
    a = '#include "wx/wxprec.h"\n'
    assert s.count(a) == 1
    open('src/wasm/app.cpp', 'w').write(s.replace(a, a + '#include "wx/popupwin.h"\n', 1))

# A modal dialog takes the mouse, as GTK's grab and Windows' capture change do: whoever held the capture is told it
# lost it (wxEVT_MOUSE_CAPTURE_LOST; a transient popup closes). Before, a popup that opened a dialog (Bambu's printer
# list -> access code) kept the capture and the dialog never got a click or a key.
sub('src/wasm/window.cpp', '''void wxWindowWasm::DoCaptureMouse()
{''', '''// a modal dialog takes the mouse (src/univ/dialog.cpp): the capture ends and its holders are told
/* static */ void wxWindowWasm::ModalTakesMouse()
{
    if (gs_captureWindow != NULL)
    {
        gs_captureWindow = NULL;
        wxWindowBase::NotifyCaptureLost();
    }
}

void wxWindowWasm::DoCaptureMouse()
{''')
sub('src/univ/dialog.cpp', '''            parent->AddChild(this);
    }

    Show(true);

    m_isShowingModal = true;''', '''            parent->AddChild(this);
    }

#ifdef __WXWASM__
    wxWindow::ModalTakesMouse();
#endif
    Show(true);

    m_isShowingModal = true;''', done='wxWindow::ModalTakesMouse();')

sub('include/wx/wasm/window.h', '''    virtual void Raise() wxOVERRIDE;''', '''    virtual void Raise() wxOVERRIDE;
    // a modal dialog takes the mouse: the capture ends, its holders get wxEVT_MOUSE_CAPTURE_LOST
    static void ModalTakesMouse();''')

# An empty bitmap (0 wide or high: Bambu's AMS external spool picture before it is sized) draws nothing, as on the
# desktop ports. Before, it reached the browser's ImageData, which throws; the throw left the wasm event handling
# mid-way and the app stopped taking clicks and repainting (after connecting a printer, Device tab).
sub('src/wasm/dc.cpp', '''    wxCHECK_RET(IsOk(), wxT("invalid dc"));

    bitmap.SyncToJs();

    EM_ASM({
        drawBitmap($0, $1, $2, $3);''', '''    wxCHECK_RET(IsOk(), wxT("invalid dc"));
    if (!bitmap.IsOk() || bitmap.GetWidth() <= 0 || bitmap.GetHeight() <= 0)
        return;

    bitmap.SyncToJs();

    EM_ASM({
        drawBitmap($0, $1, $2, $3);''')
