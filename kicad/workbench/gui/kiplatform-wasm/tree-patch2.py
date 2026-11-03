import pathlib, sys
root = pathlib.Path(sys.argv[1])
def edit(rel, old, new):
    p = root / rel; s = p.read_text()
    if new in s: print("ok   ", rel); return
    assert old in s, (rel, old[:60]); p.write_text(s.replace(old, new, 1)); print("edit ", rel)
edit("thirdparty/libcontext/libcontext.h", "#if defined(__GNUC__) || defined(__APPLE__) || defined(__FreeBSD__)\n",
     "#if defined(__EMSCRIPTEN__)\n    // browser build: contexts are threads (spike/gui/stubs/libcontext_threads.cpp)\n    #define LIBCONTEXT_PLATFORM_wasm_threads\n    #define LIBCONTEXT_CALL_CONVENTION\n#elif defined(__GNUC__) || defined(__APPLE__) || defined(__FreeBSD__)\n")
edit("thirdparty/libcontext/CMakeLists.txt", "add_library( libcontext STATIC\n    ${LIBCONTEXT_SOURCES}\n    )",
     "if( KICAD_WASM_LIBCONTEXT )   # browser build: contexts as threads instead of the assembly\n    set( LIBCONTEXT_SOURCES ${KICAD_WASM_LIBCONTEXT} )\nendif()\n\nadd_library( libcontext STATIC\n    ${LIBCONTEXT_SOURCES}\n    )")
print("TREE-PATCH2-OK")
