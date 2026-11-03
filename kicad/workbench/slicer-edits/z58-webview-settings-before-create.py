# A web view keeps what the program set before Create and applies it when the frame is made (z58.)
# wxWebView::New() + SetUserAgent() + Create() is the stock order in KiCad (common/widgets/webview_panel.cpp: the user
# agent is set before Create, as wxGTK and wxMSW allow). In the port, every setter went straight to the page with the
# element id, which is 0 before Create: the page's wxwvViews map did not exist yet, the proxied call threw ("Cannot read
# properties of undefined (reading 'get')") and, being a sync proxy, never returned: the program stopped answering
# (KiCad's File > New Project > template "default": the template preview's web view). Now the user agent, message
# handlers and user scripts set before Create are kept and sent right after the frame exists; a load, page, reload or
# script asked of a view that has no frame does nothing (RunScript returns false), as on desktop before Create.
# State in a static map (a member would change the header and rebuild every program object). Trees lacking the
# anchors skip.
import sys
W = 'src/wasm/webview_wasm.cpp'
s = open(W).read()
if '(z58)' in s:
    sys.exit(0)
anchors = {
    'class': '// wxWebViewWasm\n// ----------------------------------------------------------------------------\n',
    'create': '    wxpage_wv_create(m_elementId, tlw->GetCSSId());\n',
    'dtor': 'wxWebViewWasm::~wxWebViewWasm()\n{\n',
    'inc': '#include <map>\n',
    'ua': 'bool wxWebViewWasm::SetUserAgent(const wxString& userAgent)\n{\n',
    'handler': 'bool wxWebViewWasm::AddScriptMessageHandler(const wxString& name)\n{\n',
    'unhandler': 'bool wxWebViewWasm::RemoveScriptMessageHandler(const wxString& name)\n{\n',
    'script': 'bool wxWebViewWasm::AddUserScript(const wxString& javascript, wxWebViewUserScriptInjectionTime WXUNUSED(injectionTime))\n{\n',
    'unscript': 'void wxWebViewWasm::RemoveAllUserScripts()\n{\n',
    'run': 'bool wxWebViewWasm::RunScript(const wxString& javascript, wxString* output) const\n{\n',
    'reload': '    m_busy = true;\n    wxpage_wv_reload(m_elementId);\n',
    'load': '    wxpage_wv_load(m_elementId, url.utf8_str(), m_httpUser.utf8_str(), m_httpPassword.utf8_str());\n',
    'html': '    wxpage_wv_set_html(m_elementId, html.utf8_str());\n',
}
for k, a in anchors.items():
    if s.count(a) != 1:
        print('z58: anchor %s not found once in %s, skipped' % (k, W)); sys.exit(0)

s = s.replace(anchors['class'], anchors['class'] + '''
// (z58) what the program set before Create (no frame yet): sent when the frame is made
struct wxWebViewWasmEarly
{
    wxString userAgent;
    std::vector<wxString> handlers, scripts;
};
static std::map<const wxWebViewWasm *, wxWebViewWasmEarly> gs_early;
''', 1)
s = s.replace(anchors['create'], anchors['create'] + '''    // (z58) settings made before Create
    auto early = gs_early.find(this);
    if ( early != gs_early.end() )
    {
        if ( !early->second.userAgent.empty() )
            wxpage_wv_user_agent(m_elementId, early->second.userAgent.utf8_str());
        for ( const wxString& h : early->second.handlers )
            wxpage_wv_handler(m_elementId, h.utf8_str(), 1);
        for ( const wxString& js : early->second.scripts )
            wxpage_wv_user_script(m_elementId, js.utf8_str());
        gs_early.erase(early);
    }
''', 1)
s = s.replace(anchors['dtor'], anchors['dtor'] + '    gs_early.erase(this);   // (z58)\n', 1)
s = s.replace(anchors['ua'], anchors['ua'] + '''    if ( !m_elementId )   // (z58) no frame yet
    {
        gs_early[this].userAgent = userAgent;
        return true;
    }
''', 1)
s = s.replace(anchors['handler'], anchors['handler'] + '''    if ( !m_elementId )   // (z58) no frame yet
    {
        gs_early[this].handlers.push_back(name);
        return true;
    }
''', 1)
s = s.replace(anchors['unhandler'], anchors['unhandler'] + '''    if ( !m_elementId )   // (z58) no frame yet
    {
        std::vector<wxString>& h = gs_early[this].handlers;
        h.erase(std::remove(h.begin(), h.end(), name), h.end());
        return true;
    }
''', 1)
s = s.replace(anchors['script'], anchors['script'] + '''    if ( !m_elementId )   // (z58) no frame yet
    {
        gs_early[this].scripts.push_back(javascript);
        return true;
    }
''', 1)
s = s.replace(anchors['unscript'], anchors['unscript'] + '''    if ( !m_elementId )   // (z58) no frame yet
    {
        gs_early[this].scripts.clear();
        return;
    }
''', 1)
s = s.replace(anchors['run'], anchors['run'] + '''    if ( !m_elementId )   // (z58) no frame, no page
        return false;
''', 1)
s = s.replace(anchors['reload'], '    if ( !m_elementId )   // (z58) no frame\n        return;\n' + anchors['reload'], 1)
s = s.replace(anchors['load'], '    if ( !m_elementId )   // (z58) no frame\n        return;\n' + anchors['load'], 1)
s = s.replace(anchors['html'], '    if ( !m_elementId )   // (z58) no frame\n        return;\n' + anchors['html'], 1)
for inc in ('#include <vector>\n', '#include <algorithm>\n'):
    if inc not in s:
        s = s.replace('#include <map>\n', '#include <map>\n' + inc, 1)
open(W, 'w').write(s)
print('z58 applied')
