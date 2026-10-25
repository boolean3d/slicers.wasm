# Bambu Studio v02.08.02.61's own GUI (src/slic3r, unchanged but for the patched copies below) compiled to
# WebAssembly over the wasm wx port. Same recipe as the OrcaSlicer v2.3.2 browser build (orcaslicer/browser-build).
# libslic3r comes from the Muon3D engine's out-of-tree build, the same tree our Bambu engine (js/lib/slicer)
# is built from (engine 0.6.1 + bambu-engine fork/engine-cmake-stubs.patch).
# Configure (in b3d-emsdk:6.0.10, /w = the work dir):
#   emcmake cmake -S /w/browser-port/browser-build -B /w/bgui -G Ninja -C /w/ow/prefix-mt/share/orcawasm/initial-cache.cmake
cmake_minimum_required(VERSION 3.24)
project(bambu_gui_wasm C CXX)

# ORCA_SRC is the engine's name for the source tree it reads; here it is Bambu Studio.
set(ORCA_SRC "/w/bambu" CACHE PATH "Bambu Studio v02.08.02.61 source")
set(ENGINE_SRC "/w/eng/engine" CACHE PATH "Muon3D engine (engine/ folder)")
set(WX_PREFIX "/w/prefix6" CACHE PATH "wasm wx prefix")
set(WX_SRC "/w/owx" CACHE PATH "wasm wx source (its build/wasm page template and wx.js)")
set(ENGINE_VARIANT mt CACHE STRING "" FORCE)
set(ENGINE_LIBSLIC3R_ONLY ON)
set(GUI_SHIMS "${CMAKE_CURRENT_SOURCE_DIR}/shims")

list(PREPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

# --- libslic3r, exactly as the engine builds it --------------------------------------------------
add_compile_options(-Wno-c++11-narrowing)
add_subdirectory("${ENGINE_SRC}" engine EXCLUDE_FROM_ALL)
# The engine leaves out what FFF slicing never reaches; Bambu Studio's GUI does reach it (Plater, the 3D view,
# the background slicer, the OBJ colour dialog), so the GUI build compiles those sources back into libslic3r.
target_sources(libslic3r PRIVATE "${ORCA_SRC}/src/libslic3r/SLAPrint.cpp" "${ORCA_SRC}/src/libslic3r/SLAPrintSteps.cpp"
    "${ORCA_SRC}/src/libslic3r/Format/SL1.cpp" "${ORCA_SRC}/src/libslic3r/ObjColorUtils.cpp"
    # the textured-model import (TextureImportDialog, Plater): OpenCV, which the GUI build has
    "${ORCA_SRC}/src/libslic3r/TexturePainting.cpp" "${ORCA_SRC}/src/libslic3r/TextureToColor/TextureToColor.cpp"
    "${ORCA_SRC}/src/libslic3r/TextureToColor/ColorUtils.cpp"
    # what the GUI calls that the engine has no backend for (OpenVDB, draco, OCCT): see the file
    "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/bambu_gui_unsupported.cpp")
find_package(OpenCV 4.6 REQUIRED COMPONENTS core imgproc imgcodecs)
target_include_directories(libslic3r SYSTEM PRIVATE ${OpenCV_INCLUDE_DIRS})
target_include_directories(libslic3r PRIVATE "${ORCA_SRC}/src/libslic3r/TextureToColor")
target_link_libraries(libslic3r PRIVATE ${OpenCV_LIBS})
include(PatchedCopies)

# --- STEP import: Bambu's own Format/STEP.cpp over a wasm OCCT 7.6.0 (before, a STEP file would not
# load: "STEP import is not supported in the browser engine"). The engine builds STEP as a stub over header shims
# (engine/stubs/Format/STEP.cpp, engine/shims/occt); here the stub and the shims go and the real reader links OCCT, the
# version and patch Bambu pins (deps/OCCT), built by shared/occt/build-occt.sh (shared with OrcaSlicer).
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
target_compile_definitions(libslic3r PRIVATE B3D_HAS_OCCT)   # stand-ins/bambu_gui_unsupported.cpp drops its Step stand-ins

# --- the same global settings the engine uses, for the GUI tree -----------------------------------
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-fsigned-char -Wno-deprecated-declarations -Wno-reorder -Wno-sign-compare -Wno-switch
    -Wno-unused-variable -Wno-unused-function -Wno-unused-but-set-variable -Wno-missing-braces -Wno-format
    -Wno-c++11-narrowing -Wno-overloaded-virtual -Wno-ignored-attributes)
# Bambu Studio's public Linux release (BuildLinux.sh: -DBBL_RELEASE_TO_PUBLIC=1 -DBBL_INTERNAL_TESTING=0)
add_compile_definitions(
    "BBL_RELEASE_TO_PUBLIC=1" "BBL_INTERNAL_TESTING=0" NDEBUG SLIC3R_GUI
    wxUSE_UNICODE _UNICODE UNICODE WXINTL_NO_GETTEXT_MACRO wxNO_UNSAFE_WXSTRING_CONV
    CGAL_ALWAYS_ROUND_TO_NEAREST)
include_directories(BEFORE SYSTEM "${GUI_SHIMS}")
include_directories(SYSTEM "${ORCA_SRC}/src" "${ORCA_SRC}/src/libigl" "${ORCA_SRC}/src/eigen")
list(APPEND CMAKE_MODULE_PATH "${ORCA_SRC}/cmake/modules")

# --- wx ------------------------------------------------------------------------------------------
execute_process(COMMAND "${WX_PREFIX}/bin/wx-config" --cxxflags OUTPUT_VARIABLE WX_CXXFLAGS OUTPUT_STRIP_TRAILING_WHITESPACE)
separate_arguments(WX_CXXFLAGS UNIX_COMMAND "${WX_CXXFLAGS}")
set(wxWidgets_LIBRARIES)
foreach (c gl richtext html aui adv propgrid core)
    list(APPEND wxWidgets_LIBRARIES "${WX_PREFIX}/lib/libwx_wasmunivu_${c}-3.1-emscripten.a")
endforeach ()
list(PREPEND wxWidgets_LIBRARIES "${WX_PREFIX}/lib/libwx_wasmunivu_webview-3.1-emscripten.a"
    "${WX_PREFIX}/lib/libwx_wasmunivu_media-3.1-emscripten.a" "${WX_PREFIX}/lib/libwx_baseu_webrequest-3.1-emscripten.a")
list(APPEND wxWidgets_LIBRARIES "${WX_PREFIX}/lib/libwx_baseu_net-3.1-emscripten.a" "${WX_PREFIX}/lib/libwx_baseu_xml-3.1-emscripten.a"
    "${WX_PREFIX}/lib/libwx_baseu-3.1-emscripten.a" "${WX_PREFIX}/lib/libwxregexu-3.1-emscripten.a"
    "${WX_PREFIX}/lib/libwxpng-3.1-emscripten.a" "${WX_PREFIX}/lib/libwxjpeg-3.1-emscripten.a" "/w/ow/prefix-mt/lib/libexpat.a")
add_compile_options(${WX_CXXFLAGS})

# --- GUI-side libraries (Bambu keeps them in src/, its src/CMakeLists adds them under SLIC3R_GUI) ----
function(encoding_check target)
endfunction()
foreach (dir imgui imguizmo minilzo)
    if (NOT TARGET ${dir})
        add_subdirectory("${ORCA_SRC}/src/${dir}" "deps_gui/${dir}" EXCLUDE_FROM_ALL)
    endif ()
endforeach ()
target_link_libraries(imgui PRIVATE boost_headeronly)

list(APPEND CMAKE_MODULE_PATH "${ORCA_SRC}/cmake/modules")
find_package(cereal REQUIRED)
if (NOT TARGET cereal::cereal)
    add_library(cereal::cereal ALIAS cereal)
endif ()
find_package(PNG REQUIRED)
find_package(JPEG REQUIRED)
find_package(ZLIB REQUIRED)
find_package(TBB 2021 CONFIG REQUIRED COMPONENTS tbb)
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)
add_library(libcurl INTERFACE)
target_link_libraries(libcurl INTERFACE CURL::libcurl)
add_library(GLEW::GLEW INTERFACE IMPORTED)
add_library(OpenGL::GL INTERFACE IMPORTED)
add_library(glfw INTERFACE)
target_link_options(glfw INTERFACE -sUSE_GLFW=3)
# No USB HID in a browser tab: hid_* answer "no device" (Mouse3DController finds no 3D mouse)
add_library(hidapi STATIC "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/hidapi_none.c")
target_include_directories(hidapi PUBLIC "${ORCA_SRC}/src/hidapi/include")
# libharu and FFmpeg (libavcodec, libswscale, libavutil): built into the prefix by build-gui-libraries-bambu.sh
set(ENV{PKG_CONFIG_LIBDIR} "${CMAKE_PREFIX_PATH}/lib/pkgconfig")
find_package(PkgConfig REQUIRED)

# --- Bambu Studio's GUI library, from its own CMakeLists -------------------------------------------
set(SLIC3R_STATIC ON)
set(SLIC3R_PCH ON)
set(_unix_saved ${UNIX})
set(UNIX OFF)    # its UNIX branches are GTK, X11, GStreamer, WebKitGTK, D-Bus: none exist here
add_subdirectory("${ORCA_SRC}/src/slic3r" slic3r EXCLUDE_FROM_ALL)
set(UNIX ${_unix_saved})
target_include_directories(libslic3r_gui PRIVATE "${ORCA_SRC}/src/slic3r" "${ORCA_SRC}/src/imgui")
target_include_directories(libslic3r_gui SYSTEM PRIVATE ${OpenCV_INCLUDE_DIRS})
target_link_libraries(libslic3r_gui ${OpenCV_LIBS})
# boost's own backend for a platform without stack unwinding (wxExtensions logs a stack trace on a bad bitmap)
target_compile_definitions(libslic3r_gui PRIVATE BOOST_STACKTRACE_USE_NOOP)
target_compile_options(libslic3r_gui PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:-include>"
    "$<$<COMPILE_LANGUAGE:CXX>:${CMAKE_CURRENT_SOURCE_DIR}/stand-in-headers-gui/bambu_wasm_platform.h>")

# Web pages run their script through wx's own call on the wasm web view (WebKitGTK's otherwise).
orca_gui_patch(libslic3r_gui slic3r/GUI/Widgets/WebView.cpp
    FIND "#else
        WebKitWebView *wkWebView = (WebKitWebView *) webView->GetNativeBackend();"
    REPLACE "#elif defined(__EMSCRIPTEN__)
        return webView->RunScript(javascript);
#else
        WebKitWebView *wkWebView = (WebKitWebView *) webView->GetNativeBackend();")

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

# The sidebar's preset boxes behave as on the Linux desktop (the answer key): the extra cog beside each box is
# hidden (Bambu hides it under __linux__; it showed as a stray gear in the printer card's corner) and the filament
# box's edit menu offers "Change extruder color" as on Linux. Same code, the Linux branch taken for the browser too.
orca_gui_patch(libslic3r_gui slic3r/GUI/PresetComboBoxes.cpp
    FIND "#ifdef __linux__
                    // To edit extruder color from the sidebar"
    REPLACE "#if defined(__linux__) || defined(__EMSCRIPTEN__)
                    // To edit extruder color from the sidebar"
    FIND "#ifdef __linux__
        edit_btn->Hide();"
    REPLACE "#if defined(__linux__) || defined(__EMSCRIPTEN__)
        edit_btn->Hide();"
    FIND "#ifdef __linux__
    // To edit extruder color from the sidebar
    if (m_type == Preset::TYPE_FILAMENT) {"
    REPLACE "#if defined(__linux__) || defined(__EMSCRIPTEN__)
    // To edit extruder color from the sidebar
    if (m_type == Preset::TYPE_FILAMENT) {")

# OpenGL ES version: WebGL2 says "OpenGL ES 3.0 (WebGL 2.0 ...)"; Bambu reads the first word ("OpenGL") as the
# number and gets 0. PrusaSlicer 2.9.0 OpenGLManager.cpp:151-160 (its SLIC3R_OPENGL_ES path): the number after
# "OpenGL ES". Framebuffer objects are core in ES 3.0 under the ARB (core) names; Emscripten's GLEW does not report it.
# The 3D view at display scaling: the GTK3 scaled-GL path (shared/cmake/RetinaGl.cmake).
include("${CMAKE_CURRENT_SOURCE_DIR}/../shared/cmake/RetinaGl.cmake")
slicer_retina_gl_patch(libslic3r_gui)

orca_gui_patch(libslic3r_gui slic3r/GUI/OpenGLManager.cpp
    FIND "    std::vector<std::string> numbers;
    boost::split(numbers, tokens[0], boost::is_any_of(\".\"), boost::token_compress_on);"
    REPLACE "#ifdef __EMSCRIPTEN__
    const std::string version_container = (tokens.size() > 2 && boost::istarts_with(tokens[1], \"ES\")) ? tokens[2] : tokens[0];
#else
    const std::string version_container = tokens[0];
#endif // __EMSCRIPTEN__

    std::vector<std::string> numbers;
    boost::split(numbers, version_container, boost::is_any_of(\".\"), boost::token_compress_on);"
    FIND "        else {
            s_framebuffers_type = EFramebufferType::Unknown;"
    REPLACE "        else {
#ifdef __EMSCRIPTEN__
            s_framebuffers_type = EFramebufferType::Arb;
#else
            s_framebuffers_type = EFramebufferType::Unknown;
#endif // __EMSCRIPTEN__")

# WebGL2 = OpenGL ES 3.0, below Bambu's 3.1 line: Bambu takes its own pre-3.1 path everywhere (legacy G-code
# renderer, no texture-buffer shaders). Its shader files for that path are GLSL 1.10; the browser compiles
# GLSL ES only, so the shaders come from shaders/ES (see below) instead of shaders/110.
orca_gui_patch(libslic3r_gui slic3r/GUI/GLShadersManager.cpp
    FIND "    const std::string glsl_version_prefix = gl31 ? \"140/\" : \"110/\";"
    REPLACE "#ifdef __EMSCRIPTEN__
    const std::string glsl_version_prefix = \"ES/\";
#else
    const std::string glsl_version_prefix = gl31 ? \"140/\" : \"110/\";
#endif // __EMSCRIPTEN__")

# Bambu's test for the transfer-progress callback (curl 7.32+) reads "MAJOR >= 7 && MINOR >= 32", false for
# curl 8.10. curl's own LIBCURL_VERSION_NUM is the right test (same fix as the Orca spike).
orca_gui_patch(libslic3r_gui slic3r/Utils/Http.cpp
    FIND "#if LIBCURL_VERSION_MAJOR >= 7 && LIBCURL_VERSION_MINOR >= 32"
    REPLACE "#if LIBCURL_VERSION_NUM >= 0x072000"
    FIND "	::curl_easy_setopt(curl, CURLOPT_USERAGENT, SLIC3R_APP_NAME \"/\" SLIC3R_VERSION);"
    REPLACE "#ifdef __EMSCRIPTEN__
	// not Bambu Studio's own name: this is Boolean3d's browser build of it
	::curl_easy_setopt(curl, CURLOPT_USERAGENT, \"Boolean3d-browser-build/\" SLIC3R_VERSION);
#else
	::curl_easy_setopt(curl, CURLOPT_USERAGENT, SLIC3R_APP_NAME \"/\" SLIC3R_VERSION);
#endif // __EMSCRIPTEN__"
    FIND "void Http::priv::http_perform()
{"
    REPLACE "#ifdef __EMSCRIPTEN__
// Never Bambu Lab's or MakerWorld's servers from the browser build (the rule of these builds): every request the
// program makes (profile sync, version policy, Home's model lists, staff picks, MakerLab, HMS, analytics) passes here
// and one to those hosts ends at once as a failed request, as on a desktop with no connection to them. The page
// host's relay refuses them too.
static bool b3d_maker_host(const char *url)
{
	CURLU *h = curl_url(); char *host = nullptr; bool hit = false;
	if (h && curl_url_set(h, CURLUPART_URL, url, 0) == CURLUE_OK && curl_url_get(h, CURLUPART_HOST, &host, 0) == CURLUE_OK && host) {
		const std::string s(host);
		for (const char *d : {\"bambulab.com\", \"bambulab.cn\", \"bambulab.net\", \"bambu-lab.com\", \"bblmw.com\", \"makerworld.com\", \"makerworld.com.cn\"}) {
			const std::string ds(d);
			if (s == ds || (s.size() > ds.size() && s.compare(s.size() - ds.size() - 1, std::string::npos, \".\" + ds) == 0)) hit = true;
		}
	}
	curl_free(host); curl_url_cleanup(h);
	return hit;
}
#endif // __EMSCRIPTEN__

void Http::priv::http_perform()
{"
    FIND "	CURLcode res = ::curl_easy_perform(curl);
	if (res != CURLE_OK) {"
    REPLACE "#ifdef __EMSCRIPTEN__
	{
		char *u = nullptr;
		if (::curl_easy_getinfo(curl, CURLINFO_EFFECTIVE_URL, &u) == CURLE_OK && u && b3d_maker_host(u)) {
			BOOST_LOG_TRIVIAL(info) << \"http: not sent from the browser build: \" << u;
			if (errorfn) { errorfn(std::string(), \"Couldn't connect to server\", 0); }
			return;
		}
	}
#endif // __EMSCRIPTEN__
	CURLcode res = ::curl_easy_perform(curl);
	if (res != CURLE_OK) {")

# The printer link: Boolean3d's own LAN agent (printer-link/lan_printer_agent.cpp) answers NetworkAgent's look-ups of the network
# library; the link sends dlopen/dlsym/dlclose there (see the program's link options). Bambu's closed plugin is never
# fetched: download_plugin stops at its start in the tab.
target_sources(libslic3r_gui PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan_printer_agent.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan_printer_camera.cpp")
# The slicer door (slicer-door): page scripts drive the plater (open, arrange, slice, export), never print.
target_sources(libslic3r_gui PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/script-door/script_door.cpp")
orca_gui_patch(libslic3r_gui slic3r/GUI/GUI_App.cpp
    FIND "    BOOST_LOG_TRIVIAL(info) << \"[download_plugin]: enter\";"
    REPLACE "    BOOST_LOG_TRIVIAL(info) << \"[download_plugin]: enter\";
#ifdef __EMSCRIPTEN__
    return -1; // the browser tab's printer link is its own (lan_printer_agent.cpp); nothing is downloaded
#endif // __EMSCRIPTEN__"
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
    FIND "void GUI_App::check_new_version(bool show_tips, int by_user)
{"
    REPLACE "void GUI_App::check_new_version(bool show_tips, int by_user)
{
#ifdef __EMSCRIPTEN__
    // The browser build asks no app-version server: the tab always runs the version Boolean3d hosts and a desktop
    // installer means nothing there. Help > Check for update says it is current.
    if (by_user) no_new_version();
    return;
#endif // __EMSCRIPTEN__"
    FIND "void GUI_App::check_beta_version(bool show_tips_when_no_beta)
{"
    REPLACE "void GUI_App::check_beta_version(bool show_tips_when_no_beta)
{
#ifdef __EMSCRIPTEN__
    return; // no app-version checks in the browser build (see check_new_version)
#endif // __EMSCRIPTEN__"
    FIND "            else
                create_network_agent = true;"
    REPLACE "            else {
                create_network_agent = true;
#ifdef __EMSCRIPTEN__
                // The browser build's network module is built in (lan_printer_agent.cpp): it is installed, as desktop
                // records after a plugin install (install_plugin), so the setup wizard skips its plugin page and
                // never offers a download.
                app_config->set_str(\"app\", \"installed_networking\", \"1\");
#endif // __EMSCRIPTEN__
            }")
# No profile or resource updates from Bambu's servers (zero requests to Bambu): the printer,
# filament and process profiles ship inside the package, as installed; the updater's start-up sync (sync_config,
# sync_plugins, sync_printer_config -> sync_resources at api.bambulab.com) never runs. Local checks of the shipped
# profiles (check_config_updates_from_updater on a newer bundled vendor file) are unchanged.
# Network identity: the tab never tells a server it is Bambu Studio and never asks for
# Bambu's closed network plugin: no X-BBL-* client headers (name, version, device id, OS, language) on any request
# (desktop puts them on all), no plugin address, no start-up plugin update (our LAN agent answers with a version).
orca_gui_patch(libslic3r_gui slic3r/Utils/PresetUpdater.cpp
    FIND "    if (cancel) return;

    if (plugin_version == \"00.00.00.00\") {"
    REPLACE "    if (cancel) return;
#ifdef __EMSCRIPTEN__
    return; // the browser build's printer link is its own; Bambu's closed plugin is never asked for
#endif // __EMSCRIPTEN__

    if (plugin_version == \"00.00.00.00\") {"
    FIND "    //p->set_download_prefs(GUI::wxGetApp().app_config);
    if (!p->enabled_version_check && !p->enabled_config_update) { return; }"
    REPLACE "    //p->set_download_prefs(GUI::wxGetApp().app_config);
#ifdef __EMSCRIPTEN__
    return; // the browser build never syncs profiles from Bambu's servers: they ship inside the package
#endif // __EMSCRIPTEN__
    if (!p->enabled_version_check && !p->enabled_config_update) { return; }")

# Web sites and sign-in: a web site opens in a new browser tab, never inside our page
# (the web view itself does that for any page: shared/wxwidgets-web webview_wasm.cpp). Home's Online Models and MakerLab
# (and every model card or search that lands there) open makerworld.com in a new tab, as Maker's Supply does on
# desktop, and Home stays on what it showed. No Bambu account sign-in: it needs Bambu's closed network plug-in, which
# the browser build never has, and a Bambu password must never pass through our site. Login/Register shows the
# desktop's own "plug-in not detected" box, without its download link (the plug-in is never downloaded).
orca_gui_patch(libslic3r_gui slic3r/GUI/WebViewDialog.cpp
    FIND "void WebViewPanel::SwitchWebContent(std::string modelname, int refresh)
{
    m_contentname = modelname;"
    REPLACE "void WebViewPanel::SwitchWebContent(std::string modelname, int refresh)
{
#ifdef __EMSCRIPTEN__
    if (modelname == \"online\" || modelname == \"makerlab\") {
        const std::string host = wxGetApp().get_model_http_url(wxGetApp().app_config->get_country_code());
        const std::string lang = wxGetApp().current_language_code_safe().BeforeFirst('_').ToStdString();
        std::string site;
        if (modelname == \"makerlab\") {
            site = m_MakerLab_LastUrl.empty() ? host + \"makerlab\" : m_MakerLab_LastUrl.ToStdString();
            m_MakerLab_LastUrl = \"\";
        } else {
            // the studio's own MakerWorld page for a model or a search, as the web site's page
            const std::string last = m_online_LastUrl.ToStdString();
            std::smatch m;
            if (std::regex_search(last, m, std::regex(\"[?&]modelid=([^&#]+)\")))
                site = host + lang + \"/models/\" + m[1].str();
            else if (std::regex_search(last, m, std::regex(\"[?&]keyword=([^&#]*)\")))
                site = host + lang + \"/search/models?keyword=\" + m[1].str();
            else
                site = host + lang;
            m_online_LastUrl = \"\";
        }
        wxLaunchDefaultBrowser(site);
        SwitchLeftMenu(m_contentname.empty() ? std::string(\"home\") : m_contentname);
        return;
    }
#endif // __EMSCRIPTEN__
    m_contentname = modelname;")
orca_gui_patch(libslic3r_gui slic3r/GUI/WebUserLoginDialog.cpp
    FIND "    SetBackgroundColour(*wxWHITE);
    // Url
    NetworkAgent* agent = wxGetApp().getAgent();
    if (!agent) {"
    REPLACE "    SetBackgroundColour(*wxWHITE);
    // Url
    NetworkAgent* agent = wxGetApp().getAgent();
#ifdef __EMSCRIPTEN__
    agent = nullptr; // no Bambu account sign-in in the browser build: the desktop's no-plug-in box
#endif // __EMSCRIPTEN__
    if (!agent) {"
    FIND "        auto m_download_hyperlink = new wxHyperlinkCtrl("
    REPLACE "#ifndef __EMSCRIPTEN__
        auto m_download_hyperlink = new wxHyperlinkCtrl("
    FIND "        m_sizer_main->Add(m_message, 0, wxALIGN_CENTER | wxALL, FromDIP(15));
        m_sizer_main->Add(m_download_hyperlink, 0, wxALIGN_CENTER | wxALL, FromDIP(10));"
    REPLACE "#endif // __EMSCRIPTEN__
        m_sizer_main->Add(m_message, 0, wxALIGN_CENTER | wxALL, FromDIP(15));
#ifndef __EMSCRIPTEN__
        m_sizer_main->Add(m_download_hyperlink, 0, wxALIGN_CENTER | wxALL, FromDIP(10));
#endif // __EMSCRIPTEN__")

# HMS pictures (a freeze after connecting an X1C): desktop decodes every picture in
# hms/local_image (143 files, 29 MB) the first time one is asked for, which is quick from a disk. In the browser each
# file is a download the page thread waits for, so the tab froze ~30 s. The browser build reads only the picture asked
# for, once, and keeps it: the same pictures on screen, fetched as they are shown.
# X1C (00M) and P1S (01P) printer messages are shipped too (remove-maker-branding.py, printer-messages/): read from the program's files.
orca_gui_patch(libslic3r_gui slic3r/GUI/HMS.cpp
    FIND "static unordered_set<string> package_dev_id_types {\"094\", \"239\", \"093\", \"20P\", \"22E\", \"31B\", \"26A\"};"
    REPLACE "static unordered_set<string> package_dev_id_types {\"094\", \"239\", \"093\", \"20P\", \"22E\", \"31B\", \"26A\", \"00M\", \"01P\"};"
    FIND "    if (m_hms_local_images.empty())
    {
        const fs::path& local_img_dir = fs::path(Slic3r::data_dir()) / HMS_LOCAL_IMG_PATH;"
    REPLACE "#ifdef __EMSCRIPTEN__
    {
        auto hit = m_hms_local_images.find(image_name);
        if (hit != m_hms_local_images.end())
            return hit->second;
        const fs::path image_path = fs::path(Slic3r::data_dir()) / HMS_LOCAL_IMG_PATH / image_name.ToUTF8().data();
        wxImage image;
        if (fs::exists(image_path))
            image = wxImage(wxString::FromUTF8(image_path.string()));
        m_hms_local_images[image_name] = image;
        return image;
    }
#endif // __EMSCRIPTEN__
    if (m_hms_local_images.empty())
    {
        const fs::path& local_img_dir = fs::path(Slic3r::data_dir()) / HMS_LOCAL_IMG_PATH;")

# Live camera (smooth-camera 10-24: "about the same quality as the P1S... just super laggy", "full screen on the video
# doesn't work"). The camera view lets the page play the printer's own H.264 over it (printer-link/lan_printer_camera.cpp: the
# helper passes the stream through, the browser decodes it on a <canvas> placed over this window), and the full-screen
# button makes that picture fill the screen with the browser's own full screen (a second wx frame cannot take the
# screen in a tab). Desktop's own path stays for a view with no page video.
orca_gui_patch(libslic3r_gui slic3r/GUI/wxMediaCtrl3.cpp
    FIND "#include \"wxMediaCtrl3.h\""
    REPLACE "#include \"wxMediaCtrl3.h\"
#include <functional>"
    FIND "    Bind(wxEVT_MOUSEWHEEL, &wxMediaCtrl3::mouseWheelEvent, this);
}"
    REPLACE "    Bind(wxEVT_MOUSEWHEEL, &wxMediaCtrl3::mouseWheelEvent, this);
#ifdef __EMSCRIPTEN__
    void b3d_camera_host_add(wxWindow *, std::function<void *()>, const double *);
    b3d_camera_host_add(this, [this] { return (void *) m_tunnel.load(); }, &m_zoom);
#endif // __EMSCRIPTEN__
}"
    FIND "wxMediaCtrl3::~wxMediaCtrl3()
{"
    REPLACE "wxMediaCtrl3::~wxMediaCtrl3()
{
#ifdef __EMSCRIPTEN__
    void b3d_camera_host_remove(wxWindow *);
    b3d_camera_host_remove(this);
#endif // __EMSCRIPTEN__")
orca_gui_patch(libslic3r_gui slic3r/GUI/StatusPanel.cpp
    FIND "#include \"StatusPanel.hpp\""
    REPLACE "#include \"StatusPanel.hpp\"
#ifdef __EMSCRIPTEN__
// printer-link/lan_printer_camera.cpp (global namespace): the page's picture of this view fills the screen.
bool b3d_camera_fullscreen(wxWindow *);
#endif // __EMSCRIPTEN__"
    FIND "void StatusBasePanel::toggle_camera_fullscreen()
{"
    REPLACE "void StatusBasePanel::toggle_camera_fullscreen()
{
#ifdef __EMSCRIPTEN__
    if (m_media_ctrl && !is_camera_fullscreen() && ::b3d_camera_fullscreen(m_media_ctrl)) return;
#endif // __EMSCRIPTEN__")

# --- the program: Bambu Studio's own src/BambuStudio.cpp (CLI + GUI entry) -------------------------
# Resources at /bambu/resources (see start-up.js), as the Linux AppImage lays them out beside bin/.
set(BAMBU_RESOURCES_PRELOAD images fonts info printers data flush filament_mixing calib tooltip handy_models model
    profiles_template shapes custom_gcodes dailytip cert web hms i18n "profiles" CACHE STRING "resources/ folders preloaded")
# Bambu's GLSL 1.40 shaders are in/out style, so ES 3.00 copies are the same text under "#version 300 es" with
# default precisions. gcode*.{vs,fs} (texture buffers, the 3.1+ advanced viewer) are left out: not on ES 3.0.
set(_es "${CMAKE_BINARY_DIR}/shaders-ES")
file(MAKE_DIRECTORY "${_es}")
file(GLOB _gl140 "${ORCA_SRC}/resources/shaders/140/*")
foreach (f IN LISTS _gl140)
    get_filename_component(n "${f}" NAME)
    if (n MATCHES "^gcode")
        continue ()
    endif ()
    file(READ "${f}" text)
    string(FIND "${text}" "#version 140" at)
    if (NOT at EQUAL 0)
        message(FATAL_ERROR "${f} does not start with #version 140")
    endif ()
    string(REPLACE "#version 140" "#version 300 es\nprecision highp float;\nprecision highp int;" text "${text}")
    # "sample" is reserved in GLSL ES 3.00 (gaussian_blur33, silhouette_composite name a function so)
    string(REGEX REPLACE "([^A-Za-z0-9_])sample\\(" "\\1sample_at(" text "${text}")
    file(WRITE "${_es}/${n}" "${text}")
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${f}")
endforeach ()
set(_preload "SHELL:--preload-file ${_es}@/bambu/resources/shaders/ES")
# the system font, Noto Sans (shared/fonts, OFL; js/app-fonts.js, edits/n-system-font.py)
list(APPEND _preload "SHELL:--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/../shared/fonts@/wx-fonts")
# The certificate store the program's own HTTPS checks against (Debian's Mozilla bundle), at OpenSSL's own default
# file (OPENSSLDIR/cert.pem, as a distro's OpenSSL has it); libcurl falls back to it (CA_FALLBACK, as the desktop deps).
list(APPEND _preload "SHELL:--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/ca-certificates.crt@/w/ow/prefix-mt/ssl/cert.pem")
# images/ and web/ come from remove-maker-branding.py's copy: no Bambu Lab logo, no Bambu account sign-in, no store, no telemetry
# page; the package is made from a resources folder that takes these two from the same copy (build.sh).
set(_maker_free "${CMAKE_BINARY_DIR}/maker-free")
execute_process(COMMAND python3 "${CMAKE_CURRENT_SOURCE_DIR}/remove-maker-branding.py" "${ORCA_SRC}/resources" "${_maker_free}" RESULT_VARIABLE _mf_rc)
if (NOT _mf_rc EQUAL 0)
    message(FATAL_ERROR "remove-maker-branding.py failed")
endif ()
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/remove-maker-branding.py")
foreach (r IN LISTS BAMBU_RESOURCES_PRELOAD)
    if (EXISTS "${_maker_free}/${r}")
        list(APPEND _preload "SHELL:--preload-file ${_maker_free}/${r}@/bambu/resources/${r}")
    elseif (EXISTS "${ORCA_SRC}/resources/${r}")
        list(APPEND _preload "SHELL:--preload-file ${ORCA_SRC}/resources/${r}@/bambu/resources/${r}")
    endif ()
endforeach ()
# the vendor presets bundle (off-thread write-presets-bundle.py): one file the worker serves the preset files from
list(APPEND _preload "SHELL:--preload-file ${ORCA_SRC}/resources/b3d-bundle@/bambu/resources/b3d-bundle")
add_executable(bambu_app EXCLUDE_FROM_ALL "${ORCA_SRC}/src/BambuStudio.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/gl_compat.c" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_console_log.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_debug.cpp"
    "${ENGINE_SRC}/allocator/scalable_malloc.c" "${ENGINE_SRC}/allocator/mimalloc_options.c")
set_source_files_properties("${ENGINE_SRC}/allocator/mimalloc_options.c" PROPERTIES
    INCLUDE_DIRECTORIES "${EMSCRIPTEN_ROOT_PATH}/system/lib/mimalloc/include")
# The program is named after the slicer: bambustudio.html/.js/.wasm/.data (the page itself is served as index.html by the package)
set_target_properties(bambu_app PROPERTIES OUTPUT_NAME "bambustudio" SUFFIX ".html")
# unix/fhs.hpp, as Bambu's top-level CMakeLists makes it: SLIC3R_FHS off = the AppImage layout (resources beside bin/).
configure_file("${ORCA_SRC}/src/platform/unix/fhs.hpp.in" "${CMAKE_BINARY_DIR}/platform/unix/fhs.hpp")
target_include_directories(bambu_app PRIVATE "${ORCA_SRC}/src" "${ORCA_SRC}/src/slic3r")
target_include_directories(bambu_app SYSTEM PRIVATE "${CMAKE_BINARY_DIR}/platform")
target_link_libraries(bambu_app PRIVATE libslic3r_gui libslic3r cereal::cereal)
# The program sees min(cores, 8) cores on every thread (shared/js/tab-cores.js; replaces slice-threads.cpp, whose TBB-only
# cap froze the first Slice on computers with more than 8 cores), the pool to match; pthread-spares.js keeps 8 loaded
# spare workers so starting a thread never waits for a new Worker while the page thread is blocked.
# Threads come from a pool made at start-up (a worker cannot start one later). TBB takes every hardware thread less
# one; Bambu Studio's own threads (background slicer, HTTP, web requests, wx timers, printer agents: 11 at start-up,
# more later) come on top. "+4" (the engine alone) ran out when the setup wizard loaded the printer profiles.
target_link_options(bambu_app PRIVATE
    # main() runs in a worker (PROXY_TO_PTHREAD): the page thread only composites, forwards input and answers the
    # program's proxied page calls (shared/js/page-bridge.js and page-bridge-web.js are js-libraries of those; page-extras.js is
    # the page's own pre-js). The windows' canvases are transferred to that worker (OFFSCREENCANVAS_SUPPORT; $GL so the
    # GL library is linked for the transfer). The pool is one bigger: the main pthread itself takes a worker.
    -sJSPI -sPROXY_TO_PTHREAD -sOFFSCREENCANVAS_SUPPORT "-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=$GL"
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sINITIAL_MEMORY=256MB -sSTACK_SIZE=16MB -sMALLOC=mimalloc
    "-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency,8)+17" -sPTHREAD_POOL_SIZE_STRICT=2 -sDEFAULT_PTHREAD_STACK_SIZE=8MB
    --emit-symbol-map -Wl,--error-limit=0
    -sUSE_WEBGL2=1 -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2 -sFULL_ES3=1
    -sEXPORTED_RUNTIME_METHODS=HEAP8,HEAPU8,HEAP32,HEAPF32,HEAPF64,FS,stringToNewUTF8 -sFORCE_FILESYSTEM=1
    "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge-web.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/presets-bundle-reader.js" "SHELL:--pre-js ${WX_SRC}/build/wasm/wx.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../wxwidgets-drawing/js/graphics-context.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/app-fonts.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/glew-context.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/tab-cores.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/pthread-spares.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/gl-no-context.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/net-worker.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/start-up.js"
    "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan-printer-link.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/script-door/script-door.js" -Wl,--wrap=dlopen,--wrap=dlsym,--wrap=dlclose
    "-sEXPORTED_FUNCTIONS=_main,_b3d_lan_incoming,_b3d_lan_camera_frame,_b3d_lan_camera_size,_b3d_door_call,_b3d_door_now,_malloc,_free"
    "SHELL:--shell-file ${WX_SRC}/build/wasm/template.html" ${_preload})
# A changed --pre-js or page template relinks (CMake does not see them otherwise).
set_property(TARGET bambu_app APPEND PROPERTY LINK_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/script-door/script-door.js" "${WX_SRC}/build/wasm/wx.js" "${CMAKE_CURRENT_SOURCE_DIR}/../wxwidgets-drawing/js/graphics-context.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/app-fonts.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/net-worker.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/glew-context.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/gl-no-context.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/tab-cores.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/pthread-spares.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge-web.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/presets-bundle-reader.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/start-up.js" "${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan-printer-link.js" "${WX_SRC}/build/wasm/template.html"
    "${CMAKE_CURRENT_SOURCE_DIR}/remove-maker-branding.py")
