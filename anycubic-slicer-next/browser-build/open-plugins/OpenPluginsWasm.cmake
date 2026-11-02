# Anycubic Slicer Next links Anycubic's open-plugins library (github.com/ANYCUBIC-3D/open-plugins, branch develop, Mulan PSL v2),
# which its desktop deps build install as the OpenPlugins package (deps/plugins/plugins.cmake). Its own CMake is written for
# desktop hosts (shared libraries, GTK/WebKit, wx's CMake package), so the browser build compiles the same sources per module,
# with the same definitions, as static libraries here, and names them OpenPlugins::<module> as the package does.
# The web view module (ACWebView, Anycubic's copy of wx 3.3's wxWebView) gets the port's browser backend (make-acwebview-wasm.py).
#
set(OP_SRC "/w/open-plugins" CACHE PATH "open-plugins source (develop)")
set(OP_AC "${CMAKE_CURRENT_LIST_DIR}")
set(OP_GEN "${CMAKE_BINARY_DIR}/op-gen")
file(MAKE_DIRECTORY "${OP_GEN}")
# the export headers upstream's generate_export_header writes beside each module: static libraries, nothing to export
foreach (h "easy_log/easy_log_export.hxx:LOG_API" "plugins_base/plugins_base_export.hxx:PLGINS_EXPORT"
           "plugins_sdk/event/event_sdk_export.hxx:EVENT_API" "WebView/include/ACWebView_export.h:ACWEBVIEW_API")
    string(REPLACE ":" ";" _p "${h}")
    list(GET _p 0 _f)
    list(GET _p 1 _m)
    if (NOT EXISTS "${OP_SRC}/${_f}")
        file(WRITE "${OP_SRC}/${_f}" "#pragma once\n#define ${_m}\n#define ${_m}_NO_EXPORT\n#define DATA_WEBVIEW(t) t\n")
    endif ()
endforeach ()
# ACWebView's setup.h (WebView/CMakeLists.txt configures it into its include folder): no desktop backend in a tab
set(USE_WEBVIEW_EDGE 0)
set(USE_WEBVIEW_WEBKIT 0)
set(USE_WEBVIEW_CHROMIUM 0)
set(USE_WEBVIEW_WEBKIT2 0)
configure_file("${OP_SRC}/WebView/include/setup.h.in" "${OP_SRC}/WebView/include/setup.h")
# <webview/...> as the package installs it (include/webview = WebView/include)
file(MAKE_DIRECTORY "${OP_GEN}/inc")
file(CREATE_LINK "${OP_SRC}/WebView/include" "${OP_GEN}/inc/webview" SYMBOLIC)
# build_info.h (cmake/build.cmake generate_build_header)
file(WRITE "${OP_GEN}/build_info.h" "#pragma once\n#define GIT_COMMIT_HAST \"e3bdacc\"\n#define GIT_BRANCHE \"develop\"\n#define BUILD_TIME \"\"\n")
# plugins_manager's built-in plugin list: none (Anycubic's own plugins are compiled into the program, Anycubic/plugins)
file(WRITE "${OP_GEN}/plugins_list.h" "#define PLUGINS_LIST (NONE)\n")

add_library(op_headers INTERFACE)
target_include_directories(op_headers INTERFACE "${OP_SRC}" "${OP_SRC}/3rdparty" "${OP_GEN}/inc" "${OP_GEN}")
target_compile_definitions(op_headers INTERFACE FMT_HEADER_ONLY=1 SPDLOG_HEADER_ONLY=1 SPDLOG_FMT_EXTERNAL=1)
target_link_libraries(op_headers INTERFACE Boost::boost)

macro(op_module name)
    cmake_parse_arguments(OPM "" "" "GLOB;DEFS;LINK" ${ARGN})
    set(_s)
    foreach (g IN LISTS OPM_GLOB)
        file(GLOB_RECURSE _g "${OP_SRC}/${g}")
        list(APPEND _s ${_g})
    endforeach ()
    add_library(op_${name} STATIC ${_s})
    target_compile_features(op_${name} PRIVATE cxx_std_20)
    target_compile_definitions(op_${name} PRIVATE ${name}_EXPORTS ${OPM_DEFS})
    # open-plugins is built on its own on the desktop, without Orca's wxNO_UNSAFE_WXSTRING_CONV (this tree sets it for
    # every target): its sources pass wxString where const char* is taken (wxString::FromUTF8(xrcName)).
    target_compile_options(op_${name} PRIVATE -UwxNO_UNSAFE_WXSTRING_CONV)
    target_link_libraries(op_${name} PUBLIC op_headers ${OPM_LINK})
    add_library(OpenPlugins::${name} ALIAS op_${name})
endmacro()

op_module(easy_log GLOB "easy_log/*.cpp" LINK Boost::nowide)
op_module(utility GLOB "utility/*.cpp" DEFS BOOST_ALL_NO_LIB LINK OpenSSL::SSL OpenSSL::Crypto)
target_include_directories(op_utility PRIVATE "${OP_SRC}/utility")
op_module(plugins_base GLOB "plugins_base/*.cpp" DEFS MODULE_NAME="plugins_base" DENABLE_STRACE=1)
target_include_directories(op_plugins_base PRIVATE "${OP_SRC}/plugins_base")
op_module(constant GLOB "plugins_sdk/constant/*.cpp")
op_module(event_sdk GLOB "plugins_sdk/event/*.cpp" DEFS EVENT_SDK_BUILD wxDEBUG_LEVEL=0 MODULE_NAME="" ENABLE_STRACE=1)
op_module(ACWebView GLOB "WebView/src/common/*.cpp" DEFS DEVTOOL_ENALBED="ACN_DEVTOOL_ENABLED" ACWebView_EXPORTS=1)
list(FILTER _s EXCLUDE REGEX "webview_chromium\\.cpp$")
set_property(TARGET op_ACWebView PROPERTY SOURCES ${_s} "${OP_AC}/acwebview/webview_wasm_ac.cpp")
target_include_directories(op_ACWebView PUBLIC "${OP_SRC}/WebView/include" PRIVATE "${OP_AC}/acwebview")
target_compile_definitions(op_ACWebView PUBLIC USE_WEBVIEW=1 wxDEBUG_LEVEL=0)
op_module(plugins_manager GLOB "plugins_manager/*.cpp" DEFS MODULE_NAME="plugins_manager" PLUGINS=1 ENABLE_STRACE=1 wxDEBUG_LEVEL=0
    AES_PASSWORD="anycubic.com" FILE_SIGN="anycubic.com" PLUGINS_LIST_SIZE=0 LINK op_ACWebView op_easy_log)
target_include_directories(op_plugins_manager PRIVATE "${OP_SRC}/plugins_manager")
# what Anycubic's cmake asks the package for (Anycubic.cmake find_package(OpenPlugins CONFIG ... COMPONENTS ...)): found
set(OpenPlugins_DIR "${OP_AC}/package" CACHE PATH "" FORCE)
