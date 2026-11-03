import pathlib, sys
root = pathlib.Path(sys.argv[1])
def edit(rel, old, new):
    p = root / rel; s = p.read_text()
    if new in s: print("ok   ", rel); return
    assert old in s, (rel, old[:50]); p.write_text(s.replace(old, new, 1)); print("edit ", rel)
s = (root / "include/dialogs/dialog_book_reporter.h").read_text()
inc = [l for l in s.splitlines() if l.startswith('#include')][0]
edit("include/dialogs/dialog_book_reporter.h", inc + "\n", inc + "\n#include <wx/panel.h>\n")
print("TREE-PATCH7-OK")
