# A GL context is placed only over a canvas that is in a window tree (z79. Run in pwx.)
#
# Seen (KiCad k38): closing the PCB editor -> "RuntimeError: null function or function signature mismatch" in
# wxGLContext::PlaceOver < SetCurrent < GL_CONTEXT_MANAGER::LockCtx < ~OPENGL_GAL < ~FOOTPRINT_PREVIEW_PANEL <
# wxWindowBase::DestroyChildren. On k37 the same close killed the wx main thread: the whole program froze.
# Cause: OPENGL_GAL's destructor makes its context current to free its GL objects (desktop: a plain make-current).
# Ours also positions the context's page element over the canvas (PlaceOver), which reads the canvas's screen place
# through wxGetTopLevelParent(&win)->GetScreenPosition(). The canvas is being destroyed and already out of its window
# tree, so the top-level parent is null; a null object's virtual call in wasm reads table slot 0 = "null function".
# Fix: placing is for a canvas on screen. A canvas being deleted, or one with no top-level window, gets its element
# hidden (Detach) and no geometry is read. SetCurrent still makes the context current, so the GL clean-up runs.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _wxforms import sub

sub('src/wasm/glcanvas.cpp', '''    if (!m_elementId)
        return;

    int host = TopLevelId(win);
    if (host && host != m_lastHost)
    {
        wxglSetHost(m_elementId, host);
        m_lastHost = host;
    }

    wxWindow *tlw = wxGetTopLevelParent(const_cast<wxGLCanvas*>(&win));
    wxPoint origin''', '''    if (!m_elementId)
        return;

    wxWindow *tlw = wxGetTopLevelParent(const_cast<wxGLCanvas*>(&win));   // (z79) read first
    if (!tlw || win.IsBeingDeleted())   // (z79) a canvas leaving its window tree: nothing to place over, no geometry to read
    {
        Detach();   // (z79)
        return;
    }

    int host = TopLevelId(win);
    if (host && host != m_lastHost)
    {
        wxglSetHost(m_elementId, host);
        m_lastHost = host;
    }

    wxPoint origin''')
