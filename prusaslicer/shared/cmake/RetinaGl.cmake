# The 3D view at display scaling (Windows 125-200 %, 2x screens): the browser port works in CSS pixels with a content
# scale factor (window.devicePixelRatio), as wxGTK3 and macOS do, and the GL canvas's drawing buffer is CSS size x scale
# (wxwidgets-opengl glcanvas.cpp). The slicers turn their scaled-GL path on only for those two
#   GLCanvas3D.hpp: #define ENABLE_RETINA_GL (__APPLE__ || __WXGTK3__)
# so in the browser the viewport, picking and ImGui assumed scale 1: the 3D view drew in the bottom-left corner at the
# wrong size. This takes the GTK3 path in GLCanvas3D.cpp (the only user) without touching GLCanvas3D.hpp, so the class
# layout every other file sees is unchanged: the scale comes from the canvas each time it is asked, as the GTK3
# RetinaHelper does (GetContentScaleFactor), instead of from a RetinaHelper member.
# Same text in Bambu Studio 2.08, OrcaSlicer 2.3.2 and PrusaSlicer 2.9.6. Needs PatchedCopies (orca_gui_patch).
function(slicer_retina_gl_patch target)
    orca_gui_patch(${target} slic3r/GUI/GLCanvas3D.cpp
        FIND "#if ENABLE_RETINA_GL
#include \"slic3r/Utils/RetinaHelper.hpp\"
#endif"
        REPLACE "#if ENABLE_RETINA_GL
#include \"slic3r/Utils/RetinaHelper.hpp\"
#endif
#if defined(__EMSCRIPTEN__) && !ENABLE_RETINA_GL
// Browser: the GTK3 scaled-GL path (shared/cmake/RetinaGl.cmake).
namespace Slic3r { namespace GUI { namespace {
struct WasmRetinaHelper {
    wxWindow *window;
    float get_scale_factor() const { return float(window->GetContentScaleFactor()); }
    void  set_use_retina(bool) const {}
    bool  get_use_retina() const { return true; }
    const WasmRetinaHelper *operator->() const { return this; }
};
} } }
#undef ENABLE_RETINA_GL
#define ENABLE_RETINA_GL 1
#define m_retina_helper WasmRetinaHelper{m_canvas}
#endif"
        FIND "#if ENABLE_RETINA_GL
    , m_retina_helper(nullptr)"
        REPLACE "#if ENABLE_RETINA_GL && !defined(__EMSCRIPTEN__)
    , m_retina_helper(nullptr)"
        FIND "#if ENABLE_RETINA_GL
        m_retina_helper.reset(new RetinaHelper(canvas));"
        REPLACE "#if ENABLE_RETINA_GL && !defined(__EMSCRIPTEN__)
        m_retina_helper.reset(new RetinaHelper(canvas));"
    )
endfunction()
