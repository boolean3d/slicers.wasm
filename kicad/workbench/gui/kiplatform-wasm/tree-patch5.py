import pathlib, sys
root = pathlib.Path(sys.argv[1])
def edit(rel, old, new):
    p = root / rel; s = p.read_text()
    if new in s: print("ok   ", rel); return
    assert old in s, (rel, old[:50]); p.write_text(s.replace(old, new, 1)); print("edit ", rel)
# thread priorities: the thread-pool library's native extensions know Windows, Linux and macOS; a browser thread has no priority to set
edit("thirdparty/thread-pool/CMakeLists.txt", "target_compile_definitions( thread-pool INTERFACE BS_THREAD_POOL_NATIVE_EXTENSIONS=1 )",
     "if( NOT EMSCRIPTEN )   # browser build: no thread priorities\n    target_compile_definitions( thread-pool INTERFACE BS_THREAD_POOL_NATIVE_EXTENSIONS=1 )\nendif()")
edit("common/singleton.cpp", "                                                     // Reduce worker threadpriority to reduce lag in main (UI) thread\n                                                     BS::this_thread::set_os_thread_priority(\n                                                             BS::os_thread_priority::below_normal );",
     "#ifdef BS_THREAD_POOL_NATIVE_EXTENSIONS\n                                                     // Reduce worker threadpriority to reduce lag in main (UI) thread\n                                                     BS::this_thread::set_os_thread_priority(\n                                                             BS::os_thread_priority::below_normal );\n#endif")
# an include a desktop build gets through its toolkit headers
edit("common/dialogs/dialog_rc_job.cpp", "#include <dialogs/dialog_rc_job.h>\n", "#include <dialogs/dialog_rc_job.h>\n#include <wx/filename.h>\n")
print("TREE-PATCH5-OK")
