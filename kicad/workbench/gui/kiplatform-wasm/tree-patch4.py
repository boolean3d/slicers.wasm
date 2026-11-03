import pathlib, sys
root = pathlib.Path(sys.argv[1])
p = root / "include/kiway.h"; s = p.read_text()
old = "#if defined(__linux__) || defined(__FreeBSD__)\n #define LIB_ENV_VAR    wxT( \"LD_LIBRARY_PATH\" )"
new = "#if defined(__linux__) || defined(__FreeBSD__) || defined(__EMSCRIPTEN__)\n #define LIB_ENV_VAR    wxT( \"LD_LIBRARY_PATH\" )"
if new not in s:
    assert old in s; p.write_text(s.replace(old, new, 1)); print("edit kiway.h")
print("TREE-PATCH4-OK")
