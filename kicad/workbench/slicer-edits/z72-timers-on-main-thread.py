# A timer started on another thread still fires (z72. wxWasmTimerImpl schedules its callback with)
# emscripten_async_call, a setTimeout in the CALLING thread's worker. A program that runs an event loop on another
# thread (KiCad: tools are coroutines on their own threads, and a dialog a tool opens runs its modal loop there; the loop
# sleeps between passes, evtloop.cpp z35) never lets that worker's JavaScript turn, so the setTimeout never ran: KiCad's
# symbol chooser filter (LIB_TREE's 200 ms debounce timer, started from the tool's thread) never refiltered.
# The callback only queues the timer's run (wxWasmQueueInput); whichever loop dispatches input runs it, as before. So the
# setTimeout is placed in the wx main thread's worker, whose JavaScript always turns (it waits with JSPI), by proxying the
# scheduling call there when the timer starts off the main thread. On the main thread nothing changes. Only lines are added.
import sys
p = 'src/wasm/timer.cpp'
s = open(p).read()
if '(z72)' in s:
    sys.exit(0)
a_inc = '#include <emscripten.h>\n'
a_fn = ('void wxWasmTimerImpl::ScheduleTimerCallback(int millisecs, TimerCallbackFunc *callbackFunc)\n{\n'
        '    emscripten_async_call(TimerCallback, callbackFunc, millisecs);\n}\n')
if s.count(a_inc) != 1 or s.count(a_fn) != 1:
    print('z72: anchors not found once in', p, ', skipped'); sys.exit(0)
s = s.replace(a_inc, a_inc + '''#include <emscripten/proxying.h>   // (z72)
#include <pthread.h>
#include "wx/thread.h"
''', 1)
s = s.replace(a_fn, '''// (z72) a timer started on another thread is scheduled in the main thread's worker: the starting thread's
// JavaScript may never turn (an event loop running there sleeps between passes), so its setTimeout would never fire
namespace
{
    struct wxWasmTimerSchedule { int millisecs; TimerCallbackFunc *callbackFunc; };

    void wxWasmScheduleOnMain(void *arg)
    {
        wxWasmTimerSchedule *t = static_cast<wxWasmTimerSchedule *>(arg);
        emscripten_async_call(TimerCallback, t->callbackFunc, t->millisecs);
        delete t;
    }
}

void wxWasmTimerImpl::ScheduleTimerCallback(int millisecs, TimerCallbackFunc *callbackFunc)
{
#if wxUSE_THREADS
    if (!wxIsMainThread())
    {
        wxWasmTimerSchedule *t = new wxWasmTimerSchedule{millisecs, callbackFunc};
        if (emscripten_proxy_async(emscripten_proxy_get_system_queue(), (pthread_t)wxThread::GetMainId(),
                                   wxWasmScheduleOnMain, t))
            return;
        delete t;
    }
#endif
    emscripten_async_call(TimerCallback, callbackFunc, millisecs);
}
''', 1)
open(p, 'w').write(s)
print('z72: timers scheduled on the main thread')
