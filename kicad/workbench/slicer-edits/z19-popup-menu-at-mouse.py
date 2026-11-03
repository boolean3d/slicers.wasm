# PopupMenu(menu) with no position opens the menu at the mouse, as wxMSW does (src/msw/window.cpp
# wxWindowMSW::DoPopupMenu: x == wxDefaultCoord && y == wxDefaultCoord -> ScreenToClient(wxGetMousePosition())) and
# wxGTK does (menu at the pointer). wxUniv's DoPopupMenu took (-1,-1) as a client point, so every menu opened without a
# position (PrusaSlicer's cog "Add physical printer" menu, Plater right-click menus that pass none) popped at the
# window's top-left corner..
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/univ/menu.cpp', '''#ifdef __WXWASM__
    // as wxGTK: enable/check the items first, and nothing is selected in a menu opened by the mouse
    menu->UpdateUI();''', '''#ifdef __WXWASM__
    // as wxMSW: no position given = at the mouse
    if ( x == wxDefaultCoord && y == wxDefaultCoord )
    {
        const wxPoint mouse = ScreenToClient(wxGetMousePosition());
        x = mouse.x;
        y = mouse.y;
    }
    // as wxGTK: enable/check the items first, and nothing is selected in a menu opened by the mouse
    menu->UpdateUI();''')
