# Creality Print v7.3.0's own GUI (src/slic3r) compiled to WebAssembly over the wasm wx port, the same way as
# OrcaSlicer's browser build (orcaslicer/browser-build, which this file started from: Creality Print is an OrcaSlicer fork).
# libslic3r is Creality's own, built by the Muon3D engine's out-of-tree recipe (ORCA_SRC = the Creality tree; the engine
# set up for it by engine-for-creality.py), plus Creality's wasm fixes (cmake/CrealitySourcePatches.cmake).
# Creality's three closed add-ons (TPMS gradual infill, Field infill, colour mixing) exist only as desktop binaries:
# stand-ins/creality_closed_addons.cpp takes their place and says they are not in the browser version.
# Configure (in b3d-emsdk:6.0.10):
#   emcmake cmake -S /w/browser-port/browser-build -B /w/bgui -G Ninja -C /w/ow/prefix-mt/share/orcawasm/initial-cache.cmake
# CREALITY_CORE_ONLY=ON stops after libslic3r (no wx needed).
cmake_minimum_required(VERSION 3.24)
project(creality_gui_wasm C CXX)

set(ORCA_SRC "/w/cp" CACHE PATH "Creality Print v7.3.0 source")
set(ENGINE_SRC "/w/eng/engine" CACHE PATH "Muon3D engine (engine/ folder)")
set(WX_PREFIX "/w/prefix33" CACHE PATH "wasm wx prefix (wx 3.3.2 port)")
set(WX_SRC "/w/owx33" CACHE PATH "wasm wx source (its build/wasm page template and wx.js)")
option(CREALITY_CORE_ONLY "Build libslic3r only" OFF)
set(ENGINE_VARIANT mt CACHE STRING "" FORCE)
set(ENGINE_LIBSLIC3R_ONLY ON)
set(ENGINE_EXTRA_PATCHES "${CMAKE_CURRENT_SOURCE_DIR}/cmake/CrealitySourcePatches.cmake")
set(GUI_SHIMS "${CMAKE_CURRENT_SOURCE_DIR}/shims")
set(CR_CLOSED_HEADERS "${ORCA_SRC}/deps/CR_TPMS/cr_tpms/include" "${ORCA_SRC}/deps/CR_KM_RECIPE/cr_km_recipe/include"
    "${ORCA_SRC}/deps/CR_CLOSED/CR_FILLTENSOR/cr_FillTensor/include")

list(PREPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

# --- libslic3r, as the engine builds it, from Creality's tree ------------------------------------
find_package(Eigen3 5.0.1 CONFIG REQUIRED)
add_library(eigen INTERFACE)
target_link_libraries(eigen INTERFACE Eigen3::Eigen)
add_compile_options(-Wno-c++11-narrowing)
# Creality's top-level CMakeLists defines it (a source encoding check on Windows); its src/ libraries call it.
function(encoding_check target)
endfunction()
add_subdirectory("${ENGINE_SRC}" engine EXCLUDE_FROM_ALL)
# Creality's libigl (as Orca v2.3.2's) wants CGAL/gmpxx.h in MeshBoolean.cpp, and its slice.cpp Eigen's removed
# DynamicSparseMatrix: the same stand-in headers as the OrcaSlicer build (see them).
target_include_directories(libslic3r_cgal SYSTEM BEFORE PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/stand-in-headers-cgal")
target_compile_options(libslic3r_cgal PRIVATE -include "${CMAKE_CURRENT_SOURCE_DIR}/stand-in-headers-cgal/eigen-dynamic-sparse.h")
# Creality's clipper.hpp includes oneTBB's scalable_allocator.h (its desktop CMakeLists links TBB to clipper):
# the header from the prefix's oneTBB (tbb::scalable_allocator = malloc here, see the GUI part below).
find_package(TBB 2021 CONFIG REQUIRED COMPONENTS tbb)   # the engine finds it in its own directory scope
get_target_property(_tbb_inc TBB::tbb INTERFACE_INCLUDE_DIRECTORIES)
target_include_directories(clipper SYSTEM PUBLIC ${_tbb_inc})
# Creality's bundled libraries (libnest2d, clipper, libslic3r_cgal) link the name tbb_libs, which its top-level
# CMakeLists makes (TBB::tbb + TBB::tbbmalloc): the same here without tbbmalloc (scalable_allocator = malloc, below).
add_library(tbb_libs INTERFACE)
target_link_libraries(tbb_libs INTERFACE TBB::tbb)
# The closed add-ons' public headers (Creality's own, AGPL tree) and their stand-ins, compiled into libslic3r: the
# desktop links the closed archives there (src/CMakeLists.txt find_library cr_*), the browser build these.
# Creality's src/ layout: libigl (<igl/...>) is found through src/libigl, as its top-level CMakeLists puts it on every
# target's path, and the bundled libraries (admesh, clipper, ...) take Eigen from the include path too. Eigen is the
# prefix's (the engine's), as for OrcaSlicer.
get_target_property(_eigen_inc Eigen3::Eigen INTERFACE_INCLUDE_DIRECTORIES)
foreach (t admesh clipper Clipper2 libnest2d libslic3r libslic3r_cgal mcut qhull semver glu-libtess miniz_static)
    if (TARGET ${t})
        get_target_property(_type ${t} TYPE)
        if (_type STREQUAL "INTERFACE_LIBRARY")
            target_include_directories(${t} SYSTEM INTERFACE ${_eigen_inc} "${ORCA_SRC}/src/libigl")
        else ()
            target_include_directories(${t} SYSTEM PRIVATE ${_eigen_inc} "${ORCA_SRC}/src/libigl")
        endif ()
    endif ()
endforeach ()
target_include_directories(libslic3r SYSTEM PUBLIC ${_eigen_inc} "${ORCA_SRC}/src/libigl")
# DataDirectoryVersion.hpp, made by Creality's libslic3r CMakeLists (configure_file) from the top-level CMakeLists' number.
file(STRINGS "${ORCA_SRC}/CMakeLists.txt" _dv REGEX "^set\\(CREALITYPRINT_DATA_VERSION \"[0-9.]+\"")
string(REGEX REPLACE ".*\"([0-9.]+)\".*" "\\1" CREALITYPRINT_DATA_VERSION "${_dv}")
configure_file("${ORCA_SRC}/src/libslic3r/DataDirectoryVersion.hpp.in" "${CMAKE_BINARY_DIR}/libslic3r/DataDirectoryVersion.hpp" @ONLY)
# Creality has no Format/DRC (draco): the engine's stand-in for it goes. Assimp (.dae/.3ds/.ply/.off): a stand-in.
get_target_property(_slic3r_src libslic3r SOURCES)
list(FILTER _slic3r_src EXCLUDE REGEX "stubs/Format/DRC\\.cpp$")
set_property(TARGET libslic3r PROPERTY SOURCES ${_slic3r_src} "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/creality_engine_stubs.cpp")
set_source_files_properties("${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/creality_engine_stubs.cpp" TARGET_DIRECTORY libslic3r
    PROPERTIES INCLUDE_DIRECTORIES "${ENGINE_SRC}/stubs")
target_include_directories(libslic3r PUBLIC ${CR_CLOSED_HEADERS})
target_compile_definitions(libslic3r PUBLIC CR_FILLTENSOR_STATIC_DEFINE CR_CLOSE_STATIC_DEFINE)
target_sources(libslic3r PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/creality_closed_addons.cpp")
set_source_files_properties("${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/creality_closed_addons.cpp" TARGET_DIRECTORY libslic3r
    PROPERTIES SKIP_PRECOMPILE_HEADERS ON)
if (CREALITY_CORE_ONLY)
    return()
endif ()
# The engine leaves out the SLA print (FFF never reaches it); the GUI does need it (Plater, the 3D view, the
# background slicer), so the GUI build compiles those sources back into libslic3r.
target_sources(libslic3r PRIVATE "${ORCA_SRC}/src/libslic3r/SLAPrint.cpp" "${ORCA_SRC}/src/libslic3r/SLAPrintSteps.cpp"
    "${ORCA_SRC}/src/libslic3r/Format/SL1.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/orca_gui_unsupported.cpp")
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
    CGAL_ALWAYS_ROUND_TO_NEAREST GIT_COMMIT_HASH="v7.3.0")
include_directories(BEFORE SYSTEM "${GUI_SHIMS}")
include_directories(SYSTEM "${ORCA_SRC}/src" "${ORCA_SRC}/src/libigl" "${ORCA_SRC}/src/eigen")
list(APPEND CMAKE_MODULE_PATH "${ORCA_SRC}/cmake/modules")

# --- wx ------------------------------------------------------------------------------------------
# wx 3.3.2 (the shared wx port), library names -3.3
set(WX_VER 3.3)
execute_process(COMMAND "${WX_PREFIX}/bin/wx-config" --cxxflags OUTPUT_VARIABLE WX_CXXFLAGS OUTPUT_STRIP_TRAILING_WHITESPACE)
separate_arguments(WX_CXXFLAGS UNIX_COMMAND "${WX_CXXFLAGS}")
set(wxWidgets_LIBRARIES)
foreach (c gl html aui adv propgrid core)
    list(APPEND wxWidgets_LIBRARIES "${WX_PREFIX}/lib/libwx_wasmunivu_${c}-${WX_VER}-emscripten.a")
endforeach ()
# web view, media control and web requests: added to the prefix by build-wxweb.sh
list(PREPEND wxWidgets_LIBRARIES "${WX_PREFIX}/lib/libwx_wasmunivu_webview-${WX_VER}-emscripten.a"
    "${WX_PREFIX}/lib/libwx_wasmunivu_media-${WX_VER}-emscripten.a" "${WX_PREFIX}/lib/libwx_baseu_webrequest-${WX_VER}-emscripten.a")
# wx 3.3's port builds no xml/xrc library and no regex (wxUSE_XML 0, wxUSE_REGEX 0)
list(APPEND wxWidgets_LIBRARIES "${WX_PREFIX}/lib/libwx_baseu_net-${WX_VER}-emscripten.a"
    "${WX_PREFIX}/lib/libwx_baseu-${WX_VER}-emscripten.a" "${WX_PREFIX}/lib/libwxwebp-${WX_VER}-emscripten.a"
    "${WX_PREFIX}/lib/libwxpng-${WX_VER}-emscripten.a"
    # wx is built --with-libjpeg=sys (build-wxwidgets.sh): its JPEG reader uses the app's libjpeg-turbo, linked after it
    "/w/ow/prefix-mt/lib/libjpeg.a")
add_compile_options(${WX_CXXFLAGS})

# --- GUI-side libraries ----------------------------------------------------------------------------
# Orca's PrecompiledHeader.cmake: Orca compiles libslic3r_gui with pchheader.hpp force-included
# (FORCEINCLUDE), and its sources rely on what it brings in (wx/tooltip.h, ...). Same here, as a real PCH.
macro(add_precompiled_header target header)
    target_precompile_headers(${target} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/${header}")
endmacro()
foreach (dir imgui imguizmo minilzo md4c nanosvg nlohmann fast_float ankerl earcut stb_dxt qoi glad)
    if (NOT TARGET ${dir} AND NOT (dir STREQUAL "nlohmann" AND TARGET nlohmann_json) AND EXISTS "${ORCA_SRC}/src/${dir}/CMakeLists.txt")
        add_subdirectory("${ORCA_SRC}/src/${dir}" "deps_gui/${dir}" EXCLUDE_FROM_ALL)
    endif ()
endforeach ()
# Creality 7.3.0 has no libvgcode (its G-code preview is the older GCodeViewer): Orca's libvgcode ES fix does not apply.
# imgui_draw.cpp logs through boost::log in Orca's copy.
target_link_libraries(imgui PRIVATE boost_headeronly)

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
target_include_directories(hidapi PUBLIC "${ORCA_SRC}/src/hidapi/include")

# --- Orca's GUI library, from its own CMakeLists -------------------------------------------------
set(SLIC3R_STATIC ON)
set(SLIC3R_PCH ON)    # pchheader.hpp, see add_precompiled_header above
set(_unix_saved ${UNIX})
set(UNIX OFF)    # its UNIX branches are GTK, X11, GStreamer, libsecret: none exist here
add_subdirectory("${ORCA_SRC}/src/slic3r" slic3r EXCLUDE_FROM_ALL)
set(UNIX ${_unix_saved})
target_include_directories(libslic3r_gui PRIVATE "${ORCA_SRC}/src/slic3r" "${ORCA_SRC}/src/imgui")
# Creality's menus: the closed add-ons left out or shown as "not in the browser version" (see the file).
include(CrealityBrowserEdits)
# buildinfo.h, as Creality's cmake/BuildInfoUtil.cmake makes it (HttpServer.hpp and others include it).
set(BUILD_INFO_HEAD "BUILDINFO_H_")
set(MAIN_GIT_HASH "v7.3.0")
configure_file("${ORCA_SRC}/buildinfo.h.in" "${CMAKE_BINARY_DIR}/buildinfo/buildinfo.h")
target_include_directories(libslic3r_gui PUBLIC "${CMAKE_BINARY_DIR}/buildinfo")
# Creality Cloud (G-code and video uploads through the Alibaba Cloud OSS SDK, cloud printers over Paho MQTT): neither
# library exists in the browser and the build reaches no maker's servers. Stand-in headers give Creality's own headers
# the few names they mention; stand-ins/creality_cloud_none.cpp answers every request "not in the browser version".
target_include_directories(libslic3r_gui SYSTEM PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/stand-in-headers-cloud")
# glad beside the browser's GLES3 header, and a file watcher for a wx without one: see the headers.
target_include_directories(libslic3r_gui BEFORE PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/stand-in-headers-creality")
# mdns.c (printer discovery on the local network) takes select() from <sys/select.h>, which glibc's netdb.h brings
# along and the browser's C library does not.
set_source_files_properties("${ORCA_SRC}/src/slic3r/GUI/print_manage/utils/mdns.c" TARGET_DIRECTORY libslic3r_gui
    PROPERTIES COMPILE_OPTIONS "-include;sys/select.h")
# SanitizeFilename (export names) swaps the characters file systems refuse for "_" with a wxRegEx; the tab's wx has
# no regular expressions (wxUSE_REGEX 0), so the same characters are swapped one by one.
# A part Boolean3d made (app-edits/z70: its project settings and presets are already skipped) is no third-party project
# either: Creality's vendor check would ask which printer to use and then switch to it (doSelectPrinterPreset), so it
# is passed over and the person's printer stays.
orca_gui_patch(libslic3r_gui slic3r/GUI/Plater.cpp
    FIND "                            show_substitutions_info(preset_substitutions);
                    } else {
#if !AUTOMATION_TOOL || !AUTO_CONVERT_3MF
                        if (model.objects.size() != 0 && load_config) {"
    REPLACE "                            show_substitutions_info(preset_substitutions);
                    } else {
#if !AUTOMATION_TOOL || !AUTO_CONVERT_3MF
                        if (model.objects.size() != 0 && load_config && !b3d_part_file(path.string())) {"
    FIND "    wxRegEx invalidChars(\"[<>:\\\"/\\\\|?*]\");"
    REPLACE "#if wxUSE_REGEX
    wxRegEx invalidChars(\"[<>:\\\"/\\\\|?*]\");"
    FIND "    invalidChars.ReplaceAll(&sanitized, \"_\");"
    REPLACE "    invalidChars.ReplaceAll(&sanitized, \"_\");
#else
    for (wxString::iterator it = sanitized.begin(); it != sanitized.end(); ++it)
        if (wxString(\"<>:\\\"/\\\\|?*\").Find(*it) != wxNOT_FOUND)
            *it = '_';
#endif")
# The web pages' messages: parse the UTF-8 bytes (Orca's own later form; libc++ has no char_traits<wxUniChar>, which
# json::parse(wxString) needs with wx 3.3).
foreach (f ModelMall.cpp Project.cpp WebDownPluginDlg.cpp print_manage/App/PrinterMgrView.cpp print_manage/App/SendToPrinter.cpp)
    file(READ "${ORCA_SRC}/src/slic3r/GUI/${f}" _t)
    string(REGEX MATCH "json +j *= json::parse\\(strInput\\);" _m "${_t}")
    orca_gui_patch(libslic3r_gui slic3r/GUI/${f} FIND "${_m}" REPLACE "json j = json::parse(strInput.utf8_string());")
endforeach ()
# Hollow (GUI/MeshHollow.cpp) makes its shell with OpenVDB, which the engine has not: stand-ins/creality_hollow_none.cpp.
get_target_property(_gui_src libslic3r_gui SOURCES)
list(FILTER _gui_src EXCLUDE REGEX "GUI/(UploadFile|VideoOssUploader|MeshHollow|print_manage/App/mqtt_client|print_manage/App/CloudDeviceMqttTransport)\\.cpp$")
set_property(TARGET libslic3r_gui PROPERTY SOURCES ${_gui_src} "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/creality_cloud_none.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/creality_hollow_none.cpp")
target_include_directories(libslic3r_gui SYSTEM PRIVATE ${OpenCV_INCLUDE_DIRS})
target_link_libraries(libslic3r_gui ${OpenCV_LIBS})
# Plater reads a downloaded .gz model through Boost.Iostreams' gzip filter; the engine's Boost build leaves that filter
# (and its zlib base) out. Boost 1.84's own two files (boost-iostreams-zlib/, Boost Software License), on emscripten's zlib.
add_library(boost_iostreams_zlib STATIC "${CMAKE_CURRENT_SOURCE_DIR}/boost-iostreams-zlib/zlib.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/boost-iostreams-zlib/gzip.cpp")
target_compile_definitions(boost_iostreams_zlib PRIVATE BOOST_IOSTREAMS_SOURCE BOOST_IOSTREAMS_USE_DEPRECATED)
target_link_libraries(boost_iostreams_zlib PUBLIC boost_headeronly ZLIB::ZLIB)
target_link_libraries(libslic3r_gui boost_iostreams_zlib)
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
# A filament box made while the project's colours are not in yet: Creality's PlaterPresetComboBox::update() reads
# the colour icon list at the box's filament number with no check (Orca's same spot froze the box; here it reads past
# the list's end). The icon is set once the colours are in; until then the box keeps its plain background.
orca_gui_patch(libslic3r_gui slic3r/GUI/PresetComboBoxes.cpp
    FIND "        clr_picker->SetBitmap(*get_extruder_color_icons(true)[m_filament_idx]);
#ifdef __WXOSX__"
    REPLACE "        if (auto icons = get_extruder_color_icons(true); m_filament_idx < (int) icons.size())
            clr_picker->SetBitmap(*icons[m_filament_idx]);
        else
            BOOST_LOG_TRIVIAL(warning) << \"b3d combo: no colour icon for filament \" << m_filament_idx << \" of \" << icons.size();
#ifdef __WXOSX__")
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
# Network identity: the tab never tells a server it is Creality Print and never asks for a closed network plugin:
# none of Creality's __CXY_* client headers (app, brand, language, device id = MAC address, user id, token, OS) on any
# request (desktop puts them on all), no plugin address, no start-up plugin update (our LAN agent answers with a version),
# no Creality account sign-in, no usage-data programme.
orca_gui_patch(libslic3r_gui slic3r/GUI/GUI_App.cpp
    FIND "std::map<std::string, std::string> GUI_App::get_extra_header()
{"
    REPLACE "std::map<std::string, std::string> GUI_App::get_extra_header()
{
#ifdef __EMSCRIPTEN__
    return {}; // the browser build sends no Creality client identity (no __CXY_* headers, no device id)
#endif // __EMSCRIPTEN__"
    FIND "std::string GUI_App::get_plugin_url(std::string name, std::string country_code)
{"
    REPLACE "std::string GUI_App::get_plugin_url(std::string name, std::string country_code)
{
#ifdef __EMSCRIPTEN__
    return std::string(); // Bambu's closed plugin (and camera tools) is never asked for from the browser build
#endif // __EMSCRIPTEN__"
    # a web page's sign-in region message, parsed as UTF-8 (wx 3.3: see the web pages' patch below)
    FIND "json        regionData = json::parse(strInput);"
    REPLACE "json        regionData = json::parse(strInput.utf8_string());"
    # an HTTP error body arrives as wxString in the event (same reason)
    FIND "json j = json::parse(evt.GetString());"
    REPLACE "json j = json::parse(evt.GetString().utf8_string());"
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
    # Creality's home page server (boost.asio on 127.0.0.1): a tab opens no listening socket (the acceptor throws);
    # the home page is read from the package files instead (WebViewDialog.cpp below).
    FIND "    //// CP: User Login Dialog
    if (show) {"
    REPLACE "    //// CP: User Login Dialog
#ifdef __EMSCRIPTEN__
    // no Creality account sign-in in the browser build (no password for another service passes through our site, and
    // the dialog's page is id.creality.com): every request (setup guide, account menu, cloud pages) gets the answer of
    // the desktop's dialog closed without signing in (LoginDialog::OnClose), so the page goes on as signed out
    if (show)
        CallAfter([this]() { run_script(\"window.handleStudioCmd({\\\"command\\\":\\\"login_dialog_event\\\",\\\"event\\\":\\\"close\\\"})\"); });
    show = false;
#endif // __EMSCRIPTEN__
    if (show) {"
    FIND "    privacy_dlg.set_text(privacy_version_info.description);
    privacy_dlg.on_show();"
    REPLACE "    privacy_dlg.set_text(privacy_version_info.description);
#ifdef __EMSCRIPTEN__
    // Creality's usage-data programme (slicing settings and logs sent to Creality) is not offered in the browser build:
    // the question is answered as its Cancel button does, never shown
    wxCommandEvent b3d_declined(EVT_PRIVACY_UPDATE_CANCEL);
    privacy_dlg.GetEventHandler()->ProcessEvent(b3d_declined);
#else
    privacy_dlg.on_show();
#endif // __EMSCRIPTEN__"
    FIND "void GUI_App::start_http_server()
{"
    REPLACE "void GUI_App::start_http_server()
{
#ifdef __EMSCRIPTEN__
    return; // no local web server in a tab
#endif // __EMSCRIPTEN__")
# The home page address: Creality's local server is not started in a tab, so the page comes from the package's
# resources/web/homepage as Orca's does (file://). Its time= goes as %lld: std::time(0) is 64 bits on wasm32 and the
# stock %d reads it as two ints, so every %s after it takes a wrong pointer (the first start crashed in vswprintf).
# Creality's usage-data programme is declined in the browser build (GUI_App.cpp above), so nothing is gathered for it either:
# the per-slice parameter snapshot (Plater::priv::cache_slice_info_for_current_plate, after every slice) is skipped. Its
# filament table is shorter (52) than the count it is read with (60), and the read past its end hit a bad pointer here.
orca_gui_patch(libslic3r_gui slic3r/GUI/AnalyticsDataUploadManager.cpp
    FIND "bool AnalyticsDataUploadManager::should_send_print_event() const
{"
    REPLACE "bool AnalyticsDataUploadManager::should_send_print_event() const
{
#ifdef __EMSCRIPTEN__
    return false;
#endif // __EMSCRIPTEN__")
orca_gui_patch(libslic3r_gui slic3r/GUI/WebViewDialog.cpp
    FIND "    wxString url = wxString::Format(
        \"http://localhost:%d/homepage/index.html?"
    REPLACE "#ifdef __EMSCRIPTEN__
    return wxString::Format(\"file://%s/web/homepage/index.html?lang=%s&version=%s&type=%s&region=%s&use_inches=%s&debug=false&ai=true&time=%lld&privacy=%d&os=%s#/Community/Home Page\",
        from_u8(resources_dir()), lang, version, type, region, use_inches, (long long) std::time(0), (int) wxGetApp().is_privacy_checked(), os_description);
#endif // __EMSCRIPTEN__
    wxString url = wxString::Format(
        \"http://localhost:%d/homepage/index.html?")
# No printer link here: Creality Print never loads Bambu's network plug-in (GUI_App::on_init_network returns before
# it), so Orca's built-in LAN agent has nothing to answer; sending to printers is a later session's work. The camera
# window keeps the tab's wxMediaCtrl2 below (printer-link/lan_printer_camera.cpp is its picture source).
target_sources(libslic3r_gui PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan_printer_camera.cpp")
set_source_files_properties("${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan_printer_camera.cpp"
    TARGET_DIRECTORY libslic3r_gui PROPERTIES COMPILE_DEFINITIONS B3D_LAN_AGENT_ORCA SKIP_PRECOMPILE_HEADERS ON)   # Creality's BambuTunnel.h is Orca's older one
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
target_compile_options(libslic3r_gui PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:SHELL:-include ${CMAKE_BINARY_DIR}/gui-patched/slic3r/GUI/wxMediaCtrl2.h>")
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
    FIND "    NetworkAgent* agent = wxGetApp().getAgent();
    if (!agent) {"
    REPLACE "    NetworkAgent* agent = wxGetApp().getAgent();
#ifdef __EMSCRIPTEN__
    if (true) { // no account sign-in in the browser build: the desktop's no-plug-in box
#else
    if (!agent) {
#endif // __EMSCRIPTEN__"
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

# OpenGL ES version: WebGL2 says "OpenGL ES 3.0 (WebGL 2.0 ...)"; Orca reads the first word ("OpenGL") as the
# number, gets 0 and refuses ("lower than 3.2"). PrusaSlicer 2.9.0 OpenGLManager.cpp:151-160 and :373-377 (its
# SLIC3R_OPENGL_ES path, which Orca dropped): the number after "OpenGL ES", and ES 3.0 is enough.
# Framebuffer objects are core in ES 3.0 under the ARB (core) names; Emscripten's GLEW does not report the extension.
# The 3D view at display scaling: the GTK3 scaled-GL path (shared/cmake/RetinaGl.cmake).
include("${CMAKE_CURRENT_SOURCE_DIR}/../shared/cmake/RetinaGl.cmake")
slicer_retina_gl_patch(libslic3r_gui)

# (Creality's GLInfo reads the version in two places, parse_version and is_version_greater_or_equal_to's helper.)
orca_gui_patch(libslic3r_gui slic3r/GUI/OpenGLManager.cpp
    FIND "        return false;

    std::vector<std::string> numbers;
    boost::split(numbers, tokens[0], boost::is_any_of(\".\"), boost::token_compress_on);

    if (numbers.size() > 0)
        major"
    REPLACE "        return false;
#if SLIC3R_OPENGL_ES
    if (tokens.size() > 2 && boost::istarts_with(tokens[1], \"ES\"))
        tokens.erase(tokens.begin(), tokens.begin() + 2); // \"OpenGL ES 3.0 (WebGL 2.0 ...)\": the number after \"OpenGL ES\"
#endif // SLIC3R_OPENGL_ES

    std::vector<std::string> numbers;
    boost::split(numbers, tokens[0], boost::is_any_of(\".\"), boost::token_compress_on);

    if (numbers.size() > 0)
        major"
    FIND "        return false;

    std::vector<std::string> numbers;
    boost::split(numbers, tokens[0], boost::is_any_of(\".\"), boost::token_compress_on);

    unsigned int gl_major = 0;"
    REPLACE "        return false;
#if SLIC3R_OPENGL_ES
    if (tokens.size() > 2 && boost::istarts_with(tokens[1], \"ES\"))
        tokens.erase(tokens.begin(), tokens.begin() + 2); // \"OpenGL ES 3.0 (WebGL 2.0 ...)\": the number after \"OpenGL ES\"
#endif // SLIC3R_OPENGL_ES

    std::vector<std::string> numbers;
    boost::split(numbers, tokens[0], boost::is_any_of(\".\"), boost::token_compress_on);

    unsigned int gl_major = 0;"
    FIND "        else {
            s_framebuffers_type = EFramebufferType::Unknown;"
    REPLACE "        else {
#if SLIC3R_OPENGL_ES
            s_framebuffers_type = EFramebufferType::Arb;
#else
            s_framebuffers_type = EFramebufferType::Unknown;
#endif // SLIC3R_OPENGL_ES"
    FIND "        m_valid_version = s_gl_info.is_version_greater_or_equal_to(2, 0);"
    REPLACE "#if SLIC3R_OPENGL_ES
        m_valid_version = s_gl_info.is_version_greater_or_equal_to(3, 0);
#else
        m_valid_version = s_gl_info.is_version_greater_or_equal_to(2, 0);
#endif // SLIC3R_OPENGL_ES"
    # Creality loads the GL functions with glad (gladLoaderLoadGL opens libGL); in the tab they come from the WebGL context,
    # through stand-ins/web_gl_loader.cpp for the desktop-only names Creality's GUI still calls, then the ES 3.0 names
    # glad skipped for the version WebGL2 reports (OpenGL ES 3.0)
    FIND "            version = gladLoaderLoadGL();"
    REPLACE "#ifdef __EMSCRIPTEN__
            version = gladLoadGL(b3d_web_gl_proc);
            b3d_web_gl_es3();
#else
            version = gladLoaderLoadGL();
#endif // __EMSCRIPTEN__"
    FIND "#include \"OpenGLManager.hpp\""
    REPLACE "#include \"OpenGLManager.hpp\"
#ifdef __EMSCRIPTEN__
#include <emscripten/html5.h>
extern \"C\" void (*b3d_web_gl_proc(const char *name))(void); // GLADapiproc (glad/gl.h comes later)
extern \"C\" void b3d_web_gl_es3();
#endif")
target_sources(libslic3r_gui PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_gl_loader.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../shared/cpp/gl-attrib-stack.c")
set_source_files_properties("${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_gl_loader.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/cpp/gl-attrib-stack.c"
    TARGET_DIRECTORY libslic3r_gui PROPERTIES SKIP_PRECOMPILE_HEADERS ON)

# --- the program: Creality's own src/CrealityPrint.cpp (CLI + GUI entry, unchanged) ------------------------
# Stealth Mode: the browser build never reaches a maker's cloud (no network plug-in, no sign-in, no printer config
# download, above), so it always runs as Stealth Mode does (Creality keeps Orca's "stealth_mode" setting): no HMS
# look-ups, no preset sync. The Preferences box cannot turn it off here (it is set again at every start).
orca_gui_patch(libslic3r libslic3r/AppConfig.cpp
    FIND "    if (get(\"stealth_mode\").empty()) {
        set_bool(\"stealth_mode\", false);
    }"
    REPLACE "#ifdef __EMSCRIPTEN__
    set_bool(\"stealth_mode\", true); // the browser build talks to no maker's cloud
#else
    if (get(\"stealth_mode\").empty()) {
        set_bool(\"stealth_mode\", false);
    }
#endif // __EMSCRIPTEN__")
# The setup wizard: its filament page (resources/web/guide/22/22.js) shows Finish only when the network plug-in counts
# as installed ("1"), otherwise Next on to the Bambu network plug-in page. Creality Print never loads that plug-in
# (GUI_App::on_init_network returns first) and a tab cannot install one: the page is told "1", so the wizard ends after
# the filaments. Its messages are parsed as UTF-8 (wx 3.3, as the other web pages below).
orca_gui_patch(libslic3r_gui slic3r/GUI/WebGuideDialog.cpp
    FIND "        m_ProfileJson[\"network_plugin_install\"] = wxGetApp().app_config->get(\"app\",\"installed_networking\");"
    REPLACE "#ifdef __EMSCRIPTEN__
        m_ProfileJson[\"network_plugin_install\"] = \"1\"; // no network plug-in in the browser build: nothing to install
#else
        m_ProfileJson[\"network_plugin_install\"] = wxGetApp().app_config->get(\"app\",\"installed_networking\");
#endif // __EMSCRIPTEN__"
    FIND "        json     j        = json::parse(strInput);"
    REPLACE "        json     j        = json::parse(strInput.utf8_string());")
# Resources: Orca's resources/ preloaded at /orca/resources (see start-up.js; with a start list the package fetches
# each file when first read). resources/web is in the program's files too: dialogs check a page exists before
# loading it (WipingDialog: "Flushing volumes" stayed blank without it), as Bambu Studio's list has it.
# Printer error pictures (resources/hms, 79 MB) stay out until Orca reads them one at a time (Bambu's hms block).
# FORCE: an older list kept in a build folder's CMakeCache.txt would win over this one.
set(ORCA_RESOURCES_PRELOAD images shaders fonts info printers data flush calib tooltip handy_models
    profiles_template shapes custom_gcodes dailytip cert web creality_models filament_mixing "profiles" CACHE STRING "resources/ folders preloaded" FORCE)
# Creality's shader list dropped Orca's SLIC3R_OPENGL_ES branch: it picks 140/ or 110/ by the GL version, and WebGL2 (ES 3.0)
# compiles neither ("'110' : client/version number not supported"), so init_gl's error box opened inside the main
# window's constructor. The browser build reads the ES copies below, as Orca's list does.
orca_gui_patch(libslic3r_gui slic3r/GUI/GLShadersManager.cpp
    FIND "    const std::string prefix = gl31 ? \"140/\" : \"110/\";"
    REPLACE "#if SLIC3R_OPENGL_ES
    const std::string prefix = \"ES/\";
#else
    const std::string prefix = gl31 ? \"140/\" : \"110/\";
#endif // SLIC3R_OPENGL_ES")
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
    # Creality's fragment shaders went back to GLSL 1.40's compatibility gl_FragColor (Orca's declare their output):
    # ES 3.00 has none, so it becomes a declared output, as the wireframe pair below.
    if (n MATCHES "\\.fs$" AND text MATCHES "gl_FragColor")
        string(REPLACE "gl_FragColor" "out_color" text "${text}")
        string(REPLACE "precision highp int;" "precision highp int;\nout vec4 out_color;" text "${text}")
    endif ()
    # "sample" is a reserved word in GLSL ES 3.00 (gaussian_blur33, silhouette_composite name a variable so)
    string(REGEX REPLACE "([^A-Za-z0-9_])sample([^A-Za-z0-9_])" "\\1b3d_sample\\2" text "${text}")
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
set(_preload "SHELL:--preload-file ${_es}@/creality/resources/shaders/ES")
# the system font, Noto Sans (shared/fonts, OFL; js/app-fonts.js, edits/n-system-font.py)
list(APPEND _preload "SHELL:--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/../shared/fonts@/wx-fonts")
# The certificate store the program's own HTTPS checks against (Debian's Mozilla bundle), at OpenSSL's own default
# file (OPENSSLDIR/cert.pem, as a distro's OpenSSL has it); libcurl falls back to it (CA_FALLBACK, as the desktop deps).
list(APPEND _preload "SHELL:--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/ca-certificates.crt@/w/ow/prefix-mt/ssl/cert.pem")
foreach (r IN LISTS ORCA_RESOURCES_PRELOAD)
    if (EXISTS "${ORCA_SRC}/resources/${r}")
        list(APPEND _preload "SHELL:--preload-file ${ORCA_SRC}/resources/${r}@/creality/resources/${r}")   # SHELL: keeps CMake from merging repeated flags
    endif ()
endforeach ()
# the vendor presets bundle (off-thread write-presets-bundle.py): one file the worker serves the preset files from
list(APPEND _preload "SHELL:--preload-file ${ORCA_SRC}/resources/b3d-bundle@/creality/resources/b3d-bundle")
# Translations: Orca's source keeps only the texts (localization/i18n/<lang>/CrealityPrint_<lang>.po); the desktop build
# compiles each into resources/i18n/<lang>/CrealityPrint.mo (its gettext_po_to_mo target, CMakeLists.txt). Same msgfmt
# call here, at configure time, preloaded where the program looks (resources/i18n). Without them every language is English.
find_program(MSGFMT msgfmt REQUIRED)
set(_i18n "${CMAKE_BINARY_DIR}/i18n")
file(GLOB _po_files "${ORCA_SRC}/localization/i18n/*/CrealityPrint_*.po")
if (NOT _po_files)
    message(FATAL_ERROR "no ${ORCA_SRC}/localization/i18n/*/CrealityPrint_*.po")
endif ()
foreach (po IN LISTS _po_files)
    get_filename_component(_dir "${po}" DIRECTORY)
    get_filename_component(_lang "${_dir}" NAME)
    file(MAKE_DIRECTORY "${_i18n}/${_lang}")
    execute_process(COMMAND "${MSGFMT}" --check-format -o "${_i18n}/${_lang}/CrealityPrint.mo" "${po}" RESULT_VARIABLE _rc)
    if (NOT _rc EQUAL 0)
        message(FATAL_ERROR "msgfmt failed on ${po}")
    endif ()
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${po}")
endforeach ()
list(APPEND _preload "SHELL:--preload-file ${_i18n}@/creality/resources/i18n")
# The allocator and thread settings are the engine's program (engine/cmake/Engine.cmake, ENGINE_THREADED):
# tbb::scalable_allocator = malloc (no tbbmalloc in the mt deps), mimalloc. Threads: unlike the engine (TBB alone in its
# worker), Orca runs its own threads beside TBB's hardwareConcurrency-1 workers; a strict pool made TBB's pthread_create fail
# (EAGAIN -> handle_perror throws inside the noexcept private_worker::run -> terminate). Pool hc+16, grows on demand like the desktop.
# The program sees min(cores, 8) cores everywhere (shared/js/tab-cores.js, replaces slice-threads.cpp: its TBB cap
# froze the first Slice on computers with more than 8 cores); the pool keeps spare loaded workers (shared/js/pthread-spares.js).
add_executable(orca_app EXCLUDE_FROM_ALL "${ORCA_SRC}/src/CrealityPrint.cpp" "${ORCA_SRC}/src/CrealityrintDump.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/gl_compat.c" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_console_log.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_debug.cpp"
    "${ENGINE_SRC}/allocator/scalable_malloc.c" "${ENGINE_SRC}/allocator/mimalloc_options.c")
set_source_files_properties("${ENGINE_SRC}/allocator/mimalloc_options.c" PROPERTIES
    INCLUDE_DIRECTORIES "${EMSCRIPTEN_ROOT_PATH}/system/lib/mimalloc/include")
# The program is named after the slicer: orcaslicer.html/.js/.wasm/.data (the page itself is served as index.html by the package)
set_target_properties(orca_app PROPERTIES OUTPUT_NAME "crealityprint" SUFFIX ".html")
# unix/fhs.hpp, as Orca's top-level CMakeLists makes it: SLIC3R_FHS off = the tarball layout (resources beside bin/).
configure_file("${ORCA_SRC}/src/platform/unix/fhs.hpp.in" "${CMAKE_BINARY_DIR}/dev-utils/platform/unix/fhs.hpp")
target_include_directories(orca_app PRIVATE "${ORCA_SRC}/src" "${ORCA_SRC}/src/slic3r")
target_include_directories(orca_app SYSTEM PRIVATE "${CMAKE_BINARY_DIR}/dev-utils/platform")
# Creality's main() hands command-line runs to its CLI library (src/slic3r/CLI, desktop: libslic3r_cli), as on the desktop.
add_subdirectory("${ORCA_SRC}/src/slic3r/CLI" slic3r_cli EXCLUDE_FROM_ALL)
target_link_libraries(orca_app PRIVATE libslic3r_cli libslic3r_gui libslic3r cereal::cereal)
target_link_options(orca_app PRIVATE
    # main() runs in a worker (PROXY_TO_PTHREAD): the page thread only composites, forwards input and answers the
    # program's proxied page calls (shared/js/page-bridge.js and page-bridge-web.js are js-libraries of those; page-extras.js is
    # the page's own pre-js). The windows' canvases are transferred to that worker (OFFSCREENCANVAS_SUPPORT; $GL so the
    # GL library is linked for the transfer). The pool is one bigger: the main pthread itself takes a worker.
    -sJSPI -sPROXY_TO_PTHREAD -sOFFSCREENCANVAS_SUPPORT "-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=$GL"
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sINITIAL_MEMORY=256MB -sSTACK_SIZE=16MB -sMALLOC=mimalloc
    "-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency,8)+17" -sPTHREAD_POOL_SIZE_STRICT=0 -sDEFAULT_PTHREAD_STACK_SIZE=8MB
    --emit-symbol-map -Wl,--error-limit=0 -Wl,--wrap=__cxa_throw
    -sGL_ENABLE_GET_PROC_ADDRESS=1 -sUSE_WEBGL2=1 -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2 -sFULL_ES3=1
    -sEXPORTED_RUNTIME_METHODS=HEAP8,HEAPU8,HEAP32,HEAPF32,HEAPF64,FS,stringToNewUTF8 -sFORCE_FILESYSTEM=1
    "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge-web.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/presets-bundle-reader.js" "SHELL:--pre-js ${WX_SRC}/build/wasm/wx.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../wxwidgets-drawing/js/graphics-context.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/app-fonts.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/glew-context.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/tab-cores.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/gl-no-context.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/net-worker.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/pthread-spares.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/start-up.js"
    "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan-printer-link.js" 
    "-sEXPORTED_FUNCTIONS=_main,_b3d_lan_camera_frame,_b3d_lan_camera_size,_malloc,_free"
    "SHELL:--shell-file ${WX_SRC}/build/wasm/template.html" ${_preload})
# A changed --pre-js or page template relinks (CMake does not see them otherwise).
set_property(TARGET orca_app APPEND PROPERTY LINK_DEPENDS "${WX_SRC}/build/wasm/wx.js" "${CMAKE_CURRENT_SOURCE_DIR}/../wxwidgets-drawing/js/graphics-context.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/app-fonts.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/net-worker.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/glew-context.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/gl-no-context.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/pthread-spares.js" "${CMAKE_CURRENT_SOURCE_DIR}/start-up.js" "${CMAKE_CURRENT_SOURCE_DIR}/printer-link/lan-printer-link.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/tab-cores.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge-web.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/presets-bundle-reader.js" "${WX_SRC}/build/wasm/template.html")
