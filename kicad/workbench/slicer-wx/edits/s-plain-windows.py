# A plain window paints no background unless it has a colour, as on wxGTK 3. There a wxWindow / wxPanel / scrolled
# window (and a program's own widget built straight on one, e.g. Bambu's SideButton) is a wxPizza with no paint of
# its own: GTKSendPaintEvents fills it only when m_backgroundColour is set (by SetBackgroundColour or inherited),
# otherwise the parent shows through. wxUniv erased every window with the theme's control grey (#E6E6E6): Bambu's
# Slice plate / Print plate buttons (in wxTRANSPARENT_WINDOW panels, no colour, on the dark top bar) showed light
# gaps, and their anti-aliased edges were drawn over the grey/cleared area instead of the bar (dark rims).
# Library controls with their own look (text fields, lists, buttons, ...) keep the theme background: only windows
# whose nearest wx class is wxWindow / wxPanel / wxControl / wxScrolledWindow / wxScrolledCanvas count as plain.
# The port already paints parents first and repaints the parent when a transparent child changes (Invalidate).
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/window.cpp', '''bool wxWindowWasm::HasTransparentBackground()
{
    return GetBackgroundStyle() == wxBG_STYLE_TRANSPARENT ||
           GetBackgroundColour().Alpha() == 0;
}''', '''// a window whose nearest wx library class is a plain container (a wxPizza on wxGTK)
static bool IsPlainWindow(const wxWindow *win)
{
    const wxClassInfo *ci = win->GetClassInfo();
    while ( ci && !wxString(ci->GetClassName()).StartsWith("wx") )
        ci = ci->GetBaseClass1();
    if ( !ci )
        return false;
    const wxString name = ci->GetClassName();
    return name == "wxWindow" || name == "wxPanel" || name == "wxControl" ||
           name == "wxScrolledWindow" || name == "wxScrolledCanvas";
}

bool wxWindowWasm::HasTransparentBackground()
{
    if ( GetBackgroundStyle() == wxBG_STYLE_TRANSPARENT ||
         GetBackgroundColour().Alpha() == 0 )
        return true;
    // as wxGTK 3: a plain window with no colour of its own (set or inherited) shows its parent
    wxWindow * const win = static_cast<wxWindow *>(this);
    return !IsTopLevel() && GetParent() && !UseBgCol() && GetBackgroundStyle() != wxBG_STYLE_PAINT &&
           IsPlainWindow(win);
}''')
