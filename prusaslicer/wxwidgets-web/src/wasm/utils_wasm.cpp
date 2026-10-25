/////////////////////////////////////////////////////////////////////////////
// Name:        src/wasm/utils_wasm.cpp
// Purpose:     wasm port: the window under the pointer, opening a document, media backends
/////////////////////////////////////////////////////////////////////////////

#include "wx/wxprec.h"

#ifndef WX_PRECOMP
    #include "wx/utils.h"
    #include "wx/window.h"
    #include "wx/gdicmn.h"
#endif

#include "wx/link.h"

// The window under the pointer, as the desktop ports find it.
wxWindow* wxFindWindowAtPointer(wxPoint& pt)
{
    pt = wxGetMousePosition();
    return wxFindWindowAtPoint(pt);
}

// A browser tab cannot hand a file of its own file system to another program.
bool wxLaunchDefaultApplication(const wxString& WXUNUSED(document), int WXUNUSED(flags))
{
    return false;
}

#if wxUSE_MEDIACTRL
// wx/mediactrl.h links the port's media backends module; the wasm port has none yet, so
// wxMediaCtrl::Create finds no backend and fails, as on a desktop without one.
wxFORCE_LINK_THIS_MODULE(basewxmediabackends);
#endif
