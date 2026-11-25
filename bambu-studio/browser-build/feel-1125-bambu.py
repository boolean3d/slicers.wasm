#!/usr/bin/env python3
# slicer-feel-1125: Bambu Studio source edits for the browser build. Run on the Bambu Studio tree at its pin, after
# patches/bambu-studio.patch:  python3 feel-1125-bambu.py <bambu tree>   (then `git diff` there = the new patch).
# Each edit must match exactly once; a tree that already has it is left alone (safe to rerun).
#
# 1. Left-drag of an object on the plate: the drag starts only when the point under the cursor, read from the depth
#    buffer (GLCanvas3D::_mouse_to_3d -> glReadPixels DEPTH_COMPONENT), lies in the object's box. WebGL 2 refuses to
#    read a depth buffer, so the point was garbage and no drag ever started (move handles work: they use a ray). Under
#    __EMSCRIPTEN__ _mouse_to_3d finds the same point by casting the cursor's ray at the scene's volumes with Bambu's
#    own MeshRaycaster (as its gizmos do), the bed plane behind them on the main frame, the far plane behind that.
#    Zoom to the cursor and Ctrl+rotate, which read the depth the same way, get the right point too.
# 2. No Project tab and no Filament Manager tab (it hangs the tab): Bambu's own switch for the Filament Manager
#    (is_fila_manager_disabled: no tab, no store, no sync), the Project panel made but never put on the bar.
# 3. No File > Quit: the program ending leaves the tab empty (the page shows its own "closed" screen if it ever ends).
# 4. em (the unit every size in the program is made of: the sidebar is 42 em) from the font, as the Linux desktop
#    takes it (GTK: width of "m" less one), not 10 px x the display scale: the sidebar, its rows and boxes come out
#    as on the desktop at the same window size (465 px wide at 1440, was 420).
import sys, pathlib

root = pathlib.Path(sys.argv[1])

def edit(rel, old, new, done_marker):
    p = root / rel
    s = p.read_text()
    if done_marker in s:
        print(f'{rel}: already has "{done_marker}"')
        return
    n = s.count(old)
    if n != 1:
        sys.exit(f'{rel}: expected the text once, found it {n} times:\n{old}')
    p.write_text(s.replace(old, new))
    print(f'{rel}: edited ({done_marker})')

# ---- 1. the point under the cursor without a depth read
edit('src/slic3r/GUI/GLCanvas3D.cpp',
'''#include "slic3r/GUI/BitmapCache.hpp"
''',
'''#include "slic3r/GUI/BitmapCache.hpp"
#ifdef __EMSCRIPTEN__
#include "slic3r/GUI/MeshUtils.hpp" // (feel-1125) MeshRaycaster: the point under the cursor without a depth read
#endif
''', '(feel-1125) MeshRaycaster')
edit('src/slic3r/GUI/GLCanvas3D.cpp',
'''Vec3d GLCanvas3D::_mouse_to_3d(const Camera& camera, const Point& mouse_pos, float* z, const std::string& frame_name)
{
    if (m_canvas == nullptr)
        return Vec3d(DBL_MAX, DBL_MAX, DBL_MAX);
    Matrix4d modelview = camera.get_view_matrix().matrix();
    Matrix4d projection = camera.get_projection_matrix().matrix();
    Vec4i viewport(camera.get_viewport().data());
    GLint y = viewport[3] - (GLint)mouse_pos(1);
    GLfloat mouse_z;
    if (z == nullptr) {
''',
'''#ifdef __EMSCRIPTEN__
// (feel-1125) WebGL 2 cannot read a depth buffer (glReadPixels with DEPTH_COMPONENT is refused): the point the desktop
// takes from the depth under the cursor is where the cursor's ray (a at the near plane, b at the far plane) first meets
// a volume of the scene, by Bambu's MeshRaycaster, as its gizmos find points on a mesh; on the main frame the bed plane
// (z = 0) behind them; the far plane (b) when nothing is hit, as the desktop's cleared depth gives.
static Vec3d b3d_point_under_cursor(const GLVolumeCollection &volumes, const Model *model, const Vec3d &a, const Vec3d &b, bool bed)
{
    // one raycaster per mesh, kept while the mesh lives (the cache holds it); a new mesh after an edit gets its own
    static std::map<const TriangleMesh *, std::pair<std::shared_ptr<const TriangleMesh>, std::unique_ptr<MeshRaycaster>>> cache;
    const Vec3d dir = (b - a).normalized();
    double best = std::numeric_limits<double>::max();
    Vec3d out = b;
    if (model != nullptr) {
        for (const GLVolume *v : volumes.volumes) {
            if (v == nullptr || !v->is_active || v->is_wipe_tower || v->is_extrusion_path)
                continue;
            const int o = v->object_idx(), i = v->volume_idx();
            if (o < 0 || o >= int(model->objects.size()) || i < 0 || i >= int(model->objects[o]->volumes.size()))
                continue;
            const std::shared_ptr<const TriangleMesh> &mesh = model->objects[o]->volumes[i]->get_mesh_shared_ptr();
            if (!mesh || mesh->its.indices.empty())
                continue;
            auto it = cache.find(mesh.get());
            if (it == cache.end()) {
                if (cache.size() > 64)
                    cache.clear();
                it = cache.emplace(mesh.get(), std::make_pair(mesh, std::make_unique<MeshRaycaster>(*mesh))).first;
            }
            const Transform3d trafo = v->world_matrix();
            const Transform3d inv = trafo.inverse();
            const Vec3d s = inv * a;
            const Vec3d d = (inv * b - s).normalized();
            for (const auto &h : it->second.second->get_aabb_mesh().query_ray_hits(s, d)) {
                if (!h.is_hit())
                    continue;
                const Vec3d p = trafo * h.position();
                const double t = (p - a).dot(dir);
                if (t >= 0. && t < best) { best = t; out = p; }
            }
        }
    }
    if (best == std::numeric_limits<double>::max() && bed && std::abs(dir.z()) > 1e-12) {
        const double t = -a.z() / dir.z();
        if (t >= 0.)
            out = a + t * dir;
    }
    return out;
}
#endif // __EMSCRIPTEN__

Vec3d GLCanvas3D::_mouse_to_3d(const Camera& camera, const Point& mouse_pos, float* z, const std::string& frame_name)
{
    if (m_canvas == nullptr)
        return Vec3d(DBL_MAX, DBL_MAX, DBL_MAX);
    Matrix4d modelview = camera.get_view_matrix().matrix();
    Matrix4d projection = camera.get_projection_matrix().matrix();
    Vec4i viewport(camera.get_viewport().data());
    GLint y = viewport[3] - (GLint)mouse_pos(1);
    GLfloat mouse_z;
#ifdef __EMSCRIPTEN__
    if (z == nullptr) { // (feel-1125) no depth read in WebGL 2: the cursor's ray, cast at the scene
        Vec3d a, b;
        igl::unproject(Vec3d(mouse_pos(0), y, 0.), modelview, projection, viewport, a);
        igl::unproject(Vec3d(mouse_pos(0), y, 1.), modelview, projection, viewport, b);
        return b3d_point_under_cursor(m_volumes, m_model, a, b, frame_name.empty());
    }
#endif // __EMSCRIPTEN__
    if (z == nullptr) {
''', '(feel-1125) WebGL 2 cannot read a depth buffer')

# ---- 2. no Project tab, no Filament Manager tab
edit('src/slic3r/GUI/MainFrame.cpp',
'''    m_project->SetBackgroundColour(*wxWHITE);
    m_tabpanel->AddPage(m_project, _L("Project"), std::string("tab_auxiliary_avtice"), std::string("tab_auxiliary_avtice"), false);
''',
'''    m_project->SetBackgroundColour(*wxWHITE);
#ifdef __WXWASM__
    m_project->Hide(); // (feel-1125) no Project tab in the browser build: the panel is made (others call it), never shown
#else
    m_tabpanel->AddPage(m_project, _L("Project"), std::string("tab_auxiliary_avtice"), std::string("tab_auxiliary_avtice"), false);
#endif
''', '(feel-1125) no Project tab')
edit('src/slic3r/GUI/GUI_App.cpp',
'''    m_disable_fila_manager = is_fila_manager_disabled_by_config(
        app_config->get(FilaManagerEnabledConfigKey), is_macos);
''',
'''    m_disable_fila_manager = is_fila_manager_disabled_by_config(
        app_config->get(FilaManagerEnabledConfigKey), is_macos);
#ifdef __WXWASM__
    m_disable_fila_manager = true; // (feel-1125) no Filament Manager in the browser build: its page hung the tab
#endif
''', '(feel-1125) no Filament Manager')

# ---- 3. no Quit
edit('src/slic3r/GUI/MainFrame.cpp',
'''        fileMenu->AppendSeparator();

#ifndef __APPLE__
        append_menu_item(fileMenu, wxID_EXIT, _L("Quit"), wxString::Format(_L("Quit")),
            [this](wxCommandEvent&) { Close(false); }, "menu_exit", nullptr);
#else''',
'''#ifdef __WXWASM__
        // (feel-1125) no Quit in a browser tab: the program ending left the tab empty; the tab's own close is the way out
#elif !defined(__APPLE__)
        fileMenu->AppendSeparator();
        append_menu_item(fileMenu, wxID_EXIT, _L("Quit"), wxString::Format(_L("Quit")),
            [this](wxCommandEvent&) { Close(false); }, "menu_exit", nullptr);
#else
        fileMenu->AppendSeparator();''', '(feel-1125) no Quit')

# ---- 4. em from the font, as on the Linux desktop
edit('src/slic3r/GUI/GUI_Utils.hpp',
'''#if !defined(__WXGTK__)
        m_em_unit = std::max<size_t>(10, 10.0f * m_scale_factor);
#else''',
'''#if !defined(__WXGTK__) && !defined(__WXWASM__) // (feel-1125) the browser build takes em from the font, as GTK
        m_em_unit = std::max<size_t>(10, 10.0f * m_scale_factor);
#else''', '(feel-1125) the browser build takes em from the font')
