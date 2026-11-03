# The browser is the web engine: the wasm port's web view also answers to the WebKit backend name. PrusaSlicer
# (WebView.cpp webview_new) asks wxWebView::IsBackendAvailable(wxWebViewBackendWebKit) on every non-Windows
# system, as WebKitGTK and WKWebView both register under that name; the port registered only "wxWebViewWasm", so
# Prusa got no web view at all ("Failed to create wxWebView object": Printables/Connect tabs, log-in) and the web
# view service worker (also the package's file cache) was never registered. Orca/Bambu ask for the default (Wasm)
# and are unchanged. Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/common/webview.cpp', '''        RegisterFactory(wxWebViewBackendWasm, wxSharedPtr<wxWebViewFactory>
                                                       (new wxWebViewFactoryWasm));
''', '''        RegisterFactory(wxWebViewBackendWasm, wxSharedPtr<wxWebViewFactory>
                                                       (new wxWebViewFactoryWasm));
    // the slicers ask for "WebKit" on Linux/macOS by name; in a browser the browser is that engine
    if(m_factoryMap.find(wxWebViewBackendWebKit) == m_factoryMap.end())
        RegisterFactory(wxWebViewBackendWebKit, wxSharedPtr<wxWebViewFactory>
                                                       (new wxWebViewFactoryWasm));
''')
