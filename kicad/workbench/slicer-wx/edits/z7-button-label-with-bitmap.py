# A button with both a bitmap and a label shows both, as wxMSW and wxGTK do. The wasm theme's DrawButtonLabel
# dropped the text whenever the button had a bitmap, while wxAnyButton's best size still counted it: PrusaSlicer's
# check boxes (BitmapToggleButton: the check bitmap + "Inches", "Regular expression", "All"...) showed an empty
# space where the words go (prusa-ui-wasm-7, 10-24). wxDC::DrawLabel already lays the bitmap out before the text.
# Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/univ/themes/wasm.cpp', '''    wxString label;
    if (!image.IsOk())
        label = text;

    wxDCTextColourChanger clrChanger(dc);''', '''    wxString label = text;

    wxDCTextColourChanger clrChanger(dc);''')
