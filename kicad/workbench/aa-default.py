#!/usr/bin/env python3
# aa-default.py <kicad tree>: the browser build's 3D viewer starts with anti-aliasing None instead
# of 8x. The wx port now honours the canvas's multisampling request, and resolving a 3840x1984 MSAA buffer costs an Intel
# laptop chip ~10 ms a frame: the view rotated at 7-12 frames a second with it and 14-18 without (Anvil). The preference
# (Preferences > 3D Viewer > OpenGL > Anti-aliasing) still works; a saved setting is kept. Desktop build unchanged. Rerun-safe.
import sys, pathlib
root = pathlib.Path(sys.argv[1]); MARK = 'kicad-play-11 aa-default'
p = root / '3d-viewer/3d_viewer/eda_3d_viewer_settings.cpp'; s = p.read_text()
if MARK in s:
    print('already'); sys.exit(0)
a = """    m_params.emplace_back( new PARAM_ENUM<ANTIALIASING_MODE>( "render.opengl_AA_mode",
                                                              &m_Render.opengl_AA_mode,
                                                              ANTIALIASING_MODE::AA_8X,
"""
b = """#ifdef __EMSCRIPTEN__
    // """ + MARK + """: None by default in a browser tab (a laptop chip cannot resolve a 4K multisampled buffer at 60 Hz)
    constexpr ANTIALIASING_MODE defaultAA = ANTIALIASING_MODE::AA_NONE;
#else
    constexpr ANTIALIASING_MODE defaultAA = ANTIALIASING_MODE::AA_8X;
#endif

    m_params.emplace_back( new PARAM_ENUM<ANTIALIASING_MODE>( "render.opengl_AA_mode",
                                                              &m_Render.opengl_AA_mode,
                                                              defaultAA,
"""
assert s.count(a) == 1, s.count(a); s = s.replace(a, b)
p.write_text(s); print('patched')
