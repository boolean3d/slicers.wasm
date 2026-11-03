// KiCad's platform layer for the browser build: the web view is the browser's own frame; its cookies are the browser's.
#include <kiplatform/webview.h>
#include <wx/string.h>
class wxWebView;
bool KIPLATFORM::WEBVIEW::SaveCookies( wxWebView*, const wxString& ) { return false; }
bool KIPLATFORM::WEBVIEW::LoadCookies( wxWebView*, const wxString& ) { return false; }
bool KIPLATFORM::WEBVIEW::DeleteCookies( wxWebView* ) { return false; }
