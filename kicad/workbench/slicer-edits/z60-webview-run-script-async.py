# A web view runs a script asked for without waiting (RunScriptAsync) and posts its result, as the other ports do (z60,
#. The port had only RunScript; the stock base RunScriptAsync shows "RunScriptAsync not supported"
# as an error dialog (KiCad's File > New Project template preview styles its page with RunScriptAsync on every load).
# Now it runs the script in the page (RunScript) and sends the result event (wxEVT_WEBVIEW_SCRIPT_RESULT) with the
# caller's clientData. Trees lacking the anchors skip.
import sys
H = 'include/wx/wasm/webview_wasm.h'
W = 'src/wasm/webview_wasm.cpp'
h = open(H).read()
s = open(W).read()
if '(z60)' in s:
    sys.exit(0)
ha = '    bool RunScript(const wxString& javascript, wxString* output = NULL) const wxOVERRIDE;\n'
sa = 'bool wxWebViewWasm::AddScriptMessageHandler(const wxString& name)\n{\n'
if h.count(ha) != 1 or s.count(sa) != 1:
    print('z60: anchor not found once in %s / %s, skipped' % (H, W)); sys.exit(0)
h = h.replace(ha, ha + '    void RunScriptAsync(const wxString& javascript, void* clientData = NULL) const wxOVERRIDE;   // (z60)\n', 1)
s = s.replace(sa, '''// (z60) run now, answer with the result event, as the other ports do
void wxWebViewWasm::RunScriptAsync(const wxString& javascript, void* clientData) const
{
    wxString output;
    const bool ok = RunScript(javascript, &output);
    SendScriptResult(clientData, ok, output);
}

''' + sa, 1)
open(H, 'w').write(h)
open(W, 'w').write(s)
