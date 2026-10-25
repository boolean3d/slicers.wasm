/////////////////////////////////////////////////////////////////////////////
// Name:        src/wasm/glcanvas.cpp
// Purpose:     wxGLCanvas for the WebAssembly port (WebGL2)
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#include "wx/wxprec.h"

#if wxUSE_GLCANVAS

#include "wx/glcanvas.h"
#include "wx/toplevel.h"

#include <emscripten.h>
#include <map>
#include <string>

// Off-thread model: main() runs in a worker. The <canvas id=wxgl-N> element lives on the page inside the
// top-level window's div (wxpage_gl_*, bulk/page-bridge.js); its bitmap is transferred to this worker as an
// OffscreenCanvas (wx.js wxGlAttach registers it in GL.offscreenCanvases so emscripten_webgl_create_context
// finds "#wxgl-N" here). The element takes no pointer events: the page forwards them to wx as before.
extern "C" {
    void wxpage_gl_create(int id, int windowId);
    void wxpage_gl_set_host(int id, int windowId);
    void wxpage_gl_set_rect(int id, int x, int y, int w, int h, int shown);
    void wxpage_gl_destroy(int id);
}
EM_JS(int, wxglNextId, (), {
    if (typeof Module.wxglNextId === 'undefined') Module.wxglNextId = 1;
    return Module.wxglNextId++;
});
EM_ASYNC_JS(int, wxglWaitCanvas, (int id), { return await wxGlWait(id); });
EM_JS(void, wxglSizeCanvas, (int id, int pw, int ph), { wxGlSize(id, pw, ph); });
EM_JS(void, wxglDrop, (int id), { wxGlDrop(id); });

static int wxglCreateElement(int windowId)
{
    int id = wxglNextId();
    wxpage_gl_create(id, windowId);   // the page makes the element and posts its OffscreenCanvas to us
    wxglWaitCanvas(id);               // one JSPI suspension until it arrives (we are on main's stack)
    return id;
}

static void wxglSetHost(int id, int windowId) { wxpage_gl_set_host(id, windowId); }

static void wxglSetRect(int id, int x, int y, int w, int h, int shown, double scale)
{
    int pw = w * scale > 1 ? (int)(w * scale + 0.5) : 1;
    int ph = h * scale > 1 ? (int)(h * scale + 0.5) : 1;
    wxglSizeCanvas(id, pw, ph);                      // the bitmap is ours
    wxpage_gl_set_rect(id, x, y, w, h, shown);       // the CSS box is the page's
}

static void wxglDestroyElement(int id) { wxglDrop(id); wxpage_gl_destroy(id); }

EM_JS(double, wxglScale, (), {
    return wxPageDpr || 1;
});

// ----------------------------------------------------------------------------
// wxGLContextAttrs / wxGLAttributes: WebGL takes its options when the context
// is made (see wxGLContext), so these only keep the chain working
// ----------------------------------------------------------------------------

wxGLContextAttrs& wxGLContextAttrs::CoreProfile() { return *this; }
wxGLContextAttrs& wxGLContextAttrs::MajorVersion(int) { return *this; }
wxGLContextAttrs& wxGLContextAttrs::MinorVersion(int) { return *this; }
wxGLContextAttrs& wxGLContextAttrs::CompatibilityProfile() { return *this; }
wxGLContextAttrs& wxGLContextAttrs::ForwardCompatible() { return *this; }
wxGLContextAttrs& wxGLContextAttrs::ES2() { return *this; }
wxGLContextAttrs& wxGLContextAttrs::DebugCtx() { return *this; }
wxGLContextAttrs& wxGLContextAttrs::Robust() { return *this; }
wxGLContextAttrs& wxGLContextAttrs::NoResetNotify() { return *this; }
wxGLContextAttrs& wxGLContextAttrs::LoseOnReset() { return *this; }
wxGLContextAttrs& wxGLContextAttrs::ResetIsolation() { return *this; }
wxGLContextAttrs& wxGLContextAttrs::ReleaseFlush(int) { return *this; }
wxGLContextAttrs& wxGLContextAttrs::PlatformDefaults() { renderTypeRGBA = true; x11Direct = true; return *this; }
void wxGLContextAttrs::EndList() { AddAttribute(0); SetNeedsARB(false); }

wxGLAttributes& wxGLAttributes::RGBA() { return *this; }
wxGLAttributes& wxGLAttributes::BufferSize(int) { return *this; }
wxGLAttributes& wxGLAttributes::Level(int) { return *this; }
wxGLAttributes& wxGLAttributes::DoubleBuffer() { return *this; }
wxGLAttributes& wxGLAttributes::Stereo() { return *this; }
wxGLAttributes& wxGLAttributes::AuxBuffers(int) { return *this; }
wxGLAttributes& wxGLAttributes::MinRGBA(int, int, int, int) { return *this; }
wxGLAttributes& wxGLAttributes::Depth(int) { return *this; }
wxGLAttributes& wxGLAttributes::Stencil(int) { return *this; }
wxGLAttributes& wxGLAttributes::MinAcumRGBA(int, int, int, int) { return *this; }
wxGLAttributes& wxGLAttributes::SampleBuffers(int) { return *this; }
wxGLAttributes& wxGLAttributes::Samplers(int) { return *this; }
wxGLAttributes& wxGLAttributes::FrameBuffersRGB() { return *this; }
void wxGLAttributes::EndList() { AddAttribute(0); }
wxGLAttributes& wxGLAttributes::PlatformDefaults() { return *this; }
wxGLAttributes& wxGLAttributes::Defaults() { RGBA().DoubleBuffer().Depth(16).SampleBuffers(1).Samplers(4); return *this; }
void wxGLAttributes::AddDefaultsForWXBefore31() { }

bool wxGLCanvasBase::IsDisplaySupported(const wxGLAttributes&) { return true; }
bool wxGLCanvasBase::IsDisplaySupported(const int *) { return true; }

EM_JS(int, wxglHasExtension, (const char *name), {
    try {
        var c = new OffscreenCanvas(1, 1).getContext('webgl2');
        return c && c.getSupportedExtensions().indexOf(UTF8ToString(name)) >= 0 ? 1 : 0;
    } catch (e) { return 0; }
});

bool wxGLCanvasBase::IsExtensionSupported(const char *extension)
{
    return wxglHasExtension(extension) != 0;
}

// ----------------------------------------------------------------------------
// wxGLContext
// ----------------------------------------------------------------------------

wxIMPLEMENT_CLASS(wxGLContext, wxObject);

// Which context's element each canvas carries now (the last SetCurrent on it)
static std::map<const wxGLCanvas*, const wxGLContext*> gs_placed;

static int TopLevelId(const wxWindow& win)
{
    wxTopLevelWindow *tlw = wxDynamicCast(wxGetTopLevelParent(const_cast<wxWindow*>(&win)), wxTopLevelWindow);
    return tlw ? tlw->GetCSSId() : 0;
}

wxGLContext::wxGLContext(wxGLCanvas *win,
                         const wxGLContext *WXUNUSED(other),
                         const wxGLContextAttrs *WXUNUSED(ctxAttrs))
    : m_handle(0), m_elementId(0), m_lastHost(0), m_lastShown(false), m_lastScale(0)
{
    m_isOk = false;
    int host = TopLevelId(*win);
    wxCHECK_RET(host, "wxGLContext needs a canvas inside a top-level window");
    m_elementId = wxglCreateElement(host);
    m_lastHost = host;
    const std::string selector = "#wxgl-" + std::to_string(m_elementId);

    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.minorVersion = 0;
    attrs.alpha = false;
    attrs.depth = true;
    attrs.stencil = true;
    attrs.antialias = true;
    attrs.preserveDrawingBuffer = true;
    attrs.enableExtensionsByDefault = true;

    m_handle = emscripten_webgl_create_context(selector.c_str(), &attrs);
    m_isOk = m_handle > 0;
    if (!m_isOk)
    {
        wxLogError("WebGL2 context could not be created (%d)", (int)m_handle);
        return;
    }

    // A desktop driver takes GL calls made before the first SetCurrent (Orca
    // makes textures while loading the printer, before its first paint);
    // WebGL has no context to send them to and stops. Emscripten keeps one
    // current context, so the first one made becomes current.
    if (emscripten_webgl_get_current_context() == 0)
        emscripten_webgl_make_context_current(m_handle);
    gs_placed[win] = this;
    PlaceOver(*win);
}

wxGLContext::~wxGLContext()
{
    for (auto it = gs_placed.begin(); it != gs_placed.end(); )
        it = it->second == this ? gs_placed.erase(it) : std::next(it);
    if (m_handle > 0)
        emscripten_webgl_destroy_context(m_handle);
    if (m_elementId)
        wxglDestroyElement(m_elementId);
}

bool wxGLContext::SetCurrent(const wxGLCanvas& win) const
{
    if (m_handle <= 0)
        return false;
    for (auto it = gs_placed.begin(); it != gs_placed.end(); )
        it = it->second == this && it->first != &win ? gs_placed.erase(it) : std::next(it);
    gs_placed[&win] = this;
    PlaceOver(win);
    return emscripten_webgl_make_context_current(m_handle) == EMSCRIPTEN_RESULT_SUCCESS;
}

void wxGLContext::PlaceOver(const wxGLCanvas& win) const
{
    if (!m_elementId)
        return;

    int host = TopLevelId(win);
    if (host && host != m_lastHost)
    {
        wxglSetHost(m_elementId, host);
        m_lastHost = host;
    }

    wxWindow *tlw = wxGetTopLevelParent(const_cast<wxGLCanvas*>(&win));
    wxPoint origin = win.ClientToScreen(wxPoint(0, 0)) - tlw->GetScreenPosition();
    wxRect rect(origin, win.GetClientSize());
    bool shown = win.IsShownOnScreen();
    double scale = wxglScale();

    if (rect == m_lastRect && shown == m_lastShown && scale == m_lastScale)
        return;

    m_lastRect = rect;
    m_lastShown = shown;
    m_lastScale = scale;
    wxglSetRect(m_elementId, rect.x, rect.y, rect.width, rect.height, shown, scale);
}

void wxGLContext::Detach() const
{
    m_lastShown = false;
    m_lastRect = wxRect();
    if (m_elementId)
        wxglSetRect(m_elementId, 0, 0, 0, 0, 0, 1);
}

// ----------------------------------------------------------------------------
// wxGLCanvas
// ----------------------------------------------------------------------------

wxIMPLEMENT_CLASS(wxGLCanvas, wxWindow);

void wxGLCanvas::Init()
{
}

wxGLCanvas::wxGLCanvas(wxWindow *parent,
                       const wxGLAttributes& dispAttrs,
                       wxWindowID id,
                       const wxPoint& pos,
                       const wxSize& size,
                       long style,
                       const wxString& name,
                       const wxPalette& palette)
{
    Init();
    Create(parent, dispAttrs, id, pos, size, style, name, palette);
}

wxGLCanvas::wxGLCanvas(wxWindow *parent,
                       wxWindowID id,
                       const int *attribList,
                       const wxPoint& pos,
                       const wxSize& size,
                       long style,
                       const wxString& name,
                       const wxPalette& palette)
{
    Init();
    Create(parent, id, pos, size, style, name, attribList, palette);
}

wxGLCanvas::~wxGLCanvas()
{
    auto it = gs_placed.find(this);
    if (it != gs_placed.end())
    {
        it->second->Detach();
        gs_placed.erase(it);
    }
}

bool wxGLCanvas::Create(wxWindow *parent,
                        const wxGLAttributes& WXUNUSED(dispAttrs),
                        wxWindowID id,
                        const wxPoint& pos,
                        const wxSize& size,
                        long style,
                        const wxString& name,
                        const wxPalette& WXUNUSED(palette))
{
    if (!wxWindow::Create(parent, id, pos, size, style | wxFULL_REPAINT_ON_RESIZE, name))
        return false;

    wxCHECK_MSG(TopLevelId(*this), false, "wxGLCanvas needs a top-level parent");
    return true;
}

bool wxGLCanvas::Create(wxWindow *parent,
                        wxWindowID id,
                        const wxPoint& pos,
                        const wxSize& size,
                        long style,
                        const wxString& name,
                        const int *attribList,
                        const wxPalette& palette)
{
    wxGLAttributes dispAttrs;
    if (!ParseAttribList(attribList, dispAttrs))
        return false;
    return Create(parent, dispAttrs, id, pos, size, style, name, palette);
}

void wxGLCanvas::SyncElement()
{
    auto it = gs_placed.find(this);
    if (it != gs_placed.end())
        it->second->PlaceOver(*this);
}

void wxGLCanvas::DoMoveWindow(int x, int y, int width, int height)
{
    wxGLCanvasBase::DoMoveWindow(x, y, width, height);
    SyncElement();
}

bool wxGLCanvas::Show(bool show)
{
    bool changed = wxGLCanvasBase::Show(show);
    SyncElement();
    return changed;
}

void wxGLCanvas::OnInternalIdle()
{
    wxGLCanvasBase::OnInternalIdle();
    SyncElement();
}

double wxGLCanvas::GetContentScaleFactor() const
{
    return wxglScale();
}

bool wxGLCanvas::SwapBuffers()
{
    // WebGL presents the drawing buffer when control returns to the browser.
    SyncElement();
    return true;
}

// ----------------------------------------------------------------------------
// wxGLApp
// ----------------------------------------------------------------------------

bool wxGLApp::InitGLVisual(const int *WXUNUSED(attribList))
{
    return true;
}

#endif // wxUSE_GLCANVAS
