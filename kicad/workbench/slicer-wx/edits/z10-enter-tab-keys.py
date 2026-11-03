# Enter and Tab reach the program as keys, as on desktop (wxGTK/wxMSW send wxEVT_CHAR for both; an unhandled Tab
# moves the keyboard to the next control, Shift+Tab back). The wasm port made a char event only for keys whose
# browser name is one letter ("Enter" and "Tab" are not) and Tab was in no list, so neither ever became a char:
# a settings box never saw Enter (no wxEVT_TEXT_ENTER: Orca's layer height typed after a slice stayed uncommitted,
# Slice plate stayed grey) and Tab never left the box. Now both go the way of Escape/Backspace (key down, then char
# if nobody took the key down), and a Tab nobody took is navigation (wxWindowBase::HandleAsNavigationKey, as
# wx's generic controls do)..
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/keyboard.cpp', '''    switch (keyCode)
    {
        case WXK_ESCAPE:
        case WXK_BACK:''', '''    switch (keyCode)
    {
        case WXK_RETURN:
        case WXK_NUMPAD_ENTER:
        case WXK_TAB:
        case WXK_ESCAPE:
        case WXK_BACK:''')

sub('src/wasm/app.cpp', '''                    if (!app->HandleKeyEvent(&event))
                    {
                        wxKeyEvent charEvent(wxEVT_CHAR, event);
                        app->HandleKeyEvent(&charEvent);
                    }''', '''                    if (!app->HandleKeyEvent(&event))
                    {
                        wxKeyEvent charEvent(wxEVT_CHAR, event);
                        if (!app->HandleKeyEvent(&charEvent))
                        {
                            // a Tab nobody took moves the keyboard on, as the desktop toolkits do natively
                            wxWindow *focus = wxWindow::FindFocus();
                            if (focus && focus->IsEnabled())
                                focus->HandleAsNavigationKey(charEvent);
                        }
                    }''')
