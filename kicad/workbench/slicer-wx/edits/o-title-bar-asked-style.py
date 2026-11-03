# A top-level window keeps the style its caller asked for. wxUniv's wxWindow::Create (src/univ/winuniv.cpp) stores the
# style with the default border filled in, and a top-level window's default border is wxBORDER_NONE: edit g's title
# bar rule (wxCAPTION and not borderless, as wxGTK's m_gdkDecor in src/gtk/toplevel.cpp, which reads the style passed
# to Create) then saw every dialog as borderless, and none got a title bar (PrusaSlicer's setup wizard,
# wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER, came up with no title and no close box). The border is put back to the
# asked one after the base Create, as wxUniv's own wxTopLevelWindow::Create restores styleOrig (src/univ/topluniv.cpp);
# an unset border still resolves to the default (none) wherever it is drawn (wxWindowBase::GetBorder).
# Run in owx, after g (leaves g's text as it is, so g still sees itself applied).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

T = 'src/wasm/toplevel.cpp'
sub(T, '''        wxFAIL_MSG(wxT("wxTopLevelWindowWasm creation failed"));
        return false;
    }

    SetTitle(title);''', '''        wxFAIL_MSG(wxT("wxTopLevelWindowWasm creation failed"));
        return false;
    }

    // the border the caller asked for (the base Create stored the default one, wxBORDER_NONE, in its place)
    m_windowStyle = (m_windowStyle & ~wxBORDER_MASK) | (style & wxBORDER_MASK);

    SetTitle(title);''')
