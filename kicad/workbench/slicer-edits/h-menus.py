# Menus look and behave like GTK menus (the Linux desktop app is the answer key, Adwaita theme):
# - items are enabled/disabled before the menu shows (wxGTK sends wxEVT_UPDATE_UI on map, wxMSW on WM_INITMENUPOPUP).
#   wxUniv's popup menus never did, so "Recent projects" or "Show Project in Folder" stayed black and clickable when
#   the program meant them off. Popup menus and menu bar menus now call wxMenu::UpdateUI first.
# - a menu opened by the mouse has no item selected (GTK); wxUniv selected the first item of every popup menu.
# - white menu (was 0xe6e6e6), 1 px #cdc7c2 edge (CSS outline, class "menu"; was a dark grey border), 3 px above the
#   first and below the last item, 1 px #e6e6e6 separators with no extra space (were 3 px dark lines + 8 px space),
#   label 5 px further right, text #2e3436.
# - the theme's selection colour is Adwaita's #3584e4 (menus, lists, checks; was purple 0xd56464), disabled text
#   #929595 (was 0x757575).
# - accelerators read as GTK writes them: Shift+Ctrl+S (modifier order Shift, Ctrl, Alt), not Ctrl+Shift+S.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

M = 'src/univ/menu.cpp'
# the menu window: no wx border (the page draws the edge), white
sub(M, '''    ResetCurrent();

    (void)Create(parent, wxBORDER_STATIC);

    SetCursor(wxCURSOR_ARROW);
}''', '''    ResetCurrent();

#ifdef __WXWASM__
    // GTK menu: white, a 1 px edge drawn by the page around the window (CSS class "menu")
    (void)Create(parent, wxBORDER_NONE);
    SetBackgroundColour(*wxWHITE);
    SetForegroundColour(wxColour(0x2e, 0x34, 0x36));
#else
    (void)Create(parent, wxBORDER_STATIC);
#endif

    SetCursor(wxCURSOR_ARROW);
}''')

sub(M, '''    // override the base class version to select the first item initially
    virtual void Popup(wxWindow *focus = NULL);
''', '''    // override the base class version to select the first item initially
    virtual void Popup(wxWindow *focus = NULL);

#ifdef __WXWASM__
    virtual wxString GetCSSClassList() const wxOVERRIDE
        { return wxPopupTransientWindow::GetCSSClassList() + " menu"; }
#endif
''')

# popup menus: update items first, no preselected item
sub(M, '''    menu->Popup(ClientToScreen(wxPoint(x, y)), wxSize(0,0));
''', '''#ifdef __WXWASM__
    // as wxGTK: enable/check the items first, and nothing is selected in a menu opened by the mouse
    menu->UpdateUI();
    menu->Popup(ClientToScreen(wxPoint(x, y)), wxSize(0,0), false);
#else
    menu->Popup(ClientToScreen(wxPoint(x, y)), wxSize(0,0));
#endif
''')

sub(M, '''        // remember the menu we show
        m_menuShown = GetMenu(m_current);
''', '''        // remember the menu we show
        m_menuShown = GetMenu(m_current);
#ifdef __WXWASM__
        // as wxGTK: enable/check the items before the menu shows
        m_menuShown->UpdateUI();
#endif
''')

# the menu's text colour (DrawLabel uses the DC's colour; the selected item switches to HIGHLIGHT_TEXT and back)
sub(M, '''    wxDC& dc = renderer->GetDC();
    dc.SetFont(wxSystemSettings::GetFont(wxSYS_DEFAULT_GUI_FONT));

    // FIXME: this should be done in the renderer''', '''    wxDC& dc = renderer->GetDC();
    dc.SetFont(wxSystemSettings::GetFont(wxSYS_DEFAULT_GUI_FONT));
#ifdef __WXWASM__
    dc.SetTextForeground(GetForegroundColour());
#endif

    // FIXME: this should be done in the renderer''')

W = 'src/univ/themes/wasm.cpp'
sub(W, '''        case HIGHLIGHT:         return wxColour(0xd56464);''', '''        case HIGHLIGHT:         return wxColour(0x35, 0x84, 0xe4);   // Adwaita selected bg''')
sub(W, '''        case CONTROL_TEXT_DISABLED:
                                return wxColour(0x757575);''', '''        case CONTROL_TEXT_DISABLED:
                                return wxColour(0x92, 0x95, 0x95);   // Adwaita insensitive text''')

sub(W, '''static const wxCoord MENU_LEFT_MARGIN = 12;''', '''static const wxCoord MENU_LEFT_MARGIN = 17;''')
sub(W, '''static const wxCoord MENU_SEPARATOR_HEIGHT = 3;''', '''static const wxCoord MENU_SEPARATOR_HEIGHT = 1;

// space above the first and below the last item (GTK menu padding)
static const wxCoord MENU_POPUP_PADDING = 3;''')

# the selected item keeps the menu's own text colour afterwards (was reset to CONTROL_TEXT)
sub(W, '''    if ( flags & wxCONTROL_SELECTED && !(flags & wxCONTROL_DISABLED) )
    {
        DrawBackground(dc, wxSCHEME_COLOUR(m_scheme, HIGHLIGHT), rect);
        dc.SetTextForeground(wxSCHEME_COLOUR(m_scheme, HIGHLIGHT_TEXT));
    }
''', '''    const wxColour textColour = dc.GetTextForeground();
    if ( flags & wxCONTROL_SELECTED && !(flags & wxCONTROL_DISABLED) )
    {
        DrawBackground(dc, wxSCHEME_COLOUR(m_scheme, HIGHLIGHT), rect);
        dc.SetTextForeground(wxSCHEME_COLOUR(m_scheme, HIGHLIGHT_TEXT));
    }
''')
sub(W, '''    if ( flags & wxCONTROL_SELECTED && !(flags & wxCONTROL_DISABLED) )
    {
        dc.SetTextForeground(wxSCHEME_COLOUR(m_scheme, CONTROL_TEXT));
    }
}''', '''    if ( flags & wxCONTROL_SELECTED && !(flags & wxCONTROL_DISABLED) )
    {
        dc.SetTextForeground(textColour);
    }
}''')

sub(W, '''    y += MENU_VERT_MARGIN;
    dc.SetPen(m_penMediumGrey);
    dc.DrawLine(0, y, geomInfo.GetSize().x + 1, y);''', '''    dc.SetPen(wxPen(wxColour(0xe6, 0xe6, 0xe6)));
    dc.DrawLine(0, y, geomInfo.GetSize().x + 1, y);''')

# geometry: separators take no margin; padding above the first and below the last item
sub(W, '''    wxCoord height = 0;

    // the max length of label and accel strings''', '''    wxCoord height = MENU_POPUP_PADDING;

    // the max length of label and accel strings''')
sub(W, '''        h += 2*MENU_VERT_MARGIN;

        // remember the item position and height''', '''        if ( !item->IsSeparator() )
            h += 2*MENU_VERT_MARGIN;

        // remember the item position and height''')
sub(W, '''    gi->m_size.y = height;

    return gi;''', '''    gi->m_size.y = height + MENU_POPUP_PADDING;

    return gi;''')

# GTK's accelerator labels: Shift+Ctrl+Alt+key
sub(W, '''        return modifiers + current;
    }
    else
    {
        return accel;
    }
}''', '''        return modifiers + current;
    }
    else
    {
        // as gtk_accelerator_get_label: modifiers in the order Shift, Ctrl, Alt, then the key
        wxString key = accel;
        key.Trim(true);
        bool shift = false, ctrl = false, alt = false;
        for ( ;; )
        {
            int sep = key.find_first_of(wxT("+-"));
            if ( sep <= 0 || sep == (int)key.length() - 1 )
                break;
            const wxString mod = key.Left(sep);
            if ( CompareAccelString(mod, wxTRANSLATE("shift")) ) shift = true;
            else if ( CompareAccelString(mod, wxTRANSLATE("ctrl")) || CompareAccelString(mod, wxTRANSLATE("rawctrl")) ) ctrl = true;
            else if ( CompareAccelString(mod, wxTRANSLATE("alt")) ) alt = true;
            else break;
            key = key.Mid(sep + 1);
        }
        wxString label;
        if ( shift ) label += wxT("Shift+");
        if ( ctrl ) label += wxT("Ctrl+");
        if ( alt ) label += wxT("Alt+");
        return label + key;
    }
}''')

def add_css(css, marker):
    p = 'build/wasm/template.html'
    s = open(p).read()
    if marker in s: return
    assert s.count('    </style>') == 1, p
    open(p, 'w').write(s.replace('    </style>', css + '    </style>'))

add_css('''      /* a GTK menu's edge */
      .window.menu {
        outline: 1px solid #cdc7c2;
      }

''', '.window.menu {')
