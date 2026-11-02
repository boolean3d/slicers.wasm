/////////////////////////////////////////////////////////////////////////////
// Name:        wx/wasm/tooltip.h
// Purpose:     wxToolTip for the wasm port: holds the text for its window.
//              Showing it on hover is not done yet.
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#ifndef _WX_WASM_TOOLTIP_H_
#define _WX_WASM_TOOLTIP_H_

#include "wx/object.h"
#include "wx/string.h"

class WXDLLIMPEXP_FWD_CORE wxWindow;

class WXDLLIMPEXP_CORE wxToolTip : public wxObject
{
public:
    wxToolTip(const wxString& tip) : m_text(tip), m_window(NULL) {}

    // globally change the tooltip parameters
    static void Enable(bool flag) { ms_enabled = flag; }
    static void SetDelay(long WXUNUSED(msecs)) {}
    static void SetAutoPop(long WXUNUSED(msecs)) {}
    static void SetReshow(long WXUNUSED(msecs)) {}
    static bool IsEnabled() { return ms_enabled; }

    void SetTip(const wxString& tip) { m_text = tip; }
    const wxString& GetTip() const { return m_text; }

    wxWindow *GetWindow() const { return m_window; }
    void SetWindow(wxWindow* win) { m_window = win; }

private:
    wxString  m_text;
    wxWindow *m_window;
    static bool ms_enabled;

    wxDECLARE_ABSTRACT_CLASS(wxToolTip);
};

#endif // _WX_WASM_TOOLTIP_H_
