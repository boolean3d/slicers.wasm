# An event loop run on a thread other than wx's main one (KiCad's tool coroutines are threads in the browser build:
# a tool that shows a modal dialog runs a nested loop on its thread) waited for the next animation frame and yielded
# to the browser with EM_ASYNC_JS, which suspends that thread's own worker; the frames, the input and the page's
# messages all arrive in main's worker. Now on another thread the two waits sleep a few ms instead (main's worker keeps
# turning: it waits for the tool with Atomics.waitAsync, kicad-wasm spike/gui/stubs/libcontext_threads.cpp), and say
# so once in the console. Only the two definitions change (z15's loop text stays as it is). kicad-spike-4, 10-25. pwx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s or 'z35' in s: return   # already applied (marker: z50 rewrites part of b)
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/evtloop.cpp', '''EM_ASYNC_JS(void, wxWasmWaitFrame, (), {
    await wxWaitFrame();   // wx.js: a frame, or (experiment) input from the page
});

EM_ASYNC_JS(void, wxWasmYieldToBrowser, (), {
    await new Promise(resolve => setTimeout(resolve, 0));
});''', '''EM_ASYNC_JS(void, wxWasmWaitFrameJs, (), {
    await wxWaitFrame();   // wx.js: a frame, or (experiment) input from the page
});

EM_ASYNC_JS(void, wxWasmYieldToBrowserJs, (), {
    await new Promise(resolve => setTimeout(resolve, 0));
});

#include <emscripten/threading.h>   // z35
#include <emscripten/console.h>
#include "wx/thread.h"

// z35: a loop on another thread cannot await in its own worker (frames, input and page messages arrive in main's)
static bool wxWasmLoopOffMainThread()
{
    if (wxIsMainThread())
        return false;
    static bool said = false;
    if (!said)
    {
        said = true;
        emscripten_console_log("wx: an event loop runs on a thread other than main's (a tool's nested loop); it sleeps between passes");
    }
    return true;
}

static void wxWasmWaitFrame()
{
    if (wxWasmLoopOffMainThread())
        emscripten_thread_sleep(8);
    else
        wxWasmWaitFrameJs();
}

static void wxWasmYieldToBrowser()
{
    if (wxWasmLoopOffMainThread())
        emscripten_thread_sleep(1);
    else
        wxWasmYieldToBrowserJs();
}''')
print("z35 ok")
