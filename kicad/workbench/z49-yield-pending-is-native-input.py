# z49: a selective yield (wxProgressDialog::Update -> YieldFor(UI), KiCad's DrainPendingEvents -> YieldFor(TIMER)) spun forever
# in the wasm port's DoYieldFor "while (Pending()) Dispatch();" whenever an event of another category was pending (a CallAfter
# posted by a worker thread): wx's ProcessPendingEvents moves such delayed handlers back into the pending list at its end
# (appbase.cpp "so the next call has the chance of processing them"), so the port's Pending(), which read that list, never
# cleared. KiCad's board load froze behind a black "Load PCB" box 1 time in 3 with a busy page; a slicer
# progress dialog can spin the same way on a thread event. In the desktop ports Pending() means the native queue (GTK:
# gtk_events_pending): here it is the port's input queue (timers, page input, web-view callbacks; user input left out while
# it is deferred). A yield still runs one full pass (input, pending events, paint, idle), and more only while native input
# waits. Run in pwx/owx. Rerun-safe; does nothing on a tree it does not fit.
import sys
MARK = 'z49'
def edit(path, pairs):
    s = open(path).read()
    if MARK in s:
        print(MARK, 'already in', path); return True
    for a, b in pairs:
        if s.count(a) != 1:
            print(MARK + ': ' + path + ' does not fit, skipped'); return False
    for a, b in pairs:
        s = s.replace(a, b)
    open(path, 'w').write(s); print(MARK, 'ok', path); return True

ok = edit('src/wasm/app.cpp', [(
'''void wxWasmQueueUserInput(std::function<void()> handler, bool press = false)
{
    s_inputQueue.emplace_back(press ? 2 : 1, std::move(handler));
}
''',
'''void wxWasmQueueUserInput(std::function<void()> handler, bool press = false)
{
    s_inputQueue.emplace_back(press ? 2 : 1, std::move(handler));
}

// z49: an input entry waits that wxWasmDispatchInput would run now (user input counts only while it is not deferred)
bool wxWasmInputPending()
{
    for (const auto& entry : s_inputQueue)
        if (s_deferUserInput <= 0 || entry.first == 0)
            return true;
    return false;
}
''')])
ok = edit('src/wasm/evtloop.cpp', [(
'''bool wxGUIEventLoop::Pending() const
{
    return wxTheApp && wxTheApp->HasPendingEvents();
}
''',
'''bool wxGUIEventLoop::Pending() const
{
    // z49: the native queue (the port's input entries), as in the desktop ports; wx's own pending events are processed by
    // Dispatch() and wxEventLoopBase::DoYieldFor(). HasPendingEvents() stays true during a selective yield (delayed handlers
    // go back into the list), which made "while (Pending()) Dispatch()" spin forever.
    return wxWasmInputPending();
}
'''), (
'''    while (Pending())
    {
        Dispatch();
    }
''',
'''    // z49: one full pass always (input, pending events, paint, idle), then more only while native input waits
    do
    {
        Dispatch();
    } while (Pending());
'''), (
'''bool wxWasmInPress();                   // app.cpp (z15)
''',
'''bool wxWasmInPress();                   // app.cpp (z15)
bool wxWasmInputPending();              // app.cpp (z49)
''')]) and ok
print(MARK, 'done' if ok else 'INCOMPLETE')
