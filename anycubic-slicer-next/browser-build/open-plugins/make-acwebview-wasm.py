# Anycubic Slicer Next replaces wx's web view with its own copy of wx 3.3's (open-plugins/WebView, "ACWebView": same
# class names, its own backends for Edge/WebKit). A browser tab has neither: this writes the port's wasm backend (the
# <iframe> one every browser slicer uses, owx/src/wasm/webview_wasm.cpp + its header) as an ACWebView backend, so the
# program has ONE wxWebView (Anycubic's) with the browser backend under it. Made from the wx port's current files at
# every build, so shared changes to the backend carry over.  python3 make-acwebview-wasm.py <owx> <out dir>
#
import sys, os, re
owx, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
h = open(os.path.join(owx, 'include/wx/wasm/webview_wasm.h')).read()
c = open(os.path.join(owx, 'src/wasm/webview_wasm.cpp')).read()
def common(s):
    s = s.replace('#include "wx/webview.h"', '#include <webview/webview.h>')
    s = s.replace('#include "wx/wasm/webview_wasm.h"', '#include "webview_wasm_ac.h"')
    s = s.replace('wxUSE_WEBVIEW && defined(__WXWASM__)', 'USE_WEBVIEW && defined(__WXWASM__)')
    s = s.replace('extern WXDLLIMPEXP_DATA_WEBVIEW(const char)', 'extern ACWEBVIEW_API const char')
    s = s.replace('WXDLLIMPEXP_WEBVIEW', 'ACWEBVIEW_API')
    return s
h = common(h)
c = common(c)
# wx 3.3's web view runs every script through RunScriptAsync (RunScript waits for its result event); the wasm frame
# answers at once, so the async call is the sync one plus the result event, as wx 3.3 documents it (IsError = GetInt 0).
a = '    bool RunScript(const wxString& javascript, wxString* output = NULL) const wxOVERRIDE;\n'
assert h.count(a) == 1, 'RunScript declaration moved'
h = h.replace(a, a + '    void RunScriptAsync(const wxString& javascript, void* clientData = nullptr) const wxOVERRIDE;\n')
# wx 3.3's history item is the platform's own class; the wasm one is wx's generic wxWebViewHistoryItem
c += '''
#if USE_WEBVIEW && defined(__WXWASM__)
void wxWebViewWasm::RunScriptAsync(const wxString& javascript, void* clientData) const
{
    wxString output;
    const bool ok = RunScript(javascript, &output);
    wxWebViewWasm* self = const_cast<wxWebViewWasm*>(this);
    wxWebViewEvent* event = new wxWebViewEvent(wxEVT_WEBVIEW_SCRIPT_RESULT, GetId(), m_url, "");
    event->SetEventObject(self);
    event->SetString(output);
    event->SetInt(ok ? 1 : 0);
    event->SetClientData(clientData);
    self->GetEventHandler()->QueueEvent(event);
}
#endif
'''
open(os.path.join(out, 'webview_wasm_ac.h'), 'w').write(h)
open(os.path.join(out, 'webview_wasm_ac.cpp'), 'w').write(c)
print('acwebview wasm backend written to', out)
