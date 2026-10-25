# PrusaSlicer 2.9.6's own GUI compiled to WebAssembly over the wasm wx port (wx 3.2.6, /w/pwx -> /w/prefix-wx).
# Same method as the OrcaSlicer / Bambu Studio browser builds: PrusaSlicer's
# checkout is never modified. Its own top-level CMakeLists builds everything (libslic3r, the GUI, the program);
# this wrapper only supplies what a desktop toolchain would (find modules, a fake pkg-config for the Linux-only
# packages), swaps a few sources for patched copies (cmake/PatchedCopies.cmake) and adds the browser link.
# Configure (in b3d-emsdk:6.0.10, /w = the work dir):
#   emcmake cmake -S /w/browser-port/browser-build -B /w/pgui -G Ninja -C /w/ow/prefix-mt/share/orcawasm/initial-cache.cmake
cmake_minimum_required(VERSION 3.24)
project(prusa_gui_wasm C CXX)

set(ORCA_SRC "/w/prusa" CACHE PATH "PrusaSlicer 2.9.6 source")   # the patch helper's name for the source tree
set(WX_PREFIX "/w/prefix-wx" CACHE PATH "wasm wx prefix")
set(WX_SRC "/w/pwx" CACHE PATH "wasm wx source (its build/wasm page template and wx.js)")

# PrusaSlicer's options: a static GUI build on its OpenGL ES path (shaders/ES, the ES G-code viewer); no tests, no
# desktop integration. STEP import: on once the wasm OCCT is built (browser-port/browser-build/build-occt-prusaslicer.sh -> /w/prefix-occt);
# its OCCTWrapper is then linked in, as PrusaSlicer's macOS build does (prusaslicer-source-edits.cmake, STEP.cpp).
set(SLIC3R_STATIC ON CACHE BOOL "" FORCE)
set(SLIC3R_GUI ON CACHE BOOL "" FORCE)
set(SLIC3R_OPENGL_ES ON CACHE BOOL "" FORCE)
set(SLIC3R_PCH OFF CACHE BOOL "" FORCE)
set(SLIC3R_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(SLIC3R_BUILD_SANDBOXES OFF CACHE BOOL "" FORCE)
set(SLIC3R_ENC_CHECK OFF CACHE BOOL "" FORCE)        # a host tool; built as wasm it cannot run
set(B3D_OCCT_PREFIX "/w/prefix-occt")
if (EXISTS "${B3D_OCCT_PREFIX}/lib/cmake/opencascade/OpenCASCADEConfig.cmake")
    set(SLIC3R_ENABLE_FORMAT_STEP ON CACHE BOOL "" FORCE)
    list(APPEND CMAKE_PREFIX_PATH "${B3D_OCCT_PREFIX}")
    list(APPEND CMAKE_FIND_ROOT_PATH "${B3D_OCCT_PREFIX}")
else ()
    set(SLIC3R_ENABLE_FORMAT_STEP OFF CACHE BOOL "" FORCE)
endif ()
set(SLIC3R_DESKTOP_INTEGRATION OFF CACHE BOOL "" FORCE)
set(SLIC3R_GTK 3 CACHE STRING "" FORCE)

# Find modules first in line (PrusaSlicer appends its own cmake/modules after these):
#  FindwxWidgets: the wasm wx prefix's libraries (wx-config does not know the port's gl/webview libraries)
#  FindGTK3, FindOpenGL, FindGLEW: nothing to link; WebGL2 + Emscripten's GLEW come from the link options
list(PREPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake-find-files" "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
# PrusaSlicer's Linux-only pkg-config packages: hidapi-hidraw is the "no device" stub (build-prusaslicer-libraries.sh);
# webkit2gtk is the wasm web view, inside wx (cmake-find-files/pkgconfig/webkit2gtk-4.1.pc is empty)
# PKG_CONFIG_PATH, not _LIBDIR: Emscripten's toolchain file resets PKG_CONFIG_LIBDIR on every project() (PrusaSlicer's own)
set(ENV{PKG_CONFIG_PATH} "/w/ow/prefix-mt/lib/pkgconfig:${CMAKE_CURRENT_SOURCE_DIR}/cmake-find-files/pkgconfig")
# Libraries PrusaSlicer's Linux branches name directly (X11/Wayland/EGL for wx's GTK, fontconfig): none here
foreach (l X11 wayland-client wayland-egl EGL fontconfig)
    add_library(${l} INTERFACE IMPORTED GLOBAL)
endforeach ()

add_compile_options(-Wno-c++11-narrowing -Wno-deprecated-declarations -Wno-unused-but-set-variable
    -Wno-missing-braces -Wno-format -Wno-overloaded-virtual -Wno-ignored-attributes)
add_compile_definitions(CGAL_ALWAYS_ROUND_TO_NEAREST BOOST_STACKTRACE_USE_NOOP)
# STEP: PrusaSlicer's occt_wrapper/CMakeLists.txt builds the wrapper STATIC only on APPLE (MODULE elsewhere): take that branch
set(CMAKE_PROJECT_OCCTWrapper_INCLUDE "${CMAKE_CURRENT_SOURCE_DIR}/cmake/occtwrapper-static.cmake")
add_subdirectory("${ORCA_SRC}" prusa)
# STEP: the wrapper is a static library linked into the program, PrusaSlicer's macOS way (libslic3r/CMakeLists.txt
# "if (APPLE) target_link_libraries(libslic3r PUBLIC OCCTWrapper)"); the Linux way dlopens OCCTWrapper.so
if (SLIC3R_ENABLE_FORMAT_STEP)
    target_link_libraries(libslic3r PUBLIC OCCTWrapper)
endif ()

# GUI sources: what the desktop toolchains supply and Emscripten's does not (see the file)
foreach (t libslic3r_gui PrusaSlicer)
    target_compile_options(${t} PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:SHELL:-include ${CMAKE_CURRENT_SOURCE_DIR}/stand-in-headers-gui/prusa_wasm_platform.h>")
endforeach ()

include(PatchedCopies)
include("${CMAKE_CURRENT_SOURCE_DIR}/prusaslicer-source-edits.cmake")
# The 3D view at display scaling: the GTK3 scaled-GL path (shared/cmake/RetinaGl.cmake), as Bambu/Orca.
include("${CMAKE_CURRENT_SOURCE_DIR}/../shared/cmake/RetinaGl.cmake")
slicer_retina_gl_patch(libslic3r_gui)

# --- the program: PrusaSlicer's own src/PrusaSlicer.cpp (CLI + GUI entry) ---------------------------------
# Laid out in the tab as on Linux: /prusa/bin/prusa-slicer, resources at /prusa/resources (start-up.js).
set(PRUSA_RESOURCES_PRELOAD icons profiles fonts shapes data web "localization/en"
    CACHE STRING "resources/ folders preloaded")
# Shaders: PrusaSlicer's own ES set (GLSL ES 1.00, WebGL2 runs those as they are). Three of them (wireframe,
# variable_layer_height, mm_gouraud) take fwidth/dFdx/dFdy through GL_OES_standard_derivatives, which WebGL2 does not
# offer to 1.00 shaders (derivatives are core in ES 3.00): those pairs are lifted to "#version 300 es" the way the
# Orca spike lifted Prusa's wireframe: attribute/varying -> in/out, texture2D -> texture, gl_FragColor -> a declared
# output. Same code otherwise.
set(_es "${CMAKE_BINARY_DIR}/shaders-ES")
file(REMOVE_RECURSE "${_es}")
file(COPY "${ORCA_SRC}/resources/shaders/ES/" DESTINATION "${_es}")
foreach (n wireframe variable_layer_height mm_gouraud)
    foreach (ext vs fs)
        set(f "${ORCA_SRC}/resources/shaders/ES/${n}.${ext}")
        set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${f}")
        file(READ "${f}" text)
        string(REPLACE "#version 100\n#extension GL_OES_standard_derivatives : enable\n" "#version 300 es\n" text "${text}")
        string(REPLACE "#version 100\n" "#version 300 es\n" text "${text}")
        string(REGEX REPLACE "(^|\n)attribute " "\\1in " text "${text}")
        string(REPLACE "texture2D(" "texture(" text "${text}")
        if (ext STREQUAL "vs")
            string(REGEX REPLACE "(^|\n)varying " "\\1out " text "${text}")
        else ()
            string(REGEX REPLACE "(^|\n)varying " "\\1in " text "${text}")
            string(REPLACE "gl_FragColor" "out_color" text "${text}")
            string(REPLACE "void main()" "out vec4 out_color;\n\nvoid main()" text "${text}")
        endif ()
        if (NOT text MATCHES "^#version 300 es" OR text MATCHES "GL_OES_standard_derivatives")
            message(FATAL_ERROR "${n}.${ext}: not lifted to 300 es")
        endif ()
        file(WRITE "${_es}/${n}.${ext}" "${text}")
    endforeach ()
endforeach ()
set(_preload "SHELL:--preload-file ${_es}@/prusa/resources/shaders/ES")
# The certificate store the program's own HTTPS checks against (Debian's Mozilla bundle), at OpenSSL's own default
# file (OPENSSLDIR/cert.pem, as a distro's OpenSSL has it), so PrusaSlicer's start finds it without asking; its
# connections leave the tab through the page host's relay (../net, SHARED-WX-FIXES.md).
set(OPENSSL_DEFAULT_CERT_FILE "/w/ow/prefix-mt/ssl/cert.pem" CACHE STRING "OpenSSL's X509_get_default_cert_file() in this build")
list(APPEND _preload "SHELL:--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/ca-certificates.crt@${OPENSSL_DEFAULT_CERT_FILE}")
foreach (r IN LISTS PRUSA_RESOURCES_PRELOAD)
    if (EXISTS "${ORCA_SRC}/resources/${r}")
        list(APPEND _preload "SHELL:--preload-file ${ORCA_SRC}/resources/${r}@/prusa/resources/${r}")
    endif ()
endforeach ()
# The program is named after the slicer: prusaslicer.html/.js/.wasm/.data (the page itself is served as index.html by the package)
set_target_properties(PrusaSlicer PROPERTIES OUTPUT_NAME "prusaslicer" SUFFIX ".html" EXCLUDE_FROM_ALL ON)
target_sources(PrusaSlicer PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/gl_compat.c" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_console_log.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/web_debug.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/stand-ins/pthread_name.c")
# Threads come from a pool made at start-up (a worker cannot start one later). TBB takes the slicing threads
# less one (start-up.js: --threads = hardware threads, at most 8); the app's own threads come on top: +16 and a
# non-strict pool (SHARED-WX-FIXES.md, both spikes).
target_link_options(PrusaSlicer PRIVATE
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
    "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge.js" "SHELL:--js-library ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge-web.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js" "SHELL:--pre-js ${WX_SRC}/build/wasm/wx.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../wxwidgets-drawing/js/graphics-context.js"
    "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/start-up.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/net-worker.js"
    "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared-js-prusaslicer/gl-no-context.js" "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared-js-prusaslicer/pthread-spares.js"
    "-sEXPORTED_FUNCTIONS=_main,_malloc,_free"
    "SHELL:--shell-file ${WX_SRC}/build/wasm/template.html" ${_preload})
# the --pre-js files and the page template are link inputs the link line does not track: a change relinks
set_property(TARGET PrusaSlicer APPEND PROPERTY LINK_DEPENDS "${WX_SRC}/build/wasm/wx.js" "${CMAKE_CURRENT_SOURCE_DIR}/../wxwidgets-drawing/js/graphics-context.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/start-up.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/net/net-worker.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared-js-prusaslicer/gl-no-context.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared-js-prusaslicer/pthread-spares.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-bridge-web.js" "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js" "${WX_SRC}/build/wasm/template.html")
