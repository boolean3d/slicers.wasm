import pathlib, sys
root = pathlib.Path(sys.argv[1])
p = root / "thirdparty/lemon/CMakeLists.txt"; s = p.read_text()
old = "add_executable( lemon\n    lemon.c\n    )"
new = "if( KICAD_WASM_HOST_LEMON )   # browser build: lemon runs at build time, so it is the host's program, not a wasm one\n    add_executable( lemon IMPORTED GLOBAL )\n    set_property( TARGET lemon PROPERTY IMPORTED_LOCATION ${KICAD_WASM_HOST_LEMON} )\nelse()\n    add_executable( lemon\n        lemon.c\n        )\nendif()"
if new not in s:
    assert old in s; p.write_text(s.replace(old, new, 1)); print("edit lemon")
print("TREE-PATCH3-OK")
