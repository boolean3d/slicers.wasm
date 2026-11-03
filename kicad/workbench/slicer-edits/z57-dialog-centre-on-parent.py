# A dialog made without a position opens centred on its parent (z57.)
# The port's wxNonOwnedWindow::Create turns a default position into (0, 0), so every such dialog opened at the page's
# top-left corner (KiCad's schematic V / E dialogs: DIALOG_SHIM leaves the place to the toolkit). wxGTK, which the
# port follows, tells GTK to centre a dialog on its parent when it is first shown (src/gtk/toplevel.cpp:
# wxTOPLEVEL_EX_DIALOG -> gtk_window_set_position(GTK_WIN_POS_CENTER_ON_PARENT)); a program that moves or centres the
# dialog itself before showing it keeps its own place. Now the same: a dialog created at the default position and still
# where Create put it when first shown is centred on its parent by wx's own DoCentre (kept inside the page's area, which
# starts under any page header: display height = innerHeight - #main-window offsetTop). Dragging a window by its title
# bar now keeps the title bar on the page (as a desktop window manager does), so it can never go under a page header
# (the Boolean3d workspace bar) or below the bottom.
# Only lines are added, at places no other edit or recipe block matches as a whole (z6 matches its whole
# wxTopLevelWindowWasm::Show block, so the hook is in wxNonOwnedWindow::Show). Trees lacking the anchors skip.
import sys
N = 'src/wasm/nonownedwnd.cpp'
T = 'src/wasm/toplevel.cpp'
n = open(N).read()
t = open(T).read()
if '(z57)' in n and '(z57)' in t:
    sys.exit(0)
an = {
    'state': 'void wxNonOwnedWindow::Init()\n',
    'create': '    wxTopLevelWindows.Append(this);\n',
    'show': '    bool ret = wxNonOwnedWindowBase::Show(show);\n',
}
at = {'drag': '''void wxTopLevelWindowWasm::DragMove(const wxPoint& pos)
{
'''}
for k, a in an.items():
    if n.count(a) != 1:
        print('z57: anchor %s not found once in %s, skipped' % (k, N)); sys.exit(0)
for k, a in at.items():
    if t.count(a) != 1:
        print('z57: anchor %s not found once in %s, skipped' % (k, T)); sys.exit(0)

if '(z57)' not in n:
    # the state lives in this file (a member would change a header and rebuild every program object)
    n = n.replace(an['state'], '''// (z57) dialogs created at the default position, with where Create put them: centred on their parent at first show
static std::map<wxNonOwnedWindow *, wxPoint> gs_centreOnFirstShow;

''' + an['state'], 1)
    n = n.replace(an['create'], an['create'] + '''    // (z57) wxGTK: a dialog without a position is centred on its parent when first shown, unless moved before
    if ( (GetExtraStyle() & wxTOPLEVEL_EX_DIALOG) && pos == wxDefaultPosition )
        gs_centreOnFirstShow[this] = GetPosition();
    else
        gs_centreOnFirstShow.erase(this);
''', 1)
    n = n.replace(an['show'], '''    {   // (z57) first show of a dialog made without a position and not moved since: centre it on its parent
        auto it = gs_centreOnFirstShow.find(this);
        if ( it != gs_centreOnFirstShow.end() )
        {
            const bool unmoved = it->second == GetPosition();
            gs_centreOnFirstShow.erase(it);
            if ( show && unmoved )
                CentreOnParent();
        }
    }
''' + an['show'], 1)
    if '#include <map>' not in n:
        n = n.replace('#include "wx/nonownedwnd.h"\n', '#include "wx/nonownedwnd.h"\n#include <map>   // (z57)\n', 1)
    open(N, 'w').write(n)

if '(z57)' not in t:
    t = t.replace(at['drag'], at['drag'] + '''    {   // (z57) the title bar stays on the page (never under a page header, never below the bottom)
        wxPoint to = pos - m_dragOffset;
        const wxSize page = wxTheApp->GetDisplay()->GetScreenSize();
        to.y = wxMin(wxMax(to.y, 0), page.y - TITLE_BAR_HEIGHT);
        Move(to);
        return;
    }
''', 1)
    open(T, 'w').write(t)
print('z57: applied to', N, T)
