# Included right after KiCad's project() (build-gui.sh: -DCMAKE_PROJECT_kicad_INCLUDE=this file): what the browser build adds
# to KiCad's own CMake (the tree's one commit, spike/patches/kicad-wasm.patch, reads the KICAD_WASM_* variables), and a deferred
# include of programs.cmake once KiCad's directories are all processed.
set(KICAD_WASM_MODULE_PATH "${SPIKE_GUI}/cmake-fake")        # find modules first in line (fake wx, OpenGL)
set(KICAD_WASM_PLATFORM_DIR "${SPIKE_GUI}/kiplatform-wasm")   # KiCad's platform layer for the wasm port
set(KICAD_SHARED_LIB_TYPE STATIC)                            # kicommon, gal, kiapi: one static program
list(APPEND CMAKE_PREFIX_PATH "${KDEPS}" "/w/prefix-occt" "/w/prefix-py" "${WX_PREFIX}")
list(APPEND CMAKE_FIND_ROOT_PATH "${KDEPS}" "/w/prefix-occt" "/w/prefix-py" "${WX_PREFIX}")
set(ENV{PKG_CONFIG_PATH} "${KDEPS}/lib/pkgconfig:/w/ow/prefix-mt/lib/pkgconfig:${SPIKE_GUI}/cmake-fake/pkgconfig")
link_directories("${KDEPS}/lib")                             # nanodbc's -lodbc
include_directories(SYSTEM "${KDEPS}/include" "/w/ow/prefix-mt/include")   # Boost.PtrContainer beside the slicers' Boost, and Boost itself for files that get it through other headers on a desktop
# KiCad calls OpenGL through glad (function pointers behind macros); the wasm wx GL canvas header brings GLES3/gl3.h, whose
# prototypes would clash with those macros. Without prototypes gl3.h gives types and constants only (glad gives the rest).
add_compile_definitions(GL_GLES_PROTOTYPES=0)
# ODBC's and Altium's unsigned-short strings ask std::char_traits for types libc++ 19+ no longer has: shims/char_traits_odbc.h
add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:SHELL:-include ${SPIKE_GUI}/shims/char_traits_odbc.h>")
add_compile_options(-Wno-c++11-narrowing -Wno-deprecated-declarations -Wno-unused-but-set-variable -Wno-missing-braces
    -Wno-format -Wno-overloaded-virtual -Wno-ignored-attributes -Wno-shadow -Wno-unused-command-line-argument)
add_compile_definitions(BOOST_STACKTRACE_USE_NOOP)
cmake_language(DEFER CALL include "${SPIKE_GUI}/programs.cmake")
