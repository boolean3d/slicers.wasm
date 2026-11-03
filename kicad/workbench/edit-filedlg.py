# Orca's edit15 (browser file dialogs): wx/filedlg.h picks wx/wasm/filedlg.h on the wasm port. Run in pwx.
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
