# A menu item with a stock id and no accelerator of its own shows (and answers) GTK's stock accelerator, as wxGTK
# does (src/gtk/menu.cpp wxGetAccelFromLabel -> gtk_stock_lookup). Bambu Studio's File > Quit (wxID_EXIT, label
# "Quit") read "Quit  Ctrl+Q" on the desktop; wxUniv only knew accelerators written in the label after a TAB.
# Table = GTK 3 gtkstock.c stock items that carry a key (only those wx has a stock id for).
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/univ/menu.cpp', '''void wxMenuItem::UpdateAccelInfo()
{
    m_indexAccel = wxControl::FindAccelIndex(m_text);
''', '''#ifdef __WXWASM__
// GTK 3's stock accelerators (gtkstock.c), for items whose label names none
static const char *wxWasmStockAccel(int id)
{
    switch ( id )
    {
        case wxID_CLOSE:     return "Ctrl+W";
        case wxID_COPY:      return "Ctrl+C";
        case wxID_CUT:       return "Ctrl+X";
        case wxID_FIND:      return "Ctrl+F";
        case wxID_REPLACE:   return "Ctrl+R";
        case wxID_NEW:       return "Ctrl+N";
        case wxID_OPEN:      return "Ctrl+O";
        case wxID_PASTE:     return "Ctrl+V";
        case wxID_PRINT:     return "Ctrl+P";
        case wxID_EXIT:      return "Ctrl+Q";
        case wxID_REDO:      return "Shift+Ctrl+Z";
        case wxID_SAVE:      return "Ctrl+S";
        case wxID_SAVEAS:    return "Shift+Ctrl+S";
        case wxID_SELECTALL: return "Ctrl+A";
        case wxID_UNDO:      return "Ctrl+Z";
    }
    return NULL;
}
#endif

void wxMenuItem::UpdateAccelInfo()
{
#ifdef __WXWASM__
    if ( m_text.find(wxT('\\t')) == wxString::npos && !IsSubMenu() )
    {
        if ( const char *stock = wxWasmStockAccel(GetId()) )
            m_text << wxT('\\t') << stock;
    }
#endif
    m_indexAccel = wxControl::FindAccelIndex(m_text);
''')
