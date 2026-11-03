# A window that opens takes the keyboard, and gives it back when it closes, as on desktop (wxGTK/wxMSW: the window
# manager activates a shown top-level window, wx puts the focus on its first focusable child, and the window under
# it gets the focus back when it goes). The wasm port never moved the focus on Show, so with a dialog open the keys
# still went to the main window behind it: Escape in Orca's Setup Wizard (DPIDialog's char hook closes it) went to
# the main window's panel and did nothing. ShowWithoutActivating keeps the focus where it is.
# Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('include/wx/wasm/toplevel.h', '''    virtual void ShowWithoutActivating() wxOVERRIDE;''',
'''    virtual bool Show(bool show = true) wxOVERRIDE;
    virtual void ShowWithoutActivating() wxOVERRIDE;''')

sub('src/wasm/toplevel.cpp', '''void wxTopLevelWindowWasm::ShowWithoutActivating()
{
    Show(true);
}''', '''// Where the keyboard was before each shown window took it (given back when that window hides).
static std::map<wxTopLevelWindowWasm *, wxWeakRef<wxWindow> > gs_focusBeforeShow;
static bool gs_showWithoutActivating = false;

bool wxTopLevelWindowWasm::Show(bool show)
{
    wxWindow *focus = wxWindow::FindFocus();
    const bool focusInside = focus && wxGetTopLevelParent(focus) == this;
    if ( !wxTopLevelWindowBase::Show(show) )
        return false;

    if ( show )
    {
        if ( !gs_showWithoutActivating && !focusInside )
        {
            gs_focusBeforeShow[this] = focus;
            if ( !wxSetFocusToChild(this, NULL) )
                SetFocus();
        }
    }
    else
    {
        auto it = gs_focusBeforeShow.find(this);
        wxWindow *back = it != gs_focusBeforeShow.end() ? it->second.get() : NULL;
        if ( it != gs_focusBeforeShow.end() )
            gs_focusBeforeShow.erase(it);
        if ( focusInside && back && back->IsShownOnScreen() )
            back->SetFocus();
    }
    return true;
}

void wxTopLevelWindowWasm::ShowWithoutActivating()
{
    gs_showWithoutActivating = true;
    Show(true);
    gs_showWithoutActivating = false;
}''')

sub('src/wasm/toplevel.cpp', '''#include "wx/toplevel.h"''', '''#include "wx/toplevel.h"
#include "wx/containr.h"
#include "wx/weakref.h"
#include <map>''')
