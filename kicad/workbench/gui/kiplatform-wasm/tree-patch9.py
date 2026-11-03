# tree-patch9: the 3D scene-graph library (kicad_3dsg) is SHARED upstream; a wasm page cannot load it (the browser asked for
# libkicad_3dsg.so.2.0.0 and pcbnew never started). Same switch as kicommon/gal/kiapi: KICAD_SHARED_LIB_TYPE when given.
import pathlib, sys, re
root = pathlib.Path(sys.argv[1])
p = root / "3d-viewer/3d_cache/sg/CMakeLists.txt"; s = p.read_text()
if "KICAD_SHARED_LIB_TYPE" in s: print("ok   ", p)
else:
    n = len(re.findall(r"add_library\(\s*kicad_3dsg\s+SHARED", s)); assert n == 1, n
    s = re.sub(r"add_library\(\s*kicad_3dsg\s+SHARED", "add_library( kicad_3dsg ${KICAD_3DSG_LIB_TYPE}", s)
    s = s.replace("add_library( kicad_3dsg", 'if( NOT KICAD_SHARED_LIB_TYPE )\n    set( KICAD_3DSG_LIB_TYPE SHARED )\nelse()\n    set( KICAD_3DSG_LIB_TYPE ${KICAD_SHARED_LIB_TYPE} )\nendif()\nadd_library( kicad_3dsg', 1)
    p.write_text(s); print("edit ", p)
print("TREE-PATCH9-OK")
