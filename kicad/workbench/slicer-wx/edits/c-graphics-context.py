# wxGraphicsContext for the wasm port (spike/wxgc: src/wasm/graphics.cpp + js/wxgc.js). The port had no renderer:
# GetDefaultRenderer fell to graphicc.cpp's "other ports use Cairo", and without Cairo that is NULL, so every
# wxGCDC / wxGraphicsContext::Create crashed (Bambu Studio's plate names, many of its widgets). Now the wasm port has
# its own default renderer, as MSW, OSX and Qt have, and the renderer reaches the canvas context id of a wxDC. Run in owx.
def sub(p, a, b):
    s = open(p).read()
    if b in s: return
    assert s.count(a) == 1, (p, a)
    open(p, 'w').write(s.replace(a, b))

sub('src/generic/graphicc.cpp', '''#if !(defined(__WXMSW__) || defined(__WXOSX__) || (defined(__WXQT__) && defined(__WIN32__)))
wxGraphicsRenderer* wxGraphicsRenderer::GetDefaultRenderer()''', '''#if !(defined(__WXMSW__) || defined(__WXOSX__) || defined(__WXWASM__) || (defined(__WXQT__) && defined(__WIN32__)))
wxGraphicsRenderer* wxGraphicsRenderer::GetDefaultRenderer()''')

sub('include/wx/wasm/dc.h', '''    // implementation
    int GetJavascriptId() { return m_jsId; }''', '''public:
    // implementation (also wxGraphicsContext's, src/wasm/graphics.cpp)
    int GetJavascriptId() { return m_jsId; }''')
