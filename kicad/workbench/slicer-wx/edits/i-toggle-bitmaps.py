# A bitmap toggle button shows its bitmap (wxGTK: a GtkToggleButton with an image). wxUniv kept bitmaps only in
# wxButton (DoSetBitmap/DoGetBitmap); wxToggleButton inherited wxAnyButtonBase's empty ones, so SetBitmap on a
# wxBitmapToggleButton was dropped and the button drew nothing. Bambu Studio's switches are all wxBitmapToggleButton
# (SwitchButton: Advanced on the Process bar, Global/Objects beside it, every on/off switch in Preferences and the
# Device tab): they were empty. The bitmap is drawn centred with no margin (Bambu sizes the button to the bitmap; a
# GTK button with relief none draws the image the same way).
# Run in owx.
# wx 3.2 (prusa's tree) passes bitmaps as wxBitmapBundle: the same edit with that signature (wxButton's 3.2 form)
BUNDLE = 'DoSetBitmap(const wxBitmapBundle&' in open('include/wx/anybutton.h').read()
def v(t):
    if not BUNDLE: return t
    return (t.replace('DoSetBitmap(const wxBitmap& bitmap, State which)', 'DoSetBitmap(const wxBitmapBundle& bitmap, State which)')
             .replace('    m_bitmap = bitmap;\n    InvalidateBestSize();', '    m_bitmap = bitmap.GetBitmap(wxDefaultSize);\n    InvalidateBestSize();'))

def sub(p, a, b, n=1):
    s = open(p).read()
    b = v(b)
    if b in s: return   # already applied
    if BUNDLE and v(s) != s:   # a 3.2 tree that got the 3.1 form: the 3.2 signature in
        s = v(s); open(p, 'w').write(s)
        if b in s: return
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('include/wx/univ/tglbtn.h', '''protected:
    virtual wxBorder GetDefaultBorder() const wxOVERRIDE { return wxBORDER_NONE; }

    // the current value
    bool m_value;
''', '''protected:
    virtual wxBorder GetDefaultBorder() const wxOVERRIDE { return wxBORDER_NONE; }

    // the bitmap of a bitmap toggle button (wxAnyButton keeps it, wxButton-style)
    virtual wxBitmap DoGetBitmap(State which) const wxOVERRIDE;
    virtual void DoSetBitmap(const wxBitmap& bitmap, State which) wxOVERRIDE;
    virtual void DoSetBitmapMargins(wxCoord x, wxCoord y) wxOVERRIDE;

    // the current value
    bool m_value;
''')

sub('src/univ/tglbtn.cpp', '''void wxToggleButton::Init()
{''', '''wxBitmap wxToggleButton::DoGetBitmap(State which) const
{
    return which == State_Normal ? m_bitmap : wxBitmap();
}

void wxToggleButton::DoSetBitmap(const wxBitmap& bitmap, State which)
{
    // one bitmap, as wxButton; the program switches it itself (Bambu's SwitchButton sets on/off bitmaps)
    if ( which != State_Normal )
        return;
    m_bitmap = bitmap;
    InvalidateBestSize();
    Refresh();
}

void wxToggleButton::DoSetBitmapMargins(wxCoord x, wxCoord y)
{
    m_marginBmpX = x;
    m_marginBmpY = y;
    InvalidateBestSize();
}

void wxToggleButton::Init()
{
    m_marginBmpX =
    m_marginBmpY = 0;''')
