/////////////////////////////////////////////////////////////////////////////
// Name:        wx/wasm/glcanvas.h
// Purpose:     wxGLCanvas for the WebAssembly port. A WebGL2 context is tied
//              to one <canvas> element, but desktop wx shares one wxGLContext
//              between many wxGLCanvas windows (Orca: 3D view, preview,
//              assemble view). So the context owns the <canvas> element and
//              SetCurrent(win) lays it over that window's rectangle.
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#ifndef _WX_WASM_GLCANVAS_H_
#define _WX_WASM_GLCANVAS_H_

#include <emscripten/html5.h>
#include <GLES3/gl3.h>

class WXDLLIMPEXP_GL wxGLContext : public wxGLContextBase
{
public:
    wxGLContext(wxGLCanvas *win,
                const wxGLContext *other = NULL,
                const wxGLContextAttrs *ctxAttrs = NULL);
    virtual ~wxGLContext();

    virtual bool SetCurrent(const wxGLCanvas& win) const wxOVERRIDE;

    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE GetHandle() const { return m_handle; }

    // Moves/resizes/hides this context's <canvas> element to match win
    void PlaceOver(const wxGLCanvas& win) const;
    // The canvas went away: hide the element until the next SetCurrent
    void Detach() const;

private:
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE m_handle;
    int m_elementId;
    mutable int m_lastHost;
    mutable wxRect m_lastRect;
    mutable bool m_lastShown;
    mutable double m_lastScale;

    wxDECLARE_CLASS(wxGLContext);
};

class WXDLLIMPEXP_GL wxGLCanvas : public wxGLCanvasBase
{
public:
    wxGLCanvas() { Init(); }

    explicit
    wxGLCanvas(wxWindow *parent,
               const wxGLAttributes& dispAttrs,
               wxWindowID id = wxID_ANY,
               const wxPoint& pos = wxDefaultPosition,
               const wxSize& size = wxDefaultSize,
               long style = 0,
               const wxString& name = wxGLCanvasName,
               const wxPalette& palette = wxNullPalette);

    explicit
    wxGLCanvas(wxWindow *parent,
               wxWindowID id = wxID_ANY,
               const int *attribList = NULL,
               const wxPoint& pos = wxDefaultPosition,
               const wxSize& size = wxDefaultSize,
               long style = 0,
               const wxString& name = wxGLCanvasName,
               const wxPalette& palette = wxNullPalette);

    virtual ~wxGLCanvas();

    // The scale the drawing buffer is made at: the page's devicePixelRatio as it is (1.25, 1.5 on Windows), not
    // the windows' rounded content scale (1 or 2, wasm display.cpp), so a program sizing its GL viewport by
    // GetContentScaleFactor (the slicers' GTK3/macOS path) fills the canvas exactly.
    virtual double GetContentScaleFactor() const wxOVERRIDE;

    bool Create(wxWindow *parent,
                const wxGLAttributes& dispAttrs,
                wxWindowID id = wxID_ANY,
                const wxPoint& pos = wxDefaultPosition,
                const wxSize& size = wxDefaultSize,
                long style = 0,
                const wxString& name = wxGLCanvasName,
                const wxPalette& palette = wxNullPalette);

    bool Create(wxWindow *parent,
                wxWindowID id = wxID_ANY,
                const wxPoint& pos = wxDefaultPosition,
                const wxSize& size = wxDefaultSize,
                long style = 0,
                const wxString& name = wxGLCanvasName,
                const int *attribList = NULL,
                const wxPalette& palette = wxNullPalette);

    virtual bool SwapBuffers() wxOVERRIDE;
    virtual bool Show(bool show = true) wxOVERRIDE;
    // a parent page shown or hidden (a notebook tab) moves no canvas: its element follows on the next idle
    virtual void OnInternalIdle() wxOVERRIDE;

    // Lays the <canvas> element of the context last made current on this
    // window (if any) over this window's rectangle
    void SyncElement();

protected:
    virtual void DoMoveWindow(int x, int y, int width, int height) wxOVERRIDE;

private:
    void Init();

    wxDECLARE_CLASS(wxGLCanvas);
};

#endif // _WX_WASM_GLCANVAS_H_
