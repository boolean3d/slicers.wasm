# wxUniv's own scroll bars (m_scrollbarVert/Horz) are ordinary child windows, so app code that empties a
# window with DestroyChildren() deletes them too, and the window kept pointing at the freed scroll bar.
# The next size event (OnSize -> PositionScrollbars) called into freed memory: Bambu Studio and Orca died at
# start ("table index is out of bounds") once v-forced-size-event.py made sizers send size events as wxMSW and
# wxGTK do; the path was HMSPanel's m_scrolledWindow->DestroyChildren(), then MonitorPanel::show_status ->
# Layout. wxUniv's own destructor already clears the pointers before DestroyChildren for the same reason
# (winuniv.cpp ~wxWindow); this does it for every removal: a removed child that is one of our scroll bars
# clears its pointer, and wxWindow::SetScrollbar makes a new one when the scrolled window next needs it.
# Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('include/wx/univ/window.h', '''    virtual bool IsClientAreaChild(const wxWindow *child) const wxOVERRIDE
    {''', '''    // a removed child that is one of our scroll bars (DestroyChildren() deletes them too) must not stay pointed at
    virtual void RemoveChild(wxWindowBase *child) wxOVERRIDE;

    virtual bool IsClientAreaChild(const wxWindow *child) const wxOVERRIDE
    {''')

sub('src/univ/winuniv.cpp', '''void wxWindow::RefreshScrollbars()
{''', '''void wxWindow::RemoveChild(wxWindowBase *child)
{
#if wxUSE_SCROLLBAR
    if ( child == (wxWindowBase *)m_scrollbarVert )
        m_scrollbarVert = NULL;
    if ( child == (wxWindowBase *)m_scrollbarHorz )
        m_scrollbarHorz = NULL;
#endif // wxUSE_SCROLLBAR

    wxWindowNative::RemoveChild(child);
}

void wxWindow::RefreshScrollbars()
{''')
