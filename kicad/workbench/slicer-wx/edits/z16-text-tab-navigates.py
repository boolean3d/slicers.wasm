# Tab in a text box moves to the next control, as on desktop; only a box made with wxTE_PROCESS_TAB takes the Tab
# as a character (wxMSW wxTextCtrl::MSWShouldPreProcessMessage / GTK: a GtkEntry never takes Tab). wxUniv's
# wxTextCtrl::OnChar inserted every key with a Unicode value, Tab (9) included, so after z10 made Tab a char an
# Orca dialog box got a tab character instead of moving on. Now a Tab without wxTE_PROCESS_TAB is skipped, and
# z10's app.cpp turns the unhandled char into navigation. Needs z10..
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/univ/textctrl.cpp', '''        int keycode = event.GetKeyCode();
#if wxUSE_UNICODE
        wxChar unicode = event.GetUnicodeKey();
#endif
        if ( keycode == WXK_RETURN )''', '''        int keycode = event.GetKeyCode();
#if wxUSE_UNICODE
        wxChar unicode = event.GetUnicodeKey();
#endif
        if ( keycode == WXK_TAB && !(GetWindowStyle() & wxTE_PROCESS_TAB) )
        {
            // not ours: the window moves the keyboard to the next control
            event.Skip();
            return;
        }
        if ( keycode == WXK_RETURN )''')
