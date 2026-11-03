# A window's own background colour wins in every state, as on wxGTK (GTKSendPaintEvents fills with
# m_backgroundColour whenever one is set, disabled, hovered or pressed alike). The wasm theme's colour scheme
# (copied from wxUniv's win32 theme) used the set colour only when the window had no state flags: a window that
# inherits colours and is disabled (every window behind a modal dialog), hovered or focused was painted the theme's
# control grey #E6E6E6 instead. Bambu's and Orca's tab bars (ButtonsListCtrl, a wxControl set to #3B4446) showed a
# light grey strip right of the tabs while the Setup Wizard was open (Orca: from start), desktop dark.
# Theme state colours stay for windows without a colour of their own.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/univ/themes/wasm.cpp', '''        // the colour set by the user should be used for the normal state
        // and for the states for which we don't have any specific colours
        if ( !col.IsOk() || (flags != 0) )''', '''        // the colour set by the user is used in every state (wxGTK); the theme's state colours only for
        // windows without one
        if ( !col.IsOk() )''')
