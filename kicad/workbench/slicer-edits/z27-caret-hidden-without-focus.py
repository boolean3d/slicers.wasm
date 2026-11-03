# A text box that loses the focus shows no caret, as wxMSW (native EDIT: the system caret goes with the focus) and wxGTK
# (GtkEntry) do. The port uses wx's generic caret without overlays; its OnKillFocus "blinked" the caret out and back in to
# redraw it hollow, but the non-overlay Refresh() always fills it black, so a solid bar stayed where the focused box was:
# Orca's settings showed a caret in a field nobody had clicked after a tab switch (typed into a box, then clicked
# Strength/Others: the bar left by the box under it, e.g. "Top shell thickness", "Skirt loops"). Now losing the focus
# hides the caret (the box repaints the spot) and getting it back shows it at once, then it blinks as before.
#.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/generic/caret.cpp', '''void wxCaret::OnSetFocus()
{
    m_hasFocus = true;

    if ( IsVisible() )
        Refresh();
}

void wxCaret::OnKillFocus()
{
    m_hasFocus = false;
''', '''void wxCaret::OnSetFocus()
{
    m_hasFocus = true;

#ifdef __WXWASM__
    // as wxMSW: the caret comes back with the focus, drawn at once
    if ( IsVisible() && m_blinkedOut )
        Blink();
    return;
#endif
    if ( IsVisible() )
        Refresh();
}

void wxCaret::OnKillFocus()
{
    m_hasFocus = false;

#ifdef __WXWASM__
    // as wxMSW: no caret without the focus. The window repaints the spot (the
    // non-overlay erase paints white, wrong on a coloured or hidden window)
    if ( IsVisible() && !m_blinkedOut )
    {
        m_blinkedOut = true;
        GetWindow()->RefreshRect(wxRect(m_x, m_y, m_width, m_height));
#ifndef wxHAS_CARET_USING_OVERLAYS
        if ( m_xOld != -1 && (m_xOld != m_x || m_yOld != m_y) )
            GetWindow()->RefreshRect(wxRect(m_xOld, m_yOld, m_width, m_height));
        m_xOld =
        m_yOld = -1;
#endif
    }
    return;
#endif
''')

# shown while another window has the focus (m_hasFocus starts true): the timer runs, nothing is drawn until the focus comes
sub('src/generic/caret.cpp', '''    if ( blinkTime )
        m_timer.Start(blinkTime);

    if ( m_blinkedOut )
        Blink();
}''', '''    if ( blinkTime )
        m_timer.Start(blinkTime);

#ifdef __WXWASM__
    m_hasFocus = wxWindow::FindFocus() == GetWindow();
    if ( !m_hasFocus )
        return;
#endif
    if ( m_blinkedOut )
        Blink();
}''')
