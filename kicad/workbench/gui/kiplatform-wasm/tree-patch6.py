import pathlib, sys
root = pathlib.Path(sys.argv[1])
def edit(rel, old, new):
    p = root / rel; s = p.read_text()
    if new in s: print("ok   ", rel); return
    assert old in s, (rel, old[:50]); p.write_text(s.replace(old, new, 1)); print("edit ", rel)
# Emscripten says __unix__ but has no X11/GLX; its GL canvas is WebGL
edit("common/kicad_gl/gl_utils.cpp", "#if ( defined( __unix__ ) and not defined( __APPLE__ ) )\n    #if wxHAS_EGL or wxHAS_GLX",
     "#if ( defined( __unix__ ) and not defined( __APPLE__ ) and not defined( __EMSCRIPTEN__ ) )\n    #if wxHAS_EGL or wxHAS_GLX")
edit("common/spacenav/libspnav_driver.h", "#if defined(__linux__) || defined(__FreeBSD__)\n#include <spnav.h>",
     "#if defined(__linux__) || defined(__FreeBSD__) || defined(__EMSCRIPTEN__)\n#include <spnav.h>")
print("TREE-PATCH6-OK")
