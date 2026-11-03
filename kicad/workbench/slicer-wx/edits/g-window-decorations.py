# Windows other than the main frame get the decorations a desktop window manager gives them on Linux (wxGTK rules,
# src/gtk/toplevel.cpp: m_gdkDecor), drawn by the port since a browser page has no window manager:
# - a title bar only if the window asked for one (wxCAPTION) and is not borderless (wxNO_BORDER / wxSIMPLE_BORDER
#   switch decorations off in wxGTK). Before, every non-main window got a title bar whatever its style, so the
#   slicers' own frameless popups and dialogs that draw their own title (Bambu's DPIDialog with its own header) got
#   a second grey bar.
# - a close box only with wxCLOSE_BOX.
# - a decorated window gets a frame: 1 px edge and a drop shadow (CSS class "decorated", box-shadow on the window's
#   element, outside its area, so client coordinates are unchanged). Before, a dialog had no edge at all and its
#   white page ran into the white page behind it.
# - the title bar looks like a desktop one (Adwaita colours: #ebebeb bar, #2e3436 bold centred title, thin close
#   cross, 1 px #d5d0cc line under the bar) and is 30 px high (was 22 px, grey 200).
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if a not in s and ('wxpage_' in s or 'wxInWorker' in s): return   # off-thread recipe already reshaped this spot (edits-guard.py)
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

T = 'src/wasm/toplevel.cpp'
sub(T, '''static const wxCoord TITLE_BAR_HEIGHT = 22;
static const wxColour TITLE_BAR_BACKGROUND_COLOUR(200, 200, 200);
static const wxColour TITLE_BAR_FOREGROUND_COLOUR(40, 40, 40);
''', '''static const wxCoord TITLE_BAR_HEIGHT = 30;
static const wxColour TITLE_BAR_BACKGROUND_COLOUR(0xeb, 0xeb, 0xeb);
static const wxColour TITLE_BAR_FOREGROUND_COLOUR(0x2e, 0x34, 0x36);
static const wxColour TITLE_BAR_LINE_COLOUR(0xd5, 0xd0, 0xcc);
''')

sub(T, '''    SetTitle(title);

    return true;
}''', '''    SetTitle(title);

    // the frame (edge and shadow) of a decorated window, drawn by the page around the window's element
    EM_ASM({
        var e = document.getElementById('window-' + $0);
        if (e) e.classList.toggle('decorated', !!$1);
    }, GetCSSId(), HasTitleBar());

    return true;
}''')

sub(T, '''    // Main frame already has a native title bar.
    return !IsMainFrame() && !(GetWindowStyle() & wxFRAME_NO_TASKBAR);''', '''    // Main frame already has a native title bar (the browser's). Others as wxGTK: decorated with wxCAPTION unless
    // borderless.
    const long style = GetWindowStyle();
    return !IsMainFrame() && (style & wxCAPTION) && !(style & (wxNO_BORDER | wxSIMPLE_BORDER));''')

# the close cross: thin, smaller, only with wxCLOSE_BOX; the line under the bar
sub(T, '''        DrawTitleText(dc, ncRect);
        DrawMinimizeButton(dc, ncRect);''', '''        dc.SetPen(wxPen(TITLE_BAR_LINE_COLOUR, 1));
        dc.DrawLine(0, TITLE_BAR_HEIGHT - 1, ncRect.width, TITLE_BAR_HEIGHT - 1);

        DrawTitleText(dc, ncRect);
        if (GetWindowStyle() & wxCLOSE_BOX)
            DrawMinimizeButton(dc, ncRect);
        else
            m_minimizeButtonRect = wxRect();''')

sub(T, '''    dc.SetPen(wxPen(TITLE_BAR_FOREGROUND_COLOUR, 2));
''', '''    dc.SetPen(wxPen(TITLE_BAR_FOREGROUND_COLOUR, 1));
''')

sub(T, '''static const wxCoord MINIMIZE_BUTTON_SIZE = 16;
static const wxCoord MINIMIZE_BUTTON_PADDING = 3;''', '''static const wxCoord MINIMIZE_BUTTON_SIZE = 22;
static const wxCoord MINIMIZE_BUTTON_PADDING = 7;''')

# the title is measured with the font it is drawn with (was measured with the DC's font, drawn bold)
sub(T, '''    wxCoord textWidth;
    wxCoord textHeight;
    dc.GetTextExtent(GetTitle(), &textWidth, &textHeight);

    int textX = wxMax((rect.width - textWidth) / 2, 0);
    int textY = wxMax((rect.height - textHeight) / 2, 0);

    wxFont font = wxSystemSettings::GetFont(wxSYS_DEFAULT_GUI_FONT).Bold();
''', '''    wxFont font = wxSystemSettings::GetFont(wxSYS_DEFAULT_GUI_FONT).Bold();

    wxCoord textWidth;
    wxCoord textHeight;
    dc.GetTextExtent(GetTitle(), &textWidth, &textHeight, NULL, NULL, &font);

    int textX = wxMax((rect.width - textWidth) / 2, 0);
    int textY = wxMax((rect.height - textHeight) / 2, 0);
''')

def add_css(css, marker):
    p = 'build/wasm/template.html'
    s = open(p).read()
    if marker in s: return
    assert s.count('    </style>') == 1, p
    open(p, 'w').write(s.replace('    </style>', css + '    </style>'))

add_css('''      /* a window with window-manager decorations (title bar drawn by the port): its edge and shadow */
      .window.decorated {
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.23), 0 2px 8px 1px rgba(0, 0, 0, 0.25);
      }

''', '.window.decorated {')
