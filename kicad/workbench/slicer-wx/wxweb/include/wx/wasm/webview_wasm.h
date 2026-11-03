/////////////////////////////////////////////////////////////////////////////
// Name:        wx/wasm/webview_wasm.h
// Purpose:     wxWebView backend for the wasm port: an <iframe> laid over the
//              control's rectangle inside its top-level window. file:// pages
//              under the program's resources load from the server beside the
//              program; script messages (window.wx.postMessage, as WebKit's
//              window.webkit.messageHandlers) come back as wx events and
//              RunScript runs in the page (same origin).
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#ifndef _WX_WASM_WEBVIEW_H_
#define _WX_WASM_WEBVIEW_H_

#include "wx/setup.h"

#if wxUSE_WEBVIEW && defined(__WXWASM__)

#include "wx/webview.h"

extern WXDLLIMPEXP_DATA_WEBVIEW(const char) wxWebViewBackendWasm[];

class WXDLLIMPEXP_WEBVIEW wxWebViewWasm : public wxWebView
{
public:
    wxWebViewWasm() {}
    wxWebViewWasm(wxWindow* parent, wxWindowID id,
                  const wxString& url = wxASCII_STR(wxWebViewDefaultURLStr),
                  const wxPoint& pos = wxDefaultPosition,
                  const wxSize& size = wxDefaultSize, long style = 0,
                  const wxString& name = wxASCII_STR(wxWebViewNameStr))
    {
        Create(parent, id, url, pos, size, style, name);
    }
    virtual ~wxWebViewWasm();

    bool Create(wxWindow* parent, wxWindowID id,
                const wxString& url = wxASCII_STR(wxWebViewDefaultURLStr),
                const wxPoint& pos = wxDefaultPosition,
                const wxSize& size = wxDefaultSize, long style = 0,
                const wxString& name = wxASCII_STR(wxWebViewNameStr)) wxOVERRIDE;

    wxString GetCurrentTitle() const wxOVERRIDE { return m_title; }
    wxString GetCurrentURL() const wxOVERRIDE { return m_url; }
    bool IsBusy() const wxOVERRIDE { return m_busy; }
    bool IsEditable() const wxOVERRIDE { return false; }
    void LoadURL(const wxString& url) wxOVERRIDE;
    void Print() wxOVERRIDE {}
    void RegisterHandler(wxSharedPtr<wxWebViewHandler> WXUNUSED(handler)) wxOVERRIDE {}
    void Reload(wxWebViewReloadFlags flags = wxWEBVIEW_RELOAD_DEFAULT) wxOVERRIDE;
    bool RunScript(const wxString& javascript, wxString* output = NULL) const wxOVERRIDE;
    bool AddScriptMessageHandler(const wxString& name) wxOVERRIDE;
    bool RemoveScriptMessageHandler(const wxString& name) wxOVERRIDE;
    bool AddUserScript(const wxString& javascript,
                       wxWebViewUserScriptInjectionTime injectionTime = wxWEBVIEW_INJECT_AT_DOCUMENT_START) wxOVERRIDE;
    void RemoveAllUserScripts() wxOVERRIDE;
    void SetEditable(bool WXUNUSED(enable) = true) wxOVERRIDE {}
    void Stop() wxOVERRIDE {}
    bool CanGoBack() const wxOVERRIDE { return m_back.size() > 1; }
    bool CanGoForward() const wxOVERRIDE { return !m_forward.empty(); }
    void GoBack() wxOVERRIDE;
    void GoForward() wxOVERRIDE;
    void ClearHistory() wxOVERRIDE { m_back.clear(); m_forward.clear(); }
    void EnableHistory(bool enable = true) wxOVERRIDE { m_history = enable; }
    wxVector<wxSharedPtr<wxWebViewHistoryItem> > GetBackwardHistory() wxOVERRIDE;
    wxVector<wxSharedPtr<wxWebViewHistoryItem> > GetForwardHistory() wxOVERRIDE { return m_forward; }
    void LoadHistoryItem(wxSharedPtr<wxWebViewHistoryItem> item) wxOVERRIDE { LoadURL(item->GetUrl()); }
    bool CanSetZoomType(wxWebViewZoomType WXUNUSED(type)) const wxOVERRIDE { return false; }
    float GetZoomFactor() const wxOVERRIDE { return m_zoom; }
    wxWebViewZoomType GetZoomType() const wxOVERRIDE { return wxWEBVIEW_ZOOM_TYPE_LAYOUT; }
    void SetZoomFactor(float zoom) wxOVERRIDE { m_zoom = zoom; }
    void SetZoomType(wxWebViewZoomType WXUNUSED(zoomType)) wxOVERRIDE {}
    bool CanUndo() const wxOVERRIDE { return false; }
    bool CanRedo() const wxOVERRIDE { return false; }
    void Undo() wxOVERRIDE {}
    void Redo() wxOVERRIDE {}
    void* GetNativeBackend() const wxOVERRIDE { return NULL; }

    bool SetUserAgent(const wxString& userAgent) wxOVERRIDE;

    // HTTP login the frame's pages get (a printer's own page asking for its user and password: Digest or Basic),
    // answered by the web view's service worker as a desktop web view answers its authentication request.
    // Empty user: none.
    void SetHttpCredentials(const wxString& user, const wxString& password) { m_httpUser = user; m_httpPassword = password; }

    virtual bool Show(bool show = true) wxOVERRIDE;
    virtual void OnInternalIdle() wxOVERRIDE;

    // from the page (wx.js -> the event loop)
    void OnPageLoaded(const wxString& url, const wxString& title);
    void OnScriptMessage(const wxString& handler, const wxString& message);

protected:
    void DoSetPage(const wxString& html, const wxString& baseUrl) wxOVERRIDE;
    virtual void DoMoveWindow(int x, int y, int width, int height) wxOVERRIDE;

private:
    void Navigate(const wxString& url, bool record);
    // Moves/resizes/hides the <iframe> to match this window
    void SyncElement();

    int m_elementId = 0;
    wxRect m_lastRect;
    bool m_lastShown = false;
    bool m_busy = false;
    wxString m_url, m_title;
    wxString m_httpUser, m_httpPassword;
    wxVector<wxSharedPtr<wxWebViewHistoryItem> > m_back, m_forward;
    bool m_history = true;
    float m_zoom = 1.0f;

    wxDECLARE_DYNAMIC_CLASS_NO_COPY(wxWebViewWasm);
};

class WXDLLIMPEXP_WEBVIEW wxWebViewFactoryWasm : public wxWebViewFactory
{
public:
    virtual wxWebView* Create() wxOVERRIDE { return new wxWebViewWasm; }
    virtual wxWebView* Create(wxWindow* parent, wxWindowID id,
                              const wxString& url = wxWebViewDefaultURLStr,
                              const wxPoint& pos = wxDefaultPosition,
                              const wxSize& size = wxDefaultSize, long style = 0,
                              const wxString& name = wxASCII_STR(wxWebViewNameStr)) wxOVERRIDE
    { return new wxWebViewWasm(parent, id, url, pos, size, style, name); }
};

#endif // wxUSE_WEBVIEW && __WXWASM__

#endif // _WX_WASM_WEBVIEW_H_
