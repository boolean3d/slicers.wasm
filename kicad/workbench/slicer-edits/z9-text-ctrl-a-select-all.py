# Ctrl+A in a text box selects all its text, as GtkEntry and the Windows edit control do; wxUniv's text input
# handler sent Ctrl+A to Redo, so Ctrl+A then typing put the new digits in front of the old value (PrusaSlicer
# Object manipulation: rotate "0" + Ctrl+A + "45" gave "450". Ctrl+Shift+Z stays Redo
# ('Z' with shift goes through the same Undo case as before; GTK 3 entries have no redo).
# The action is named "wholetext": the first name, "selall", began with "sel" = wxACTION_TEXT_PREFIX_SEL, so PerformAction
# cut it to "all" and nothing was selected. Trees that took "selall" are renamed in place.
# Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

_p = 'src/univ/textctrl.cpp'; _s = open(_p).read()
if 'wxT("selall")' in _s: open(_p, 'w').write(_s.replace('wxT("selall")', 'wxT("wholetext")'))

sub('src/univ/textctrl.cpp', '''                    case 'A':
                        action = wxACTION_TEXT_REDO;
                        break;''', '''                    case 'A':
                        action = wxT("wholetext");   // GTK/MSW: select all
                        break;''')

sub('src/univ/textctrl.cpp', '''    else if ( action == wxACTION_TEXT_REDO )
    {''', '''    else if ( action == wxT("wholetext") )
    {
        SelectAll();
    }
    else if ( action == wxACTION_TEXT_REDO )
    {''')
