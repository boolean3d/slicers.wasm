# The browser's own file dialogs (wx/wasm/filedlg.h, src/wasm/filedlg.cpp from spike/wxweb): wxFileDialog on the
# wasm port is no longer wx's generic browser of the in-memory disk. Save writes into a download folder and the
# browser downloads the file; Open is the browser's file picker. Run in owx.
def sub(p, a, b):
    s = open(p).read()
    if b in s: return
    assert s.count(a) == 1, (p, a)
    open(p, 'w').write(s.replace(a, b))

sub('include/wx/filedlg.h', '''#if defined (__WXUNIVERSAL__)
    #define wxHAS_GENERIC_FILEDIALOG''', '''#if defined(__WXWASM__)
    #include "wx/wasm/filedlg.h"
#elif defined (__WXUNIVERSAL__)
    #define wxHAS_GENERIC_FILEDIALOG''')
