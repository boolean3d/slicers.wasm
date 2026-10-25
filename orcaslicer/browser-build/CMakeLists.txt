# OrcaSlicer v2.3.2's own GUI (src/slic3r, unchanged) compiled to WebAssembly over the wasm wx port.
# libslic3r comes from the Muon3D engine's out-of-tree build (unchanged); this file adds the GUI on top.
# Configure (in b3d-emsdk:6.0.10):
#   emcmake cmake -S /w/browser-port/browser-build -B /w/bgui -G Ninja -C /w/ow/prefix-mt/share/orcawasm/initial-cache.cmake
cmake_minimum_required(VERSION 3.24)
project(orca_gui_wasm C CXX)

set(ORCA_SRC "/w/orca" CACHE PATH "OrcaSlicer v2.3.2 source")
set(ENGINE_SRC "/w/eng-orca/engine" CACHE PATH "Muon3D engine (engine/ folder)")
set(WX_PREFIX "/w/prefix6" CACHE PATH "wasm wx prefix")
set(WX_SRC "/w/owx" CACHE PATH "wasm wx source (its build/wasm page template and wx.js)")
set(ENGINE_VARIANT mt CACHE STRING "" FORCE)
set(ENGINE_LIBSLIC3R_ONLY ON)
set(GUI_SHIMS "${CMAKE_CURRENT_SOURCE_DIR}/shims")

list(PREPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

# --- libslic3r, exactly as the engine builds it --------------------------------------------------
# Orca v2.3.2's deps_src (admesh, clipper, ...) link a target named `eigen`, which its top-level
# CMakeLists makes; the engine reads Orca's own lists but not that file. Same target, the prefix's Eigen.
find_package(Eigen3 5.0.1 CONFIG REQUIRED)
add_library(eigen INTERFACE)
target_link_libraries(eigen INTERFACE Eigen3::Eigen)
# GCode.hpp's LayerResult::make_nop_layer_result puts coord_t max into a size_t layer id: an error on
# wasm32 (32-bit size_t) unless allowed, as Orca's 64-bit builds never see it. The id is a marker only.
add_compile_options(-Wno-c++11-narrowing)
add_subdirectory("${ENGINE_SRC}" engine EXCLUDE_FROM_ALL)
# The engine stubs Format/AssimpImport.cpp, which newer Orca has; v2.3.2 has no Assimp import at all.
set_source_files_properties("${ENGINE_SRC}/stubs/Format/AssimpImport.cpp" TARGET_DIRECTORY libslic3r
    PROPERTIES HEADER_FILE_ONLY ON)
# v2.3.2's libigl wants CGAL/gmpxx.h in MeshBoolean.cpp: see the header.
target_include_directories(libslic3r_cgal SYSTEM BEFORE PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/stand-in-headers-cgal")
# v2.3.2's libigl slice.cpp (pulled into MeshBoolean.cpp) uses Eigen::DynamicSparseMatrix, which Eigen 5 dropped.
target_compile_options(libslic3r_cgal PRIVATE -include "${CMAKE_CURRENT_SOURCE_DIR}/stand-in-headers-cgal/eigen-dynamic-sparse.h")
# The engine leaves out the SLA print (FFF never reaches it); Orca's GUI does (Plater, the 3D view, the
# background slicer), so the GUI build compiles those sources back into libslic3r.
target_sources(libslic3r PRIVATE "${ORCA_SRC}/src/libslic3r/SLAPrint.cpp" "${ORCA_SRC}/src/libslic3r/SLAPrintSteps.cpp"
    "${ORCA_SRC}/src/libslic3r/Format/SL1.cpp" "${ORCA_SRC}/src/libslic3r/ObjColorUtils.cpp"
    # what the GUI calls that the engine has no backend for (OpenVDB, OCCT): see the file
    "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/orca_gui_unsupported.cpp")
# Draco (.drc: Orca's own sample models, Benchy, the Voron cube) is built for wasm (build-gui-libraries.sh, 1.5.7 as
# Orca's deps/Draco): Orca's real Format/DRC.cpp replaces the engine's stub that throws "unsupported".
get_target_property(_slic3r_src libslic3r SOURCES)
list(FILTER _slic3r_src EXCLUDE REGEX "stubs/Format/DRC\\.cpp$")
set_property(TARGET libslic3r PROPERTY SOURCES ${_slic3r_src} "${ORCA_SRC}/src/libslic3r/Format/DRC.cpp")
find_package(draco REQUIRED CONFIG)
target_link_libraries(libslic3r PRIVATE draco::draco)
# ObjColorUtils (the OBJ colour dialog's k-means) is OpenCV's.
find_package(OpenCV 4.6 REQUIRED COMPONENTS core imgproc imgcodecs)
target_include_directories(libslic3r SYSTEM PRIVATE ${OpenCV_INCLUDE_DIRS})
target_link_libraries(libslic3r PRIVATE ${OpenCV_LIBS})
include(PatchedCopies)

# --- STEP import: Orca's own Format/STEP.cpp over a wasm OCCT 7.6.0 (before, a STEP file would not
# load: "STEP import is not supported in the browser engine"). The engine builds STEP as a stub over header shims
# (engine/stubs/Format/STEP.cpp, engine/shims/occt); here the stub and the shims go and the real reader links OCCT, the
# version Orca pins (deps/OCCT), built by shared/occt/build-occt.sh (shared with Bambu Studio).
set(OCCT_PREFIX "/occt" CACHE PATH "wasm OCCT 7.6.0 prefix (shared/occt/build-occt.sh, mounted at /occt)")
find_package(OpenCASCADE CONFIG REQUIRED PATHS "${OCCT_PREFIX}/lib/cmake/opencascade" NO_DEFAULT_PATH NO_CMAKE_FIND_ROOT_PATH)   # emcmake roots finds in its sysroot
get_target_property(_srcs libslic3r SOURCES)
list(FILTER _srcs EXCLUDE REGEX "/stubs/Format/STEP\\.cpp$")
list(APPEND _srcs "${ORCA_SRC}/src/libslic3r/Format/STEP.cpp")
set_property(TARGET libslic3r PROPERTY SOURCES ${_srcs})
foreach (_p INTERFACE_INCLUDE_DIRECTORIES INTERFACE_SYSTEM_INCLUDE_DIRECTORIES)
    get_target_property(_inc engine_shims ${_p})
    if (_inc)
        list(FILTER _inc EXCLUDE REGEX "/shims/occt$")
        set_property(TARGET engine_shims PROPERTY ${_p} ${_inc})
    endif ()
endforeach ()
target_include_directories(engine_shims SYSTEM INTERFACE "${OpenCASCADE_INCLUDE_DIR}")
# every toolkit the install holds (static: the imported targets carry no dependency list; lld needs no order)
file(GLOB _occt_libs "${OCCT_PREFIX}/lib/libTK*.a")
target_link_libraries(libslic3r PRIVATE ${_occt_libs})
target_compile_definitions(libslic3r PRIVATE B3D_HAS_OCCT)   # stand-ins/orca_gui_unsupported.cpp drops its Step stand-ins

# --- the same global settings the engine uses, for the GUI tree -----------------------------------
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-fsigned-char -Wno-deprecated-declarations -Wno-reorder -Wno-sign-compare -Wno-switch
    -Wno-unused-variable -Wno-unused-function -Wno-unused-but-set-variable -Wno-missing-braces -Wno-format
    -Wno-c++11-narrowing -Wno-overloaded-virtual -Wno-ignored-attributes)
add_compile_definitions(
    # WebGL2 is OpenGL ES 3.0: Orca's own ES path (from PrusaSlicer), as libvgcode turns on for EMSCRIPTEN
    SLIC3R_OPENGL_ES=1
    "BBL_RELEASE_TO_PUBLIC=1" NDEBUG WXINSPECTOR_DISABLE SLIC3R_GUI
    wxUSE_UNICODE _UNICODE UNICODE WXINTL_NO_GETTEXT_MACRO wxNO_UNSAFE_WXSTRING_CONV
    CGAL_ALWAYS_ROUND_TO_NEAREST GIT_COMMIT_HASH="v2.3.2")
include_directories(BEFORE SYSTEM "${GUI_SHIMS}")
include_directories(SYSTEM "${ORCA_SRC}/src" "${ORCA_SRC}/src/libigl" "${ORCA_SRC}/deps_src" "${ORCA_SRC}/src/eigen")
list(APPEND CMAKE_MODULE_PATH "${ORCA_SRC}/cmake/modules")

# --- wx ------------------------------------------------------------------------------------------
execute_process(COMMAND "${WX_PREFIX}/bin/wx-config" --cxxflags OUTPUT_VARIABLE WX_CXXFLAGS OUTPUT_STRIP_TRAILING_WHITESPACE)
separate_arguments(WX_CXXFLAGS UNIX_COMMAND "${WX_CXXFLAGS}")
set(wxWidgets_LIBRARIES)
foreach (c gl html aui adv propgrid core)
    list(APPEND wxWidgets_LIBRARIES "${WX_PREFIX}/lib/libwx_wasmunivu_${c}-3.1-emscripten.a")
endforeach ()
# web view, media control and web requests: added to the prefix by build-wxweb.sh
list(PREPEND wxWidgets_LIBRARIES "${WX_PREFIX}/lib/libwx_wasmunivu_webview-3.1-emscripten.a"
    "${WX_PREFIX}/lib/libwx_wasmunivu_media-3.1-emscripten.a" "${WX_PREFIX}/lib/libwx_baseu_webrequest-3.1-emscripten.a")
list(APPEND wxWidgets_LIBRARIES "${WX_PREFIX}/lib/libwx_baseu_net-3.1-emscripten.a" "${WX_PREFIX}/lib/libwx_baseu_xml-3.1-emscripten.a"
    "${WX_PREFIX}/lib/libwx_baseu-3.1-emscripten.a" "${WX_PREFIX}/lib/libwxregexu-3.1-emscripten.a"
    "${WX_PREFIX}/lib/libwxpng-3.1-emscripten.a"
    # wx is built --with-libjpeg=sys (build-wxwidgets.sh): its JPEG reader uses the app's libjpeg-turbo, linked after it
    "/w/ow/prefix-mt/lib/libjpeg.a")
add_compile_options(${WX_CXXFLAGS})

# --- GUI-side libraries ----------------------------------------------------------------------------
function(encoding_check target)
endfunction()
# Orca's PrecompiledHeader.cmake: Orca compiles libslic3r_gui with pchheader.hpp force-included
# (FORCEINCLUDE), and its sources rely on what it brings in (wx/tooltip.h, ...). Same here, as a real PCH.
macro(add_precompiled_header target header)
    target_precompile_headers(${target} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/${header}")
endmacro()
foreach (dir imgui imguizmo minilzo md4c nanosvg nlohmann fast_float ankerl earcut stb_dxt qoi)
    if (NOT TARGET ${dir} AND NOT (dir STREQUAL "nlohmann" AND TARGET nlohmann_json) AND EXISTS "${ORCA_SRC}/deps_src/${dir}/CMakeLists.txt")
        add_subdirectory("${ORCA_SRC}/deps_src/${dir}" "deps_gui/${dir}" EXCLUDE_FROM_ALL)
    endif ()
endforeach ()
add_subdirectory("${ORCA_SRC}/src/libvgcode" libvgcode EXCLUDE_FROM_ALL)
# imgui_draw.cpp logs through boost::log in Orca's copy.
target_link_libraries(imgui PRIVATE boost_headeronly)
# libvgcode's OpenGL ES path (the one a browser has: WebGL2) was left behind when Orca moved the
# desktop path to 4-component buffers: extract_pos_and_or_hwa fills Vec4 lists, the ES textures take
# Vec3 ones. Hand the ES textures the first three components, as their RGB32F format expects.
orca_gui_patch(libvgcode libvgcode/src/ViewerImpl.cpp
    FIND "static void extract_pos_and_or_hwa("
    REPLACE "#ifdef ENABLE_OPENGL_ES
static std::vector<Vec3> xyz_of(const std::vector<Vec4>& v4) {
    std::vector<Vec3> v3;
    v3.reserve(v4.size());
    for (const Vec4& v : v4)
        v3.push_back({ v[0], v[1], v[2] });
    return v3;
}
#endif // ENABLE_OPENGL_ES

static void extract_pos_and_or_hwa("
    FIND "        m_texture_data.set_positions(positions);
        // create and fill height, width and angle textures
        m_texture_data.set_heights_widths_angles(heights_widths_angles);"
    REPLACE "        m_texture_data.set_positions(xyz_of(positions));
        // create and fill height, width and angle textures
        m_texture_data.set_heights_widths_angles(xyz_of(heights_widths_angles));"
    FIND "    std::vector<Vec3> heights_widths_angles;
    heights_widths_angles.reserve(m_vertices.size());
    extract_pos_and_or_hwa(m_vertices, m_travels_radius, m_wipes_radius, m_valid_lines_bitset, nullptr, &heights_widths_angles);
    m_texture_data.set_heights_widths_angles(heights_widths_angles);"
    REPLACE "    std::vector<Vec4> heights_widths_angles;
    heights_widths_angles.reserve(m_vertices.size());
    extract_pos_and_or_hwa(m_vertices, m_travels_radius, m_wipes_radius, m_valid_lines_bitset, nullptr, &heights_widths_angles);
    m_texture_data.set_heights_widths_angles(xyz_of(heights_widths_angles));")

# Imported targets the engine found are local to its directory: find them again for the GUI.
list(APPEND CMAKE_MODULE_PATH "${ORCA_SRC}/cmake/modules")
find_package(cereal REQUIRED)
if (NOT TARGET cereal::cereal)
    add_library(cereal::cereal ALIAS cereal)
endif ()
find_package(libnoise REQUIRED)
find_package(PNG REQUIRED)
find_package(JPEG REQUIRED)
find_package(ZLIB REQUIRED)
find_package(TBB 2021 CONFIG REQUIRED COMPONENTS tbb)
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)
# SkipPartCanvas uses OpenCV too (found above, with ObjColorUtils)
add_library(libcurl INTERFACE)
target_link_libraries(libcurl INTERFACE CURL::libcurl)
add_library(GLEW::GLEW INTERFACE IMPORTED)
add_library(OpenGL::GL INTERFACE IMPORTED)
add_library(glfw INTERFACE)
target_link_options(glfw INTERFACE -sUSE_GLFW=3)
# No USB HID in a browser tab: hid_* answer "no device" (Mouse3DController finds no 3D mouse)
add_library(hidapi STATIC "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/hidapi_none.c")
target_include_directories(hidapi PUBLIC "${ORCA_SRC}/deps_src/hidapi/include")

# --- Orca's GUI library, from its own CMakeLists -------------------------------------------------
set(SLIC3R_STATIC ON)
set(SLIC3R_PCH ON)    # pchheader.hpp, see add_precompiled_header above
set(_unix_saved ${UNIX})
set(UNIX OFF)    # its UNIX branches are GTK, X11, GStreamer, libsecret: none exist here
add_subdirectory("${ORCA_SRC}/src/slic3r" slic3r EXCLUDE_FROM_ALL)
set(UNIX ${_unix_saved})
target_include_directories(libslic3r_gui PRIVATE "${ORCA_SRC}/src/slic3r" "${ORCA_SRC}/deps_src/imgui")
target_include_directories(libslic3r_gui SYSTEM PRIVATE ${OpenCV_INCLUDE_DIRS})
target_link_libraries(libslic3r_gui ${OpenCV_LIBS})
# A browser tab is one instance: there is no other one to hand the command line to. send_message
# exists on Windows, macOS and Linux only; the wasm one says nobody received it.
orca_gui_patch(libslic3r_gui slic3r/GUI/InstanceCheck.cpp
    FIND "#endif //__APPLE__/__linux__"
    REPLACE "#elif defined(__EMSCRIPTEN__)

	static bool send_message(const std::string &, const std::string &)
	{
		return false;
	}

#endif //__APPLE__/__linux__/__EMSCRIPTEN__")
# A filament box made while the project's colours are not in yet stayed blank for good:
# PlaterPresetComboBox::update() Freezes the box, then returns with no Thaw when there is no colour icon for its row,
# so its freeze count never comes back to 0 and every paint skips it. Same code in Orca main and Bambu Studio master.
orca_gui_patch(libslic3r_gui slic3r/GUI/PresetComboBoxes.cpp
    FIND "            clr_picker->SetBitmap(*bitmaps[m_filament_idx]);
        } else {
            return;
        }"
    REPLACE "            clr_picker->SetBitmap(*bitmaps[m_filament_idx]);
        } else {
            BOOST_LOG_TRIVIAL(warning) << \"b3d combo: no colour icon for filament \" << m_filament_idx << \" of \" << bitmaps.size() << \", thawed\";
            Thaw();
            return;
        }")
# Web pages run their script through wx's own call on the wasm web view (WebKitGTK's otherwise).
orca_gui_patch(libslic3r_gui slic3r/GUI/Widgets/WebView.cpp
    FIND "#else
        WebKitWebView *wkWebView = (WebKitWebView *) webView->GetNativeBackend();"
    REPLACE "#elif defined(__EMSCRIPTEN__)
        return webView->RunScript(javascript);
#else
        WebKitWebView *wkWebView = (WebKitWebView *) webView->GetNativeBackend();")

# Orca's test for the transfer-progress callback (curl 7.32+) reads "MAJOR >= 7 && MINOR >= 32", false for
# curl 8.10, so it hands its curl_off_t callback to the old double-argument CURLOPT_PROGRESSFUNCTION. Native
# builds get garbage numbers; wasm traps on the signature (closing the Setup Wizard starts the preset update
# download). PrusaSlicer 2.9 Http.cpp tests the same way; curl's own LIBCURL_VERSION_NUM is the right test.
# Network identity: the tab never tells a server it is Bambu Studio and never asks for
# Bambu's closed network plugin: no X-BBL-* client headers (name, version, device id, OS, language) on any request
# (desktop puts them on all), no plugin address, no start-up plugin update (our LAN agent answers with a version).
orca_gui_patch(libslic3r_gui slic3r/GUI/GUI_App.cpp
    FIND "    std::map<std::string, std::string> extra_headers;
    extra_headers.insert(std::make_pair(\"X-BBL-Client-Type\", \"slicer\"));"
    REPLACE "    std::map<std::string, std::string> extra_headers;
#ifdef __EMSCRIPTEN__
    return extra_headers; // the browser build sends no Bambu client identity (no X-BBL-* headers, no device id)
#endif // __EMSCRIPTEN__
    extra_headers.insert(std::make_pair(\"X-BBL-Client-Type\", \"slicer\"));"
    FIND "std::string GUI_App::get_plugin_url(std::string name, std::string country_code)
{"
    REPLACE "std::string GUI_App::get_plugin_url(std::string name, std::string country_code)
{
#ifdef __EMSCRIPTEN__
    return std::string(); // Bambu's closed plugin (and camera tools) is never asked for from the browser build
#endif // __EMSCRIPTEN__"
    FIND "    BOOST_LOG_TRIVIAL(info) << \"[download_plugin]: enter\";"
    REPLACE "    BOOST_LOG_TRIVIAL(info) << \"[download_plugin]: enter\";
#ifdef __EMSCRIPTEN__
    return -1; // Bambu's closed plugin is never downloaded in the browser build
#endif // __EMSCRIPTEN__"
    FIND "void GUI_App::check_new_version_sf(bool show_tips, int by_user)
{"
    REPLACE "void GUI_App::check_new_version_sf(bool show_tips, int by_user)
{
#ifdef __EMSCRIPTEN__
    // The browser build asks no app-version server: the tab always runs the version Boolean3d hosts and a desktop
    // installer means nothing there. Help > Check for update says it is current.
    if (by_user) no_new_version();
    return;
#endif // __EMSCRIPTEN__"
    FIND "    auto should_load_networking_plugin = app_config->get_bool(\"installed_networking\");"
    REPLACE "#ifdef __EMSCRIPTEN__
    // the browser build's network module is built in (printer-link/lan_printer_agent.cpp): installed, at this Orca's version
    app_config->set_bool(\"installed_networking\", true);
    if (app_config->get_network_plugin_version().empty())
        app_config->set(SETTING_NETWORK_PLUGIN_VERSION, get_latest_network_version());
#endif // __EMSCRIPTEN__
    auto should_load_networking_plugin = app_config->get_bool(\"installed_networking\");")
# The printer link: Boolean3d's own LAN agent, the same one browser Bambu Studio uses
# (agent/ = Bambu Studio's browser-build/printer-link): it answers the network library's look-ups for the LAN path only
# (LAN Only + Developer Mode printer, through the Boolean3d helper on the home network); the link sends
# dlopen/dlsym/dlclose there (link options below). Bambu's closed plugin is never fetched, used or imitated; no cloud,
# no sign-in (WebUserLoginDialog below). Orca loads a network library only once "installed": the browser build's is
# built in, so it counts as installed at the version this Orca is made for, as desktop Orca records after a plugin install.
target_sources(libslic3r_gui PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan_printer_agent.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan_printer_camera.cpp")
set_source_files_properties("${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan_printer_agent.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan_printer_camera.cpp"
    TARGET_DIRECTORY libslic3r_gui PROPERTIES COMPILE_DEFINITIONS B3D_LAN_AGENT_ORCA SKIP_PRECOMPILE_HEADERS ON)
# The printer camera: desktop Orca plays it through GStreamer (Linux, gstbambusrc.c) or BambuPlayer
# (macOS); a tab has neither. The tab takes the macOS shape of wxMediaCtrl2 (a plain window; the header's __WXMAC__
# branch, forced in ahead of every source so the unpatched header's guard skips it) and camera/wxMediaCtrl2_wasm.cpp
# reads the camera library's samples as gstbambusrc.c does (in the tab: printer-link/lan_printer_camera.cpp, the helper's MJPG
# relay) and draws each JPEG. MediaPlayCtrl's sizing takes the macOS branch too.
orca_gui_patch(libslic3r_gui slic3r/GUI/wxMediaCtrl2.h
    FIND "#ifdef __WXMAC__"
    REPLACE "#if defined(__WXMAC__) || defined(__EMSCRIPTEN__)"
    # newer clang refuses an out-of-range enum value in a constexpr; MediaPlayCtrl.h's own form of the same constant
    FIND "static constexpr wxMediaState MEDIASTATE_BUFFERING = (wxMediaState) 6;"
    REPLACE "static inline const wxMediaState MEDIASTATE_BUFFERING = static_cast<wxMediaState>(6);")
target_compile_options(libslic3r_gui PRIVATE -include "${CMAKE_BINARY_DIR}/gui-patched/slic3r/GUI/wxMediaCtrl2.h")
orca_gui_patch(libslic3r_gui slic3r/GUI/MediaPlayCtrl.cpp
    FIND "#ifdef __WXMAC__
    wxWindow::DoSetSize"
    REPLACE "#if defined(__WXMAC__) || defined(__EMSCRIPTEN__)
    wxWindow::DoSetSize")
get_target_property(_gui_src libslic3r_gui SOURCES)
list(FILTER _gui_src EXCLUDE REGEX "GUI/wxMediaCtrl2\\.cpp$")
set_property(TARGET libslic3r_gui PROPERTY SOURCES ${_gui_src} "${CMAKE_CURRENT_SOURCE_DIR}/camera/wxMediaCtrl2_wasm.cpp")
set_source_files_properties("${CMAKE_CURRENT_SOURCE_DIR}/camera/wxMediaCtrl2_wasm.cpp" TARGET_DIRECTORY libslic3r_gui
    PROPERTIES INCLUDE_DIRECTORIES "${ORCA_SRC}/src/slic3r/GUI")
# Sign-in: no Bambu or Orca cloud account sign-in in the browser build (Bambu's needs
# its closed network plug-in, never present; no password for another service passes through our site). Every sign-in
# request shows the desktop's own "plug-in not detected" box (Orca's path with the network plug-in switched on but
# missing), without its download link. Web sites open in a new browser tab (shared/wxwidgets-web webview_wasm.cpp).
orca_gui_patch(libslic3r_gui slic3r/GUI/WebUserLoginDialog.cpp
    FIND "    if (!agent && bblnetwork_enabled) {"
    REPLACE "#ifdef __EMSCRIPTEN__
    if (true) { // no account sign-in in the browser build: the desktop's no-plug-in box
#else
    if (!agent && bblnetwork_enabled) {
#endif // __EMSCRIPTEN__"
    FIND "        auto m_download_hyperlink = new HyperLink(this, _L(\"Click here to download it.\"));"
    REPLACE "#ifndef __EMSCRIPTEN__
        auto m_download_hyperlink = new HyperLink(this, _L(\"Click here to download it.\"));"
    FIND "        m_sizer_main->Add(m_message, 0, wxALIGN_CENTER | wxALL, FromDIP(15));
        m_sizer_main->Add(m_download_hyperlink, 0, wxALIGN_CENTER | wxALL, FromDIP(10));"
    REPLACE "#endif // __EMSCRIPTEN__
        m_sizer_main->Add(m_message, 0, wxALIGN_CENTER | wxALL, FromDIP(15));
#ifndef __EMSCRIPTEN__
        m_sizer_main->Add(m_download_hyperlink, 0, wxALIGN_CENTER | wxALL, FromDIP(10));
#endif // __EMSCRIPTEN__")
# Bambu's printer config download (api.bambulab.com, every start, no setting) (sync_printer_config) is never asked for from the browser
# build: nothing in the browser slicer reaches the maker's servers (the rule of these builds).
# The printers folder stays as the installed profiles make it, as a desktop Orca that is offline.
orca_gui_patch(libslic3r_gui slic3r/Utils/PresetUpdater.cpp
    FIND "void PresetUpdater::priv::sync_plugins(std::string http_url, std::string plugin_version)
{"
    REPLACE "void PresetUpdater::priv::sync_plugins(std::string http_url, std::string plugin_version)
{
#ifdef __EMSCRIPTEN__
    return; // Bambu's closed plugin is never asked for from the browser build
#endif // __EMSCRIPTEN__"
    FIND "void PresetUpdater::priv::sync_printer_config(std::string http_url)
{"
    REPLACE "void PresetUpdater::priv::sync_printer_config(std::string http_url)
{
#ifdef __EMSCRIPTEN__
    return; // no Bambu printer config download from the browser build
#endif // __EMSCRIPTEN__")
orca_gui_patch(libslic3r_gui slic3r/Utils/Http.cpp
    FIND "#if LIBCURL_VERSION_MAJOR >= 7 && LIBCURL_VERSION_MINOR >= 32"
    REPLACE "#if LIBCURL_VERSION_NUM >= 0x072000")

# Orca's ES path is never compiled upstream: in render_dimensioning's angle part the core-profile block's
# braces are compiled out, so its `viewport` meets the label's `viewport` in one scope. Same values, read inline.
orca_gui_patch(libslic3r_gui slic3r/GUI/Gizmos/GLGizmoMeasure.cpp
    FIND "            const std::array<int, 4>& viewport = camera.get_viewport();
            shader->set_uniform(\"viewport_size\", Vec2d(double(viewport[2]), double(viewport[3])));
            shader->set_uniform(\"width\", 1.0f);
            shader->set_uniform(\"gap_size\", 0.0f);
#if !SLIC3R_OPENGL_ES
        }
        else
            glsafe(::glLineWidth(2.0f));
#endif // !SLIC3R_OPENGL_ES

        // arc"
    REPLACE "            shader->set_uniform(\"viewport_size\", Vec2d(double(camera.get_viewport()[2]), double(camera.get_viewport()[3])));
            shader->set_uniform(\"width\", 1.0f);
            shader->set_uniform(\"gap_size\", 0.0f);
#if !SLIC3R_OPENGL_ES
        }
        else
            glsafe(::glLineWidth(2.0f));
#endif // !SLIC3R_OPENGL_ES

        // arc")

# OpenGL ES version: WebGL2 says "OpenGL ES 3.0 (WebGL 2.0 ...)"; Orca reads the first word ("OpenGL") as the
# number, gets 0 and refuses ("lower than 3.2"). PrusaSlicer 2.9.0 OpenGLManager.cpp:151-160 and :373-377 (its
# SLIC3R_OPENGL_ES path, which Orca dropped): the number after "OpenGL ES", and ES 3.0 is enough.
# Framebuffer objects are core in ES 3.0 under the ARB (core) names; Emscripten's GLEW does not report the extension.
# The 3D view at display scaling: the GTK3 scaled-GL path (shared/cmake/RetinaGl.cmake).
include("${CMAKE_CURRENT_SOURCE_DIR}/../shared/cmake/RetinaGl.cmake")
slicer_retina_gl_patch(libslic3r_gui)

orca_gui_patch(libslic3r_gui slic3r/GUI/OpenGLManager.cpp
    FIND "    std::vector<std::string> numbers;
    boost::split(numbers, tokens[0], boost::is_any_of(\".\"), boost::token_compress_on);"
    REPLACE "#if SLIC3R_OPENGL_ES
    const std::string version_container = (tokens.size() > 1 && boost::istarts_with(tokens[1], \"ES\")) ? tokens[2] : tokens[0];
#endif // SLIC3R_OPENGL_ES

    std::vector<std::string> numbers;
#if SLIC3R_OPENGL_ES
    boost::split(numbers, version_container, boost::is_any_of(\".\"), boost::token_compress_on);
#else
    boost::split(numbers, tokens[0], boost::is_any_of(\".\"), boost::token_compress_on);
#endif // SLIC3R_OPENGL_ES"
    FIND "        else {
            s_framebuffers_type = EFramebufferType::Unknown;"
    REPLACE "        else {
#if SLIC3R_OPENGL_ES
            s_framebuffers_type = EFramebufferType::Arb;
#else
            s_framebuffers_type = EFramebufferType::Unknown;
#endif // SLIC3R_OPENGL_ES"
    FIND "        bool valid_version = s_gl_info.is_version_greater_or_equal_to(2, 0);"
    REPLACE "#if SLIC3R_OPENGL_ES
        bool valid_version = s_gl_info.is_version_greater_or_equal_to(3, 0);
#else
        bool valid_version = s_gl_info.is_version_greater_or_equal_to(2, 0);
#endif // SLIC3R_OPENGL_ES")

# --- the program: Orca's own src/OrcaSlicer.cpp (CLI + GUI entry, unchanged) ------------------------
# Resources: Orca's resources/ preloaded at /orca/resources (see start-up.js; with a start list the package fetches
# each file when first read). resources/web is in the program's files too: dialogs check a page exists before
# loading it (WipingDialog: "Flushing volumes" stayed blank without it), as Bambu Studio's list has it.
# Printer error pictures (resources/hms, 79 MB) stay out until Orca reads them one at a time (Bambu's hms block).
# FORCE: an older list kept in a build folder's CMakeCache.txt would win over this one.
set(ORCA_RESOURCES_PRELOAD images shaders fonts info printers data flush calib tooltip handy_models
    profiles_template shapes custom_gcodes dailytip cert web "profiles" CACHE STRING "resources/ folders preloaded" FORCE)
# Orca keeps the SLIC3R_OPENGL_ES code but ships no resources/shaders/ES. Its GLSL 1.40 shaders are already
# in/out style, so ES 3.00 copies are the same text under "#version 300 es" with default precisions.
# wireframe and dashed_lines (ES only) are PrusaSlicer 2.9.0's resources/shaders/ES files (webgl-shaders/).
set(_es "${CMAKE_BINARY_DIR}/shaders-ES")
file(MAKE_DIRECTORY "${_es}")
file(GLOB _gl140 "${ORCA_SRC}/resources/shaders/140/*")
foreach (f IN LISTS _gl140)
    get_filename_component(n "${f}" NAME)
    if (n MATCHES "^dashed_thick_lines")    # a geometry shader: desktop core profile only
        continue ()
    endif ()
    file(READ "${f}" text)
    string(FIND "${text}" "#version 140" at)
    if (NOT at EQUAL 0)
        message(FATAL_ERROR "${f} does not start with #version 140")
    endif ()
    string(REPLACE "#version 140" "#version 300 es\nprecision highp float;\nprecision highp int;" text "${text}")
    file(WRITE "${_es}/${n}" "${text}")
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${f}")
endforeach ()
file(COPY "${CMAKE_CURRENT_SOURCE_DIR}/webgl-shaders/" DESTINATION "${_es}")
# Prusa's wireframe is GLSL ES 1.00 + GL_OES_standard_derivatives (for fwidth). WebGL2 does not offer that
# extension to 1.00 shaders (derivatives are core in ES 3.00), so the pair is lifted to "#version 300 es":
# attribute/varying become in/out and gl_FragColor a declared output. Same code otherwise.
foreach (n wireframe.vs wireframe.fs)
    file(READ "${CMAKE_CURRENT_SOURCE_DIR}/webgl-shaders/${n}" text)
    string(REPLACE "#version 100\n#extension GL_OES_standard_derivatives : enable\n" "#version 300 es\n" text "${text}")
    string(REPLACE "#version 100\n" "#version 300 es\n" text "${text}")
    string(REGEX REPLACE "(^|\n)attribute " "\\1in " text "${text}")
    if (n MATCHES "\\.vs$")
        string(REGEX REPLACE "(^|\n)varying " "\\1out " text "${text}")
    else ()
        string(REGEX REPLACE "(^|\n)varying " "\\1in " text "${text}")
        string(REPLACE "gl_FragColor" "out_color" text "${text}")
        string(REPLACE "void main()" "out vec4 out_color;\n\nvoid main()" text "${text}")
    endif ()
    if (NOT text MATCHES "^#version 300 es")
        message(FATAL_ERROR "${n}: not lifted to 300 es")
    endif ()
    file(WRITE "${_es}/${n}" "${text}")
endforeach ()
set(_preload "SHELL:--preload-file ${_es}@/orca/resources/shaders/ES")
# the system font, Noto Sans (shared/fonts, OFL; js/app-fonts.js, edits/n-system-font.py)
list(APPEND _preload "SHELL:--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/../shared/fonts@/wx-fonts")
# The certificate store the program's own HTTPS checks against (Debian's Mozilla bundle), at OpenSSL's own default
# file (OPENSSLDIR/cert.pem, as a distro's OpenSSL has it); libcurl falls back to it (CA_FALLBACK, as the desktop deps).
list(APPEND _preload "SHELL:--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/ca-certificates.crt@/w/ow/prefix-mt/ssl/cert.pem")
foreach (r IN LISTS ORCA_RESOURCES_PRELOAD)
    if (EXISTS "${ORCA_SRC}/resources/${r}")
        list(APPEND _preload "SHELL:--preload-file ${ORCA_SRC}/resources/${r}@/orca/resources/${r}")   # SHELL: keeps CMake from merging repeated flags
    endif ()
endforeach ()
# the vendor presets bundle (off-thread write-presets-bundle.py): one file the worker serves the preset files from
list(APPEND _preload "SHELL:--preload-file ${ORCA_SRC}/resources/b3d-bundle@/orca/resources/b3d-bundle")
# Translations: Orca's source keeps only the texts (localization/i18n/<lang>/OrcaSlicer_<lang>.po); the desktop build
# compiles each into resources/i18n/<lang>/OrcaSlicer.mo (its gettext_po_to_mo target, CMakeLists.txt). Same msgfmt
# call here, at configure time, preloaded where the program looks (resources/i18n). Without them every language is English.
find_program(MSGFMT msgfmt REQUIRED)
set(_i18n "${CMAKE_BINARY_DIR}/i18n")
file(GLOB _po_files "${ORCA_SRC}/localization/i18n/*/OrcaSlicer*.po")
if (NOT _po_files)
    message(FATAL_ERROR "no ${ORCA_SRC}/localization/i18n/*/OrcaSlicer*.po")
endif ()
foreach (po IN LISTS _po_files)
    get_filename_component(_dir "${po}" DIRECTORY)
    get_filename_component(_lang "${_dir}" NAME)
    file(MAKE_DIRECTORY "${_i18n}/${_lang}")
    execute_process(COMMAND "${MSGFMT}" --check-format -o "${_i18n}/${_lang}/OrcaSlicer.mo" "${po}" RESULT_VARIABLE _rc)
    if (NOT _rc EQUAL 0)
        message(FATAL_ERROR "msgfmt failed on ${po}")
    endif ()
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${po}")
endforeach ()
list(APPEND _preload "SHELL:--preload-file ${_i18n}@/orca/resources/i18n")
# The allocator and thread settings are the engine's program (engine/cmake/Engine.cmake, ENGINE_THREADED):
# tbb::scalable_allocator = malloc (no tbbmalloc in the mt deps), mimalloc. Threads: unlike the engine (TBB alone in its
# worker), Orca runs its own threads beside TBB's hardwareConcurrency-1 workers; a strict pool made TBB's pthread_create fail
# (EAGAIN -> handle_perror throws inside the noexcept private_worker::run -> terminate). Pool hc+16, grows on demand like the desktop.
# The program sees min(cores, 8) cores everywhere (shared/js/tab-cores.js, replaces slice-threads.cpp: its TBB cap
# froze the first Slice on computers with more than 8 cores); the pool keeps spare loaded workers (shared/js/pthread-spares.js).
add_executable(orca_app EXCLUDE_FROM_ALL "${ORCA_SRC}/src/OrcaSlicer.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/gl_compat.c" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_console_log.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_debug.cpp"
    "${ENGINE_SRC}/allocator/scalable_malloc.c" "${ENGINE_SRC}/allocator/mimalloc_options.c")
set_source_files_properties("${ENGINE_SRC}/allocator/mimalloc_options.c" PROPERTIES
    INCLUDE_DIRECTORIES "${EMSCRIPTEN_ROOT_PATH}/system/lib/mimalloc/include")
# The program is named after the slicer: orcaslicer.html/.js/.wasm/.data (the page itself is served as index.html by the package)
set_target_properties(orca_app PROPERTIES OUTPUT_NAME "orcaslicer" SUFFIX ".html")
# unix/fhs.hpp, as Orca's top-level CMakeLists makes it: SLIC3R_FHS off = the tarball layout (resources beside bin/).
configure_file("${ORCA_SRC}/src/dev-utils/platform/unix/fhs.hpp.in" "${CMAKE_BINARY_DIR}/dev-utils/platform/unix/fhs.hpp")
target_include_directories(orca_app PRIVATE "${ORCA_SRC}/src" "${ORCA_SRC}/src/slic3r")
target_include_directories(orca_app SYSTEM PRIVATE "${CMAKE_BINARY_DIR}/dev-utils/platform")
target_link_libraries(orca_app PRIVATE libslic3r_gui libslic3r cereal::cereal)
target_link_options(orca_app PRIVATE
    # main() runs in a worker (PROXY_TO_PTHREAD): the page thread only composites, forwards input and answers the
    # program's proxied page calls (shared/js/page-bridge.js and page-bridge-web.js are js-libraries of those; page-extras.js is
    # the page's own pre-js). The windows' canvases are transferred to that worker (OFFSCREENCANVAS_SUPPORT; $GL so the
    # GL library is linked for the transfer). The pool is one bigger: the main pthread itself takes a worker.
    -sJSPI -sPROXY_TO_PTHREAD -sOFFSCREENCANVAS_SUPPORT "-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=$GL"
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sINITIAL_MEMORY=256MB -sSTACK_SIZE=16MB -sMALLOC=mimalloc
    "-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency,8)+17" -sPTHREAD_POOL_SIZE_STRICT=0 -sDEFAULT_PTHREAD_STACK_SIZE=8MB
    --emit-symbol-map -Wl,--error-limit=0 -Wl,--wrap=__cxa_throw
    -sUSE_WEBGL2=1 -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2 -sFULL_ES3=1
    -sEXPORTED_RUNTIME_METHODS=HEAP8,HEAPU8,HEAP32,HEAPF32,HEAPF64,FS,stringToNewUTF8 -sFORCE_FILESYSTEM=1
    "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge-web.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/presets-bundle-reader.js" "SHELL:--pre-js ${WX_SRC}/build/wasm/wx.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../wxwidgets-drawing/js/graphics-context.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/app-fonts.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/glew-context.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/tab-cores.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/gl-no-context.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/net-worker.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/pthread-spares.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/start-up.js"
    "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan-printer-link.js" -Wl,--wrap=dlopen,--wrap=dlsym,--wrap=dlclose
    "-sEXPORTED_FUNCTIONS=_main,_b3d_lan_incoming,_b3d_lan_camera_frame,_b3d_lan_camera_size,_malloc,_free"
    "SHELL:--shell-file ${WX_SRC}/build/wasm/template.html" ${_preload})
# A changed --pre-js or page template relinks (CMake does not see them otherwise).
set_property(TARGET orca_app APPEND PROPERTY LINK_DEPENDS "${WX_SRC}/build/wasm/wx.js" "${CMAKE_CURRENT_SOURCE_DIR}/../wxwidgets-drawing/js/graphics-context.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/app-fonts.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/net-worker.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/glew-context.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/gl-no-context.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/pthread-spares.js" "${CMAKE_CURRENT_SOURCE_DIR}/start-up.js" "${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan-printer-link.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/tab-cores.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge-web.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/presets-bundle-reader.js" "${WX_SRC}/build/wasm/template.html")
