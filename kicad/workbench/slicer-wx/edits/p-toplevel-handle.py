# A created top-level window has a handle (its page element's id), as a wxGTK one has its GtkWidget. wxTopLevelWindowBase::
# Destroy (src/common/toplvcmn.cpp) only delays the delete (wxPendingDelete, done at idle, and dropped again by the
# window's destructor) when GetHandle() is set; with the port's NULL it deleted at once. Code that Destroy()s a dialog it
# holds on the stack (PrusaSlicer PresetUpdater::perform_updates: progress_dialog.Destroy(), fine on every desktop)
# then deleted a stack object and destroyed it a second time on scope exit: the page threw in destroyWindow
# ("reading 'window'") and the setup wizard's Finish never applied the chosen printer. Also lets wxDisplay::GetFromWindow
# find a window's display and wxWindowBase::Destroy send its destroy event, as on wxGTK. Child windows keep NULL
# (their Destroy deletes at once on every port).
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('include/wx/wasm/nonownedwnd.h', '''    int GetCSSId() const { return m_cssId; }
''', '''    int GetCSSId() const { return m_cssId; }

    // the page element's id once created (never 0: ids start at 1), NULL before: as wxGTK's GtkWidget, it tells
    // a created window (delayed Destroy, wxDisplay::GetFromWindow, destroy event)
    virtual WXWidget GetHandle() const wxOVERRIDE
        { return m_cssId != wxID_NONE ? reinterpret_cast<WXWidget>(static_cast<wxIntPtr>(m_cssId)) : NULL; }
''')
