# tree-patch8: the last six compile/link errors of the wasm build (KiCad 10.0.7). Run on the KiCad tree: python3 tree-patch8.py /w/kicad
import pathlib, sys
root = pathlib.Path(sys.argv[1])
def edit(rel, old, new):
    p = root / rel; s = p.read_text()
    if new in s: print("ok   ", rel); return
    assert old in s, (rel, old[:50]); p.write_text(s.replace(old, new, 1)); print("edit ", rel)
# 1. KiCad's verbatim copy of wx's private wxGetContentRect clashes with wx core's own in a static link (a shared wx hides it)
edit("common/widgets/grid_checkbox.cpp", "\nwxRect\nwxGetContentRect(wxSize contentSize,", "\nstatic wxRect\nwxGetContentRect(wxSize contentSize,")
# 2. thread names are a BS::thread_pool native extension (same guard as common/singleton.cpp)
for rel, name in (("eeschema/sch_io/database/sch_io_database.cpp", "dblib bg"), ("eeschema/sch_io/http_lib/sch_io_http_lib.cpp", "httplib bg")):
    edit(rel, '    BS::this_thread::set_os_thread_name( "%s" );\n' % name,
         '#ifdef BS_THREAD_POOL_NATIVE_EXTENSIONS\n    BS::this_thread::set_os_thread_name( "%s" );\n#endif\n' % name)
# 3. wxUniv's wxChoice is a wxComboBox: IsEmpty() is both the list's and the text's; ask the list
edit("eeschema/dialogs/dialog_sim_command.cpp", "if( !aSource->IsEmpty() && aSource->GetSelection() >= 0 )",
     "if( aSource->GetCount() > 0 && aSource->GetSelection() >= 0 )")
# 4. a missing include (other ports get it through their headers)
edit("pcbnew/dialogs/dialog_board_stats_job.cpp", "#include <wildcards_and_files_ext.h>\n", "#include <wildcards_and_files_ext.h>\n#include <wx/filename.h>\n")
print("TREE-PATCH8-OK")
