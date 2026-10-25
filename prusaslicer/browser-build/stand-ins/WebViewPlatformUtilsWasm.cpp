// PrusaSlicer's web view helpers (GUI/WebViewPlatformUtils.hpp) for the wasm wx web view, an iframe on the page.
// The Linux file talks to WebKitGTK. The printer's user and password (PrusaLink Digest) go to the web view, whose
// service worker answers the printer's login with them, as WebView2/WebKit do on desktop. A browser frame takes no
// extra request headers from its page (add_request_authorization), and cookies belong to the browser: nothing to delete.
#include "slic3r/GUI/WebViewPlatformUtils.hpp"
#include <boost/log/trivial.hpp>
#include <wx/webview.h>
#include <wx/wasm/webview_wasm.h>

namespace Slic3r::GUI {

void setup_webview_with_credentials(wxWebView* web_view, const std::string& username, const std::string& password)
{
    if (auto* v = dynamic_cast<wxWebViewWasm*>(web_view))
        v->SetHttpCredentials(wxString::FromUTF8(username), wxString::FromUTF8(password));
}
void remove_webview_credentials(wxWebView* web_view)
{
    if (auto* v = dynamic_cast<wxWebViewWasm*>(web_view))
        v->SetHttpCredentials(wxString(), wxString());
}
void delete_cookies(wxWebView*, const std::string&) {}
void delete_cookies_with_counter(wxWebView* web_view, const std::string& url, std::atomic<size_t>& counter)
{
    delete_cookies(web_view, url);
    counter++;   // as the Linux file: the caller counts finished deletions
}
void add_request_authorization(wxWebView*, const wxString&, const std::string&) {}
void remove_request_authorization(wxWebView*) {}
void load_request(wxWebView* web_view, const std::string& address, const std::string& token)
{
    if (!token.empty())
        BOOST_LOG_TRIVIAL(warning) << "load_request: a browser frame cannot send the Authorization header; loading " << address << " without it";
    web_view->LoadURL(wxString::FromUTF8(address));
}

}
