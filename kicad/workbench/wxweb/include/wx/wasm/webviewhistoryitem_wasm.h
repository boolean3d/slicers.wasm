/////////////////////////////////////////////////////////////////////////////
// Name:        wx/wasm/webviewhistoryitem_wasm.h
// Purpose:     wxWebViewHistoryItem for the wasm port
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#ifndef _WX_WASM_WEBVIEWHISTORYITEM_H_
#define _WX_WASM_WEBVIEWHISTORYITEM_H_

#include "wx/setup.h"

#if wxUSE_WEBVIEW && defined(__WXWASM__)

class WXDLLIMPEXP_WEBVIEW wxWebViewHistoryItem
{
public:
    wxWebViewHistoryItem(const wxString& url, const wxString& title) :
                     m_url(url), m_title(title) {}
    wxString GetUrl() { return m_url; }
    wxString GetTitle() { return m_title; }

private:
    wxString m_url, m_title;
};

#endif

#endif // _WX_WASM_WEBVIEWHISTORYITEM_H_
