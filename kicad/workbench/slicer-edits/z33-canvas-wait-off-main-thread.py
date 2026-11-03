# A top-level window made on a thread other than wx's main one gets its canvas. The page posts a window's
# OffscreenCanvas to the worker of the thread that runs main(); wxWasmWaitCanvas (an EM_ASYNC_JS) waited in the
# calling thread's own worker, which never receives it (and whose windowMap is empty: the entry was made in main's
# worker, since EM_ASM from such a thread is carried out there - kicad-wasm spike/gui/stubs/libcontext_threads.cpp).
# KiCad's tools are coroutines = threads in the browser build and they rebuild toolbars (combo popups are top-level
# windows). Now: on another thread, ask main's worker until it has the canvas. kicad-spike-4, 10-25. Run in pwx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/nonownedwnd.cpp', '''    wxpage_create_window(m_cssId, m_isShown, static_cast<const char*>(classList.utf8_str()));
    wxWasmWaitCanvas(m_cssId);
''', '''    wxpage_create_window(m_cssId, m_isShown, static_cast<const char*>(classList.utf8_str()));
    // z33: on another thread the canvas message lands in main's worker, not here: ask that worker (EM_ASM from
    // another thread is carried out there) until it has the canvas
    if ( wxIsMainThread() )
        wxWasmWaitCanvas(m_cssId);
    else
        while ( !EM_ASM_INT({ var w = windowMap.get($0); return (w && w.canvas) ? 1 : 0; }, m_cssId) )
            emscripten_thread_sleep(1);
''')
sub('src/wasm/nonownedwnd.cpp', '''#include <emscripten.h>''', '''#include <emscripten.h>
#include <emscripten/threading.h>   // z33
#include "wx/thread.h"''')
print("z33 ok")
