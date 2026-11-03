# A click over a wxStaticBox goes to the sibling control lying on top of the box's area, as on desktop: wxMSW's
# static box answers WM_NCHITTEST with HTTRANSPARENT, and wxGTK's GtkFrame has no window of its own, so the pointer
# reaches the controls placed over it even when they are its siblings rather than its children. The port's hit test
# (wxGenericFindWindowAtPoint) returned the box whenever it came later in the child list, so those controls never
# got a click: PrusaSlicer's Object manipulation number boxes (TextInput siblings of the " Object manipulation" box)
# could not be clicked or typed into; the digits went to the 3D view. Now a static box is hit
# only where no sibling below it in the stack holds the point.
# Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/window.cpp', '''wxWindow* wxFindWindowAtPoint(const wxPoint& pt)
{
    return wxGenericFindWindowAtPoint(pt);
}''', '''// The window under a page point: wxGenericFindWindowAtPoint's walk (top-level windows and children from the top of the
// stack down), except that a wxStaticBox lets the point through to the siblings below it (wxMSW HTTRANSPARENT,
// wxGTK frame without a window) and is the answer only when none of them holds it.
static wxWindow* wxWasmFindWindowAtPoint(wxWindow* win, const wxPoint& pt)
{
    if (!win->IsShown())
        return NULL;
#if wxUSE_NOTEBOOK
    if (wxNotebook* nb = wxDynamicCast(win, wxNotebook))
    {
        int sel = nb->GetSelection();
        if (sel >= 0)
            if (wxWindow* found = wxWasmFindWindowAtPoint(nb->GetPage(sel), pt))
                return found;
    }
#endif
    wxWindow* box = NULL;
    for (wxWindowList::compatibility_iterator node = win->GetChildren().GetLast(); node; node = node->GetPrevious())
    {
        wxWindow* child = node->GetData();
        wxWindow* found = wxWasmFindWindowAtPoint(child, pt);
        if (!found)
            continue;
        if (found == child && !child->IsTopLevel() && wxDynamicCast(child, wxStaticBox))
        {
            if (!box)
                box = found;
            continue;
        }
        return found;
    }
    if (box)
        return box;
    wxPoint pos = win->GetPosition();
    if (!win->IsTopLevel() && win->GetParent())
        pos = win->GetParent()->ClientToScreen(pos);
    return wxRect(pos, win->GetSize()).Contains(pt) ? win : NULL;
}

wxWindow* wxFindWindowAtPoint(const wxPoint& pt)
{
    for (wxWindowList::compatibility_iterator node = wxTopLevelWindows.GetLast(); node; node = node->GetPrevious())
        if (wxWindow* found = wxWasmFindWindowAtPoint(node->GetData(), pt))
            return found;
    return NULL;
}''')

sub('src/wasm/window.cpp', '''#include "wx/nonownedwnd.h"
''', '''#include "wx/nonownedwnd.h"
#include "wx/notebook.h"
#include "wx/statbox.h"
''')
