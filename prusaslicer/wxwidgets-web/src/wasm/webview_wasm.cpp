/////////////////////////////////////////////////////////////////////////////
// Name:        src/wasm/webview_wasm.cpp
// Purpose:     wxWebView backend for the wasm port (see wx/wasm/webview_wasm.h)
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#include "wx/wxprec.h"

#if wxUSE_WEBVIEW && defined(__WXWASM__)

#include "wx/wasm/webview_wasm.h"
#include "wx/toplevel.h"

#include <emscripten.h>
#include <cstdlib>
#include <map>
#include <functional>

void wxWasmQueueInput(std::function<void()> handler);

extern WXDLLIMPEXP_DATA_WEBVIEW(const char) wxWebViewBackendWasm[] = "wxWebViewWasm";

wxIMPLEMENT_DYNAMIC_CLASS(wxWebViewWasm, wxWebView);

static std::map<int, wxWebViewWasm*> gs_views;

// ----------------------------------------------------------------------------
// The browser side (now in bulk/page-bridge-web.js). A web view shows the program's own pages only: a page of another site (http/https outside the
// page's origin) opens in a new browser tab instead, whether the program asks for it (LoadURL) or the page does
// (a link, location = ..., window.open, a form). The frame stays on the page it had. A desktop web view would show
// that site inside the program; in a browser tab it would be a site inside our site (sign-in pages included), and
// the page's cross-origin isolation refuses most of them anyway. The new tab cannot reach back (noopener).
//
// A file:// path names the same path on the server the
// program came from (the program's files are preloaded at the paths the
// server has them). The service worker wxwebview-sw.js (beside index.html)
// puts a first <script> into every page the frames load, which calls
// wxwvBridge: so window.wx / window.webkit.messageHandlers.wx exist before
// the page's own scripts run. Without the worker, they appear at "load".
// ----------------------------------------------------------------------------

// Every call that touches the document runs on the page (bulk/page-bridge-web.js, a JS library): main() runs in a
// worker, where there is no document. The wxpage_wv_* functions are proxied to the browser thread; the ones that
// pass a C string or return a value block this thread until the page has run them (__proxy:'sync'), the rest are
// queued fire-and-forget (__proxy:'async'), in order. The page keeps the Module.wxwv* helpers and window.wxwvBridge
// (the service worker's injected script calls it); wxwvSetup's pointerdown blur fix and the service worker
// registration live there too. Frame -> C++ comes back as {wx:'call'} messages to this worker (wx.js inbox) that
// call the exports below; they only queue (wxWasmQueueInput), the event loop dispatches.
extern "C" {
    int   wxpage_wv_setup();
    void  wxpage_wv_create(int id, int tlwId);
    void  wxpage_wv_set_rect(int id, int tlwId, int x, int y, int w, int h, int shown);
    // 1 if url is a page of another site: it opens in a new tab, not in the web view
    int   wxpage_wv_open_outside(const char *url);
    void  wxpage_wv_load(int id, const char *url, const char *user, const char *password);
    void  wxpage_wv_set_html(int id, const char *html);
    void  wxpage_wv_reload(int id);
    // The value of the script as text (malloc'd on the page, freed here), or 0 if it threw or there is no page
    char *wxpage_wv_run(int id, const char *js);
    void  wxpage_wv_handler(int id, const char *name, int add);
    void  wxpage_wv_user_script(int id, const char *js);   // js == NULL removes them all
    void  wxpage_wv_user_agent(int id, const char *ua);
    void  wxpage_wv_destroy(int id);
}

// From the page (through the worker inbox, {wx:'call'}): queued, the event loop delivers them (like every browser
// event in the port). The strings were malloc'd on the page thread; freed here. Never call wx code or a suspending
// import from these: they run from a message handler, outside main's call chain (R13).
extern "C" EMSCRIPTEN_KEEPALIVE void wxwv_loaded(int id, char *url, char *title)
{
    const wxString u = wxString::FromUTF8(url), t = wxString::FromUTF8(title);
    free(url);
    free(title);
    wxWasmQueueInput([id, u, t]() {
        auto it = gs_views.find(id);
        if (it != gs_views.end())
            it->second->OnPageLoaded(u, t);
    });
}

extern "C" EMSCRIPTEN_KEEPALIVE void wxwv_focused(int id)
{
    wxWasmQueueInput([id]() {
        auto it = gs_views.find(id);
        if (it != gs_views.end() && wxWindow::FindFocus() != it->second)
            it->second->SetFocus();
    });
}

extern "C" EMSCRIPTEN_KEEPALIVE void wxwv_message(int id, char *handler, char *message)
{
    const wxString h = wxString::FromUTF8(handler), m = wxString::FromUTF8(message);
    free(handler);
    free(message);
    wxWasmQueueInput([id, h, m]() {
        auto it = gs_views.find(id);
        if (it != gs_views.end())
            it->second->OnScriptMessage(h, m);
    });
}

// ----------------------------------------------------------------------------
// wxWebViewWasm
// ----------------------------------------------------------------------------

bool wxWebViewWasm::Create(wxWindow* parent, wxWindowID id, const wxString& url,
                           const wxPoint& pos, const wxSize& size, long style,
                           const wxString& name)
{
    if ( !wxControl::Create(parent, id, pos, size, style | wxBORDER_NONE, wxDefaultValidator, name) )
        return false;

    wxTopLevelWindow *tlw = wxDynamicCast(wxGetTopLevelParent(this), wxTopLevelWindow);
    wxCHECK_MSG(tlw, false, "wxWebView needs a top-level parent");

    static int s_nextId = 1;
    m_elementId = s_nextId++;
    gs_views[m_elementId] = this;
    wxpage_wv_setup();
    wxpage_wv_create(m_elementId, tlw->GetCSSId());
    SyncElement();

    if ( !url.empty() && url != wxASCII_STR(wxWebViewDefaultURLStr) )
        LoadURL(url);
    return true;
}

wxWebViewWasm::~wxWebViewWasm()
{
    if (m_elementId)
    {
        gs_views.erase(m_elementId);
        wxpage_wv_destroy(m_elementId);
    }
}

void wxWebViewWasm::SyncElement()
{
    if (!m_elementId)
        return;

    wxTopLevelWindow *tlw = wxDynamicCast(wxGetTopLevelParent(this), wxTopLevelWindow);
    if (!tlw)
        return;
    wxPoint origin = ClientToScreen(wxPoint(0, 0)) - tlw->GetScreenPosition();
    wxRect rect(origin, GetClientSize());
    bool shown = IsShownOnScreen();
    if (rect == m_lastRect && shown == m_lastShown)
        return;
    m_lastRect = rect;
    m_lastShown = shown;
    wxpage_wv_set_rect(m_elementId, tlw->GetCSSId(), rect.x, rect.y, rect.width, rect.height, shown);
}

void wxWebViewWasm::DoMoveWindow(int x, int y, int width, int height)
{
    wxWebView::DoMoveWindow(x, y, width, height);
    SyncElement();
}

bool wxWebViewWasm::Show(bool show)
{
    bool changed = wxWebView::Show(show);
    SyncElement();
    return changed;
}

// A parent that moves or hides does not tell its children: check on idle
void wxWebViewWasm::OnInternalIdle()
{
    wxWebView::OnInternalIdle();
    SyncElement();
}

void wxWebViewWasm::Navigate(const wxString& url, bool record)
{
    wxWebViewEvent navigating(wxEVT_WEBVIEW_NAVIGATING, GetId(), url, "");
    navigating.SetEventObject(this);
    HandleWindowEvent(navigating);
    if ( !navigating.IsAllowed() )
        return;
    // another site: a new browser tab; this view keeps its page (see wxwvKeepHome)
    if ( wxpage_wv_open_outside(url.utf8_str()) )
        return;
    if ( record && m_history )
    {
        m_back.push_back(wxSharedPtr<wxWebViewHistoryItem>(new wxWebViewHistoryItem(url, "")));
        m_forward.clear();
    }
    m_url = url;
    m_busy = true;
    wxpage_wv_load(m_elementId, url.utf8_str(), m_httpUser.utf8_str(), m_httpPassword.utf8_str());
}

void wxWebViewWasm::OnPageLoaded(const wxString& url, const wxString& title)
{
    m_busy = false;
    m_url = url;
    m_title = title;
    wxWebViewEvent navigated(wxEVT_WEBVIEW_NAVIGATED, GetId(), url, "");
    navigated.SetEventObject(this);
    HandleWindowEvent(navigated);
    wxWebViewEvent loaded(wxEVT_WEBVIEW_LOADED, GetId(), url, "");
    loaded.SetEventObject(this);
    HandleWindowEvent(loaded);
    if (!title.empty())
    {
        wxWebViewEvent titled(wxEVT_WEBVIEW_TITLE_CHANGED, GetId(), url, "");
        titled.SetString(title);
        titled.SetEventObject(this);
        HandleWindowEvent(titled);
    }
}

void wxWebViewWasm::OnScriptMessage(const wxString& handler, const wxString& message)
{
    wxWebViewEvent event(wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED, GetId(), m_url, "",
                         wxWEBVIEW_NAV_ACTION_NONE, handler);
    event.SetString(message);
    event.SetEventObject(this);
    HandleWindowEvent(event);
}

// As desktop web views, the page loads after LoadURL has returned.
void wxWebViewWasm::LoadURL(const wxString& url)
{
    CallAfter([this, url]() { Navigate(url, true); });
}

void wxWebViewWasm::DoSetPage(const wxString& html, const wxString& WXUNUSED(baseUrl))
{
    m_busy = true;
    wxpage_wv_set_html(m_elementId, html.utf8_str());
}

void wxWebViewWasm::Reload(wxWebViewReloadFlags WXUNUSED(flags))
{
    m_busy = true;
    wxpage_wv_reload(m_elementId);
}

bool wxWebViewWasm::RunScript(const wxString& javascript, wxString* output) const
{
    char *result = wxpage_wv_run(m_elementId, javascript.utf8_str());
    if (!result)
        return false;
    if (output)
        *output = wxString::FromUTF8(result);
    free(result);
    return true;
}

bool wxWebViewWasm::AddScriptMessageHandler(const wxString& name)
{
    wxpage_wv_handler(m_elementId, name.utf8_str(), 1);
    return true;
}

bool wxWebViewWasm::RemoveScriptMessageHandler(const wxString& name)
{
    wxpage_wv_handler(m_elementId, name.utf8_str(), 0);
    return true;
}

bool wxWebViewWasm::SetUserAgent(const wxString& userAgent)
{
    wxpage_wv_user_agent(m_elementId, userAgent.utf8_str());
    return true;
}

bool wxWebViewWasm::AddUserScript(const wxString& javascript, wxWebViewUserScriptInjectionTime WXUNUSED(injectionTime))
{
    wxpage_wv_user_script(m_elementId, javascript.utf8_str());
    return true;
}

void wxWebViewWasm::RemoveAllUserScripts()
{
    wxpage_wv_user_script(m_elementId, NULL);
}

void wxWebViewWasm::GoBack()
{
    if ( !CanGoBack() )
        return;
    m_forward.insert(m_forward.begin(), m_back.back());
    m_back.pop_back();
    const wxString url = m_back.back()->GetUrl();
    CallAfter([this, url]() { Navigate(url, false); });
}

void wxWebViewWasm::GoForward()
{
    if ( !CanGoForward() )
        return;
    m_back.push_back(m_forward.front());
    m_forward.erase(m_forward.begin());
    const wxString url = m_back.back()->GetUrl();
    CallAfter([this, url]() { Navigate(url, false); });
}

wxVector<wxSharedPtr<wxWebViewHistoryItem> > wxWebViewWasm::GetBackwardHistory()
{
    wxVector<wxSharedPtr<wxWebViewHistoryItem> > back;
    for ( size_t i = 0; i + 1 < m_back.size(); ++i )
        back.push_back(m_back[i]);
    return back;
}

#endif // wxUSE_WEBVIEW && __WXWASM__
