# Controls paint their background the way wxGTK does (the Linux desktop app is the answer key):
# - static text and static bitmaps never paint a background: on GTK they have no window of their own, so the
#   parent's painting (Bambu's gradient title bars, white cards) shows through even when the program gave them a
#   background colour. wxUniv filled them with their colour (or the parent's plain colour). The port paints parents
#   before children and repaints the parent when a transparent child changes (wxWindowWasm::Invalidate), as
#   DirectFB does, so "transparent" is simply: paint nothing.
# - a borderless button (wxBORDER_NONE / wxNO_BORDER, GTK relief none) has no button face: it shows its own
#   background colour if the program set one, else the parent through it. The wasm theme filled every button with
#   its grey face (214,214,214), so every icon button (Bambu's ScalableButton: gear, +, -, edit dots) sat in a grey
#   square and empty placeholder icons ("dot") were grey squares.
# - a bitmap toggle button has no label: wxUniv's wxToggleButton took the stock label of a stock id, so Bambu's
#   Advanced switch (SwitchButton, id wxID_ABOUT) drew "About". wxGTK's toggle buttons never use stock labels.
# Run in owx.
def undo_double(p, a, b):
    # a tree that got an edit twice (before the already-applied check): put the single edit back
    s = open(p).read()
    bb = b.replace(a, b)
    if bb != b and bb in s: open(p, 'w').write(s.replace(bb, b))

def sub(p, a, b, n=1):
    undo_double(p, a, b)
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/univ/winuniv.cpp', '''    wxWindow * const parent = GetParent();
    if ( HasTransparentBackground() && !UseBgCol() && parent )
    {''', '''    wxWindow * const parent = GetParent();
#ifdef __WXWASM__
    // as wxGTK: a transparent control (static text, static bitmap, borderless button without a colour of its own)
    // shows what its parent painted, which the port paints first
    if ( HasTransparentBackground() && parent && !IsTopLevel() )
        return true;
#endif
    if ( HasTransparentBackground() && !UseBgCol() && parent )
    {''')

sub('include/wx/univ/anybutton.h', '''    static wxInputHandler *GetStdInputHandler(wxInputHandler *handlerDef);''', '''#ifdef __WXWASM__
    // a borderless button without a colour of its own has no face: the parent shows through (wxGTK relief none)
    virtual bool HasTransparentBackground() wxOVERRIDE
        { return (GetWindowStyle() & wxBORDER_MASK) == wxBORDER_NONE && !UseBgCol() && !GetBackgroundBitmap().IsOk(); }
#endif

    static wxInputHandler *GetStdInputHandler(wxInputHandler *handlerDef);''')

sub('src/univ/anybutton.cpp', '''    else
    {
        m_renderer->DrawButtonSurface(dc, wxTHEME_BG_COLOUR(this),
                                      rect, GetStateFlags());
    }

    return true;
}''', '''#ifdef __WXWASM__
    else if ( (GetWindowStyle() & wxBORDER_MASK) == wxBORDER_NONE )
    {
        // no button face (wxGTK relief none): the button's own colour if it has one, else nothing
        if ( UseBgCol() )
            m_renderer->DrawBackground(dc, GetBackgroundColour(), rect, 0);
    }
#endif
    else
    {
        m_renderer->DrawButtonSurface(dc, wxTHEME_BG_COLOUR(this),
                                      rect, GetStateFlags());
    }

    return true;
}''')

sub('src/univ/tglbtn.cpp', '''    wxString label(lbl);
    if (label.empty() && wxIsStockID(id))
        label = wxGetStockLabel(id);
''', '''    wxString label(lbl);
#ifndef __WXWASM__
    if (label.empty() && wxIsStockID(id))
        label = wxGetStockLabel(id);
#endif
''')
