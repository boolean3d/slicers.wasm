# Out-of-tree source changes for the browser tab (cmake/PatchedCopies.cmake makes patched copies in the build tree;
# PrusaSlicer's checkout is never modified). Each says why.

# The web view helpers: the Linux file is WebKitGTK; the browser one is stand-ins/WebViewPlatformUtilsWasm.cpp.
orca_gui_swap(libslic3r_gui slic3r/GUI/WebViewPlatformUtilsLinux.cpp "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/WebViewPlatformUtilsWasm.cpp")

# The G-code viewer's OpenGL ES path (libvgcode, ENABLE_OPENGL_ES) was not updated when PrusaSlicer 2.9 moved positions
# and heights/widths/angles to 4 floats (GL_RGBA32F, SPE-2411): ViewerImpl.cpp passes std::vector<Vec4> to the ES
# TextureData setters, which still take Vec3 and upload GL_RGB32F. Upstream bug, does not compile. The ES setters take
# the 4-float vectors and upload GL_RGBA32F, as the desktop path does (its texture buffers). Viewer.cpp is patched (a
# comment) only so it compiles next to the patched ViewerImpl.hpp.
set(_v4 "std::vector<std::array<float, 4>>")
orca_gui_patch(libvgcode libvgcode/src/ViewerImpl.hpp
    FIND [==[        void set_positions(const std::vector<Vec3>& positions);
        void set_heights_widths_angles(const std::vector<Vec3>& heights_widths_angles);]==]
    REPLACE "        void set_positions(const ${_v4}& positions);\n        void set_heights_widths_angles(const ${_v4}& heights_widths_angles);")
orca_gui_patch(libvgcode libvgcode/src/Viewer.cpp
    FIND [==[#include "ViewerImpl.hpp"]==] REPLACE [==[#include "ViewerImpl.hpp" // the patched copy beside this one]==])
orca_gui_patch(libvgcode libvgcode/src/ViewerImpl.cpp
    FIND [==[void ViewerImpl::TextureData::set_positions(const std::vector<Vec3>& positions)
{
    if (m_count == 0)
        return;

    for (TexIds& ids : m_tex_ids) {
        delete_textures(ids.positions.first);
        ids.positions.second = 0;
    }

    m_positions_size = 0;

    if (positions.empty())
        return;

    int curr_bound_texture = 0;
    glsafe(glGetIntegerv(GL_TEXTURE_BINDING_2D, &curr_bound_texture));
    int curr_unpack_alignment = 0;
    glsafe(glGetIntegerv(GL_UNPACK_ALIGNMENT, &curr_unpack_alignment));

    glsafe(glPixelStorei(GL_UNPACK_ALIGNMENT, 1));

    const size_t tex_capacity = max_texture_capacity();
    size_t remaining = positions.size();
    for (size_t i = 0; i < m_count; ++i) {
        const auto [w, h] = width_height(std::min(remaining, tex_capacity));
        const size_t offset = i * tex_capacity;

        glsafe(glGenTextures(1, &m_tex_ids[i].positions.first));
        glsafe(glBindTexture(GL_TEXTURE_2D, m_tex_ids[i].positions.first));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 0));
        if (remaining >= tex_capacity) {
            glsafe(glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB32F, static_cast<GLsizei>(w), static_cast<GLsizei>(h), 0, GL_RGB, GL_FLOAT, &positions[offset]));
            m_tex_ids[i].positions.second = w * h;
        }
        else {
            // the last row is only partially fitted with data, send it separately
            glsafe(glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB32F, static_cast<GLsizei>(w), static_cast<GLsizei>(h), 0, GL_RGB, GL_FLOAT, nullptr));
            glsafe(glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, static_cast<GLsizei>(w), static_cast<GLsizei>(h - 1), GL_RGB, GL_FLOAT, &positions[offset]));
            glsafe(glTexSubImage2D(GL_TEXTURE_2D, 0, 0, static_cast<GLsizei>(h - 1), static_cast<GLsizei>(remaining % w), 1, GL_RGB, GL_FLOAT, &positions[offset + w * (h - 1)]));
            m_tex_ids[i].positions.second = w * (h - 1) + remaining % w;
        }
        m_positions_size += m_tex_ids[i].positions.second * sizeof(Vec3);]==]
    REPLACE [==[void ViewerImpl::TextureData::set_positions(const std::vector<std::array<float, 4>>& positions)
{
    if (m_count == 0)
        return;

    for (TexIds& ids : m_tex_ids) {
        delete_textures(ids.positions.first);
        ids.positions.second = 0;
    }

    m_positions_size = 0;

    if (positions.empty())
        return;

    int curr_bound_texture = 0;
    glsafe(glGetIntegerv(GL_TEXTURE_BINDING_2D, &curr_bound_texture));
    int curr_unpack_alignment = 0;
    glsafe(glGetIntegerv(GL_UNPACK_ALIGNMENT, &curr_unpack_alignment));

    glsafe(glPixelStorei(GL_UNPACK_ALIGNMENT, 1));

    const size_t tex_capacity = max_texture_capacity();
    size_t remaining = positions.size();
    for (size_t i = 0; i < m_count; ++i) {
        const auto [w, h] = width_height(std::min(remaining, tex_capacity));
        const size_t offset = i * tex_capacity;

        glsafe(glGenTextures(1, &m_tex_ids[i].positions.first));
        glsafe(glBindTexture(GL_TEXTURE_2D, m_tex_ids[i].positions.first));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 0));
        if (remaining >= tex_capacity) {
            glsafe(glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, static_cast<GLsizei>(w), static_cast<GLsizei>(h), 0, GL_RGBA, GL_FLOAT, &positions[offset]));
            m_tex_ids[i].positions.second = w * h;
        }
        else {
            // the last row is only partially fitted with data, send it separately
            glsafe(glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, static_cast<GLsizei>(w), static_cast<GLsizei>(h), 0, GL_RGBA, GL_FLOAT, nullptr));
            glsafe(glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, static_cast<GLsizei>(w), static_cast<GLsizei>(h - 1), GL_RGBA, GL_FLOAT, &positions[offset]));
            glsafe(glTexSubImage2D(GL_TEXTURE_2D, 0, 0, static_cast<GLsizei>(h - 1), static_cast<GLsizei>(remaining % w), 1, GL_RGBA, GL_FLOAT, &positions[offset + w * (h - 1)]));
            m_tex_ids[i].positions.second = w * (h - 1) + remaining % w;
        }
        m_positions_size += m_tex_ids[i].positions.second * sizeof(std::array<float, 4>);]==]
    FIND [==[void ViewerImpl::TextureData::set_heights_widths_angles(const std::vector<Vec3>& heights_widths_angles)
{
    if (m_count == 0)
        return;

    for (TexIds& ids : m_tex_ids) {
        delete_textures(ids.heights_widths_angles.first);
        ids.heights_widths_angles.second = 0;
    }

    m_height_width_angle_size = 0;

    if (heights_widths_angles.empty())
        return;

    int curr_bound_texture = 0;
    glsafe(glGetIntegerv(GL_TEXTURE_BINDING_2D, &curr_bound_texture));
    int curr_unpack_alignment = 0;
    glsafe(glGetIntegerv(GL_UNPACK_ALIGNMENT, &curr_unpack_alignment));

    glsafe(glPixelStorei(GL_UNPACK_ALIGNMENT, 1));

    const size_t tex_capacity = max_texture_capacity();
    size_t remaining = heights_widths_angles.size();
    for (size_t i = 0; i < m_count; ++i) {
        const auto [w, h] = width_height(std::min(remaining, tex_capacity));
        const size_t offset = i * tex_capacity;

        glsafe(glGenTextures(1, &m_tex_ids[i].heights_widths_angles.first));
        glsafe(glBindTexture(GL_TEXTURE_2D, m_tex_ids[i].heights_widths_angles.first));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 0));
        if (remaining >= tex_capacity) {
            glsafe(glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB32F, static_cast<GLsizei>(w), static_cast<GLsizei>(h), 0, GL_RGB, GL_FLOAT, &heights_widths_angles[offset]));
            m_tex_ids[i].heights_widths_angles.second = w * h;
        }
        else {
            // the last row is only partially fitted with data, send it separately
            glsafe(glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB32F, static_cast<GLsizei>(w), static_cast<GLsizei>(h), 0, GL_RGB, GL_FLOAT, nullptr));
            glsafe(glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, static_cast<GLsizei>(w), static_cast<GLsizei>(h - 1), GL_RGB, GL_FLOAT, &heights_widths_angles[offset]));
            glsafe(glTexSubImage2D(GL_TEXTURE_2D, 0, 0, static_cast<GLsizei>(h - 1), static_cast<GLsizei>(remaining % w), 1, GL_RGB, GL_FLOAT, &heights_widths_angles[offset + w * (h - 1)]));
            m_tex_ids[i].heights_widths_angles.second = w * (h - 1) + remaining % w;
        }
        m_height_width_angle_size += m_tex_ids[i].heights_widths_angles.second * sizeof(Vec3);]==]
    REPLACE [==[void ViewerImpl::TextureData::set_heights_widths_angles(const std::vector<std::array<float, 4>>& heights_widths_angles)
{
    if (m_count == 0)
        return;

    for (TexIds& ids : m_tex_ids) {
        delete_textures(ids.heights_widths_angles.first);
        ids.heights_widths_angles.second = 0;
    }

    m_height_width_angle_size = 0;

    if (heights_widths_angles.empty())
        return;

    int curr_bound_texture = 0;
    glsafe(glGetIntegerv(GL_TEXTURE_BINDING_2D, &curr_bound_texture));
    int curr_unpack_alignment = 0;
    glsafe(glGetIntegerv(GL_UNPACK_ALIGNMENT, &curr_unpack_alignment));

    glsafe(glPixelStorei(GL_UNPACK_ALIGNMENT, 1));

    const size_t tex_capacity = max_texture_capacity();
    size_t remaining = heights_widths_angles.size();
    for (size_t i = 0; i < m_count; ++i) {
        const auto [w, h] = width_height(std::min(remaining, tex_capacity));
        const size_t offset = i * tex_capacity;

        glsafe(glGenTextures(1, &m_tex_ids[i].heights_widths_angles.first));
        glsafe(glBindTexture(GL_TEXTURE_2D, m_tex_ids[i].heights_widths_angles.first));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST));
        glsafe(glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 0));
        if (remaining >= tex_capacity) {
            glsafe(glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, static_cast<GLsizei>(w), static_cast<GLsizei>(h), 0, GL_RGBA, GL_FLOAT, &heights_widths_angles[offset]));
            m_tex_ids[i].heights_widths_angles.second = w * h;
        }
        else {
            // the last row is only partially fitted with data, send it separately
            glsafe(glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, static_cast<GLsizei>(w), static_cast<GLsizei>(h), 0, GL_RGBA, GL_FLOAT, nullptr));
            glsafe(glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, static_cast<GLsizei>(w), static_cast<GLsizei>(h - 1), GL_RGBA, GL_FLOAT, &heights_widths_angles[offset]));
            glsafe(glTexSubImage2D(GL_TEXTURE_2D, 0, 0, static_cast<GLsizei>(h - 1), static_cast<GLsizei>(remaining % w), 1, GL_RGBA, GL_FLOAT, &heights_widths_angles[offset + w * (h - 1)]));
            m_tex_ids[i].heights_widths_angles.second = w * (h - 1) + remaining % w;
        }
        m_height_width_angle_size += m_tex_ids[i].heights_widths_angles.second * sizeof(std::array<float, 4>);]==]
    FIND [==[#ifdef ENABLE_OPENGL_ES
    std::vector<Vec3> heights_widths_angles;
    heights_widths_angles.reserve(m_vertices.size());]==]
    REPLACE [==[#ifdef ENABLE_OPENGL_ES
    std::vector<Vec4> heights_widths_angles; // the second place (update_heights_widths)
    heights_widths_angles.reserve(m_vertices.size());]==])


# CGAL without GMP (the deps prefix sets CGAL_DISABLE_GMP): libigl's copyleft/cgal/assign_scalar.h (MeshBoolean.cpp)
# wants CGAL/gmpxx.h and Epeck_with_sqrt. The browser engine's compile-only placeholders (engine/shims/cgal, see the
# headers), searched before CGAL's own include directory, for libslic3r_cgal only.
target_include_directories(libslic3r_cgal SYSTEM BEFORE PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/stand-in-headers-cgal")

# Platform.cpp knows no Emscripten and stops at static_assert(false). The tab answers Unknown / Unknown, as the browser
# engine does (engine/stubs/Platform.cpp).
orca_gui_patch(libslic3r libslic3r/Platform.cpp
    FIND [==[	static_assert(false, "Unknown platform detected");]==]
    REPLACE [==[#ifndef __EMSCRIPTEN__
	static_assert(false, "Unknown platform detected");
#endif // the browser tab: Unknown, as the browser engine says (engine/stubs/Platform.cpp)]==])

# The data folder: the Linux rule (XDG_CONFIG_HOME, else $HOME/.config) -> /home/web_user/.config/PrusaSlicer in the tab.
orca_gui_patch(libslic3r libslic3r/Utils/DirectoriesUtils.cpp
    FIND [==[#elif defined(__linux__)]==]
    REPLACE [==[#elif defined(__linux__) || defined(__EMSCRIPTEN__)]==])

# The sign-in code challenge's SHA-256: the Linux branch's OpenSSL (in the deps prefix) has its headers on Linux only.
orca_gui_patch(libslic3r_gui slic3r/GUI/UserAccountCommunication.cpp
    FIND [==[#ifdef __linux__
#include <openssl/evp.h>]==]
    REPLACE [==[#if defined(__linux__) || defined(__EMSCRIPTEN__)
#include <openssl/evp.h>]==])

# "Show in folder": the Linux branch runs xdg-open (desktop_execute exists on Linux only); a tab has no file manager.
orca_gui_patch(libslic3r_gui slic3r/GUI/GUI.cpp
    FIND [==[#else
	const char* argv[] = { "xdg-open", path.string().c_str(), nullptr };
	desktop_execute(argv);
#endif]==]
    REPLACE [==[#elif defined(__EMSCRIPTEN__)
	// a browser tab has no file manager to open
#else
	const char* argv[] = { "xdg-open", path.string().c_str(), nullptr };
	desktop_execute(argv);
#endif]==])

# The downloads folder: Linux asks xdg-user-dir (desktop_execute_get_result, Linux only). In the tab it is
# /home/web_user/Downloads, where every file written becomes a browser download (wxwidgets-web filedlg).
orca_gui_patch(libslic3r_gui slic3r/GUI/ConfigWizard.cpp
    FIND [==[#else
    wxString get_downloads_path()
    {
        wxString command = "xdg-user-dir DOWNLOAD";]==]
    REPLACE [==[#elif defined(__EMSCRIPTEN__)
    wxString get_downloads_path()
    {
        return "/home/web_user/Downloads";
    }
#else
    wxString get_downloads_path()
    {
        wxString command = "xdg-user-dir DOWNLOAD";]==]
    FIND [==[    auto *box_slic3r = new wxCheckBox(this, wxID_ANY, _L("Check for application updates"));
    box_slic3r->SetValue(app_config->get("notify_release") != "none");
    append(box_slic3r);
    append_text(wxString::Format(_L(
        "If enabled, %s checks for new application versions online. When a new version becomes available, "
         "a notification is displayed at the next application startup (never during program usage). "
         "This is only a notification mechanisms, no automatic installation is done."), SLIC3R_APP_NAME));

    append_spacer(VERTICAL_SPACING);
]==]
    REPLACE [==[#ifndef __EMSCRIPTEN__ // the browser build is always the version on our site: no application update check
    auto *box_slic3r = new wxCheckBox(this, wxID_ANY, _L("Check for application updates"));
    box_slic3r->SetValue(app_config->get("notify_release") != "none");
    append(box_slic3r);
    append_text(wxString::Format(_L(
        "If enabled, %s checks for new application versions online. When a new version becomes available, "
         "a notification is displayed at the next application startup (never during program usage). "
         "This is only a notification mechanisms, no automatic installation is done."), SLIC3R_APP_NAME));

    append_spacer(VERTICAL_SPACING);
#endif
]==]
    FIND [==[    box_slic3r->Bind(wxEVT_CHECKBOX, [this](wxCommandEvent &event) { this->version_check = event.IsChecked(); });]==]
    REPLACE [==[#ifndef __EMSCRIPTEN__
    box_slic3r->Bind(wxEVT_CHECKBOX, [this](wxCommandEvent &event) { this->version_check = event.IsChecked(); });
#endif]==]
    FIND [==[    index->add_page(page_login);]==]
    REPLACE [==[    if (page_login) index->add_page(page_login); // none in the browser build]==]
    FIND [==[    p->add_page(p->page_login = new ConfigWizardWebViewPage(this));]==]
    REPLACE [==[#ifndef __EMSCRIPTEN__
    p->add_page(p->page_login = new ConfigWizardWebViewPage(this));
#endif // the browser build has no Prusa Account sign-in page]==])

# Same downloads folder for the app updater.
orca_gui_patch(libslic3r_gui slic3r/Utils/AppUpdater.cpp
    FIND [==[	std::string get_downloads_path()
	{
		wxString command = "xdg-user-dir DOWNLOAD";
		wxArrayString output;
		GUI::desktop_execute_get_result(command, output);
		if (output.GetCount() > 0) {
			return output[0].ToUTF8().data(); //lm:I would use wxString::ToUTF8(), although on Linux, nothing at all should work too.
		}
		return std::string();
	}
]==]
    REPLACE [==[#ifdef __EMSCRIPTEN__
	std::string get_downloads_path()
	{
		return "/home/web_user/Downloads";
	}
#else
	std::string get_downloads_path()
	{
		wxString command = "xdg-user-dir DOWNLOAD";
		wxArrayString output;
		GUI::desktop_execute_get_result(command, output);
		if (output.GetCount() > 0) {
			return output[0].ToUTF8().data(); //lm:I would use wxString::ToUTF8(), although on Linux, nothing at all should work too.
		}
		return std::string();
	}
#endif // __EMSCRIPTEN__
]==])

# Upstream ES-only bug: the OpenGL ES branch declares `viewport` twice in one scope (the dashed lines, then the label).
# The first one is renamed.
orca_gui_patch(libslic3r_gui slic3r/GUI/Gizmos/GLGizmoMeasure.cpp
    FIND [==[            const std::array<int, 4>& viewport = camera.get_viewport();
            shader->set_uniform("viewport_size", Vec2d(double(viewport[2]), double(viewport[3])));]==]
    REPLACE [==[            const std::array<int, 4>& viewport_dl = camera.get_viewport();
            shader->set_uniform("viewport_size", Vec2d(double(viewport_dl[2]), double(viewport_dl[3])));]==])

# wxMenu::SetupBitmaps is MSW/OSX (GTK takes a window); the wasm port draws menu bitmaps itself, like GTK.
orca_gui_patch(libslic3r_gui slic3r/GUI/GUI_Factories.cpp
    FIND [==[#ifndef __linux__
        menu->SetupBitmaps();]==]
    REPLACE [==[#if !defined(__linux__) && !defined(__EMSCRIPTEN__)
        menu->SetupBitmaps();]==])

# Single instance: send_message / multicast_message_inner exist on Windows, macOS and Linux (D-Bus) only.
orca_gui_patch(libslic3r_gui slic3r/GUI/InstanceCheck.cpp
    FIND [==[		return false;
	}

#endif //__APPLE__/__linux__]==]
    REPLACE [==[		return false;
	}

#elif defined(__EMSCRIPTEN__)

	// A browser tab is one instance: nobody to hand the command line to, nobody to tell (as in the Bambu spike).
	static void multicast_message_inner(const std::string &) {}
	static bool send_message(const std::string &, const std::string &) { return false; }

#endif //__APPLE__/__linux__/__EMSCRIPTEN__]==])

# Wi-Fi list (printer setup on a USB stick): Linux asks NetworkManager over D-Bus; the tab has none.
orca_gui_patch(libslic3r_gui slic3r/Utils/WifiScanner.cpp
    FIND [==[#else 

DBusMessage* dbus_query]==]
    REPLACE [==[#elif defined(__EMSCRIPTEN__)

// a browser tab sees no Wi-Fi networks (the Linux branch asks NetworkManager over D-Bus)
void fill_wifi_map(Slic3r::WifiSsidPskMap&) {}

#else 

DBusMessage* dbus_query]==])

# Window geometry callbacks (the wizard's size, dialogs that size themselves from the display): only Windows, Linux
# and macOS branches exist, so in the tab the callback never ran and the wizard stayed at its minimum size in the
# corner. The tab follows the Linux branch (after wxEVT_SHOW + CallAfter), as every other Linux path here.
orca_gui_patch(libslic3r_gui slic3r/GUI/GUI_Utils.cpp
    FIND [==[    callback();
#elif defined __linux__
    tlw->Bind(wxEVT_SHOW]==]
    REPLACE [==[    callback();
#elif defined __linux__ || defined __EMSCRIPTEN__
    tlw->Bind(wxEVT_SHOW]==])


# Web sites and sign-in: a web site opens in a new browser tab, never inside our page
# (the web view itself does that for any page: wxwidgets-web webview_wasm.cpp). The Printables tab opens printables.com in a
# new tab and the tab bar stays where it was; a Printables link (open_link_in_printables) opens that page in a new tab.
# No Prusa Account sign-in (no password for another service passes through our site): the top bar shows no Log in
# button (desktop's own "hide Log in button" look), the setup wizard has no sign-in page, and a sign-in request does
# nothing; Connect (a signed-in tab) never appears.
orca_gui_patch(libslic3r_gui slic3r/GUI/MainFrame.cpp
    FIND [==[#include "MainFrame.hpp"]==]
    REPLACE [==[#include "MainFrame.hpp"
#ifdef __EMSCRIPTEN__
#include "slic3r/Utils/ServiceConfig.hpp"
#endif]==]
    FIND [==[    const bool show_login = !wxGetApp().app_config->has("show_login_button") || wxGetApp().app_config->get_bool("show_login_button");]==]
    REPLACE [==[#ifdef __EMSCRIPTEN__
    const bool show_login = false; // no Prusa Account sign-in in the browser build
#else
    const bool show_login = !wxGetApp().app_config->has("show_login_button") || wxGetApp().app_config->get_bool("show_login_button");
#endif]==]
    FIND [==[        wxWindow* panel = m_tabpanel->GetCurrentPage();
        Tab* tab = dynamic_cast<Tab*>(panel);]==]
    REPLACE [==[        wxWindow* panel = m_tabpanel->GetCurrentPage();
#ifdef __EMSCRIPTEN__
        if (panel && panel == m_printables_webview) {
            wxLaunchDefaultBrowser(Utils::ServiceConfig::instance().printables_url());
            const int back = e.GetOldSelection() != wxNOT_FOUND ? e.GetOldSelection() : 0;
            CallAfter([this, back]() { m_tabpanel->SetSelection(back); });
            return;
        }
#endif // __EMSCRIPTEN__
        Tab* tab = dynamic_cast<Tab*>(panel);]==]
    FIND [==[    m_printables_webview->set_create_browser();
    m_printables_webview_added = true;]==]
    REPLACE [==[#ifndef __EMSCRIPTEN__
    m_printables_webview->set_create_browser(); // the browser build's tab opens printables.com in a new tab instead
#endif
    m_printables_webview_added = true;]==]
    FIND [==[    // we have to set next url first, than show the tab]==]
    REPLACE [==[#ifdef __EMSCRIPTEN__
    wxLaunchDefaultBrowser(url);
    return;
#endif
    // we have to set next url first, than show the tab]==])
orca_gui_patch(libslic3r_gui slic3r/GUI/UserAccount.cpp
    FIND [==[void UserAccount::do_login()
{]==]
    REPLACE [==[void UserAccount::do_login()
{
#ifdef __EMSCRIPTEN__
    BOOST_LOG_TRIVIAL(info) << "no Prusa Account sign-in in the browser build";
    return;
#endif]==])

# "Send system info" (the rule of these builds: nothing reaches the maker's servers): desktop asks on a later
# start whether to send the computer's details to Prusa. The browser build never asks and never sends.
orca_gui_patch(libslic3r_gui slic3r/GUI/SendSystemInfoDialog.cpp
    FIND [==[    if (wxGetApp().is_gcode_viewer() || ! should_dialog_be_shown())
        return;]==]
    REPLACE [==[#ifdef __EMSCRIPTEN__
    return; // the browser build never sends system info to Prusa
#endif
    if (wxGetApp().is_gcode_viewer() || ! should_dialog_be_shown())
        return;]==])

# Application update check: desktop asks Prusa's server for the newest PrusaSlicer at start and
# from Configuration > Check for Application Updates, then shows "New version ... is available" with a download link.
# A browser build cannot update itself: it is always the version our site serves. No check, no menu item, no wizard
# checkbox (ConfigWizard.cpp above).
orca_gui_patch(libslic3r_gui slic3r/GUI/GUI_App.cpp
    FIND [==[        local_menu->Append(config_id_base + ConfigMenuUpdateApp, _L("Check for Application Updates"), _L("Check for new version of application"));]==]
    REPLACE [==[#ifndef __EMSCRIPTEN__
        local_menu->Append(config_id_base + ConfigMenuUpdateApp, _L("Check for Application Updates"), _L("Check for new version of application"));
#endif]==]
    FIND [==[void GUI_App::app_version_check(bool from_user)
{]==]
    REPLACE [==[void GUI_App::app_version_check(bool from_user)
{
#ifdef __EMSCRIPTEN__
    return; // the browser build is always the version our site serves
#endif]==])

# Thumbnails (Save Project, G-code previews) render into a framebuffer object, as on the desktop (
# 10-24). WebGL2 = OpenGL ES 3.0 has framebuffer objects in core, but Emscripten's GLEW lists only WebGL extension names,
# so GLEW_ARB_framebuffer_object was false, the type Unknown, and thumbnails took the legacy path: drawn into the
# default framebuffer, which a browser shows at the end of the task (there is no SwapBuffers to wait for). The 3D view
# went grey with the thumbnail in its corner until the next redraw. The FBO path's depth buffer gets the sized format ES
# requires, as upstream's own ES branch does for the rectangle selection (GLCanvas3D.cpp, GL_DEPTH_COMPONENT16).
orca_gui_patch(libslic3r_gui slic3r/GUI/OpenGLManager.cpp
    FIND [==[        else
            s_framebuffers_type = EFramebufferType::Unknown;]==]
    REPLACE [==[        else
            s_framebuffers_type = EFramebufferType::Unknown;
#ifdef __EMSCRIPTEN__
        s_framebuffers_type = EFramebufferType::Arb; // core in OpenGL ES 3.0 (WebGL2)
#endif]==])
orca_gui_patch(libslic3r_gui slic3r/GUI/GLCanvas3D.cpp
    FIND [==[        glsafe(::glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT, w, h));]==]
    REPLACE [==[#if SLIC3R_OPENGL_ES
        glsafe(::glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT16, w, h));
#else
        glsafe(::glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT, w, h));
#endif // SLIC3R_OPENGL_ES]==])

# The Physical Printer tab's login. Once the printer is saved, its password lives in the
# password store and the printer's settings hold the word "stored" (PhysicalPrinterDialog::OnOK, save_secret). Sending
# a file reads it back first (Plater.cpp send_gcode: "stored" -> load_secret), but the tab passed the settings as they
# are, so the printer page was asked to log in with the password "stored" and answered 401. The tab now reads it back
# the same way (Plater.cpp load_secret's store and service name).
orca_gui_patch(libslic3r_gui slic3r/GUI/MainFrame.cpp
    FIND [==[            set_printer_webview_credentials(dpc->opt_string("printhost_user"), dpc->opt_string("printhost_password"));]==]
    REPLACE [==[            std::string usr = dpc->opt_string("printhost_user"), psk = dpc->opt_string("printhost_password");
#if wxUSE_SECRETSTORE
            if (psk == "stored") {
                // as Plater.cpp load_secret: the password store, service <app>/PhysicalPrinter/<name>/printhost_password
                const std::string id = wxGetApp().preset_bundle->physical_printers.get_selected_printer().name;
                wxSecretStore store = wxSecretStore::GetDefault();
                wxString username;
                wxSecretValue password;
                psk.clear();
                if (store.IsOk() && store.Load(GUI::format_wxstr(L"%1%/PhysicalPrinter/%2%/%3%", SLIC3R_APP_NAME, id, "printhost_password"), username, password)) {
                    if (!username.empty())
                        usr = into_u8(username);
                    psk = into_u8(password.GetAsString());
                }
            }
#endif // wxUSE_SECRETSTORE
            set_printer_webview_credentials(usr, psk);]==])

# STEP import: get_load_step_fn() takes the macOS branch (the wrapper's load_step_internal linked in) instead of
# dlopen("OCCTWrapper.so") next to the program; a browser tab has no shared libraries to load at run time.
if (SLIC3R_ENABLE_FORMAT_STEP)
    orca_gui_patch(libslic3r libslic3r/Format/STEP.cpp
        FIND [==[#if __APPLE__
extern "C" bool load_step_internal]==] REPLACE [==[#if __APPLE__ || __EMSCRIPTEN__
extern "C" bool load_step_internal]==]
        FIND [==[#ifndef __APPLE__
    constexpr const char* fn_name]==] REPLACE [==[#if !__APPLE__ && !__EMSCRIPTEN__
    constexpr const char* fn_name]==]
        FIND [==[#elif __APPLE__
        load_step_fn = &load_step_internal;]==] REPLACE [==[#elif __APPLE__ || __EMSCRIPTEN__
        load_step_fn = &load_step_internal;]==])
endif ()
