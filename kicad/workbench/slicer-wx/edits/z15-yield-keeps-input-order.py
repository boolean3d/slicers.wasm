# A wxYield() run inside a mouse button press handler does not hand out the next mouse/key events: they wait for the
# press handler to finish, so every press is fully handled before its release. The port queues browser input and the
# yield's Dispatch emptied that queue re-entrantly: PrusaSlicer's search box (TopBar.cpp LEFT_DOWN -> TriggerSearch ->
# OptionsSearcher::show_dialog -> wxYield) got its LEFT_UP during the yield, BEFORE wxUniv's text handler took the
# mouse for that press (wxStdTextCtrlInputHandler LeftDown -> CaptureMouse), so the capture was never released: from
# then on every click anywhere went to the search box and reopened the search list.
# Native toolkits never deliver a control's release ahead of its press (GTK/Windows controls take their own implicit
# grab natively); the browser itself never runs input re-entrantly. Timers, web-view callbacks and resizes still run in
# a yield; a modal loop (ShowModal -> DoRun) started anywhere takes input as before; a yield in any other handler (a
# button's command runs on the release, a key's on the key down: progress dialogs with Cancel) takes input as before. A yield whose mask leaves out
# wxEVT_CATEGORY_USER_INPUT (wxSafeYield-style YieldFor) also defers input, as wx documents. Run in owx or pwx.
app = 'src/wasm/app.cpp'
s = open(app).read()
a = '''namespace
{
    std::deque<std::function<void()>> s_inputQueue;
}

void wxWasmQueueInput(std::function<void()> handler)
{
    s_inputQueue.push_back(std::move(handler));
}

void wxWasmDispatchInput()
{
    // A handler may run a nested loop that dispatches the rest of the queue.
    while (!s_inputQueue.empty())
    {
        std::function<void()> handler = std::move(s_inputQueue.front());
        s_inputQueue.pop_front();
        handler();
    }
}
'''
b = '''namespace
{
    // (0 other, 1 user input: mouse, keys, touch, wheel, page focus, 2 a button press; the handler)
    std::deque<std::pair<int, std::function<void()>>> s_inputQueue;
    int s_pressDepth = 0;        // button press handlers running now
    int s_deferUserInput = 0;    // > 0: a yield inside one of them; user input waits (z15)
}

// timers, web-view callbacks, page resizes
void wxWasmQueueInput(std::function<void()> handler)
{
    s_inputQueue.emplace_back(0, std::move(handler));
}

void wxWasmQueueUserInput(std::function<void()> handler, bool press = false)
{
    s_inputQueue.emplace_back(press ? 2 : 1, std::move(handler));
}

bool wxWasmInPress()
{
    return s_pressDepth > 0;
}

// set while a yield runs (evtloop.cpp DoYieldFor); a modal loop clears it for its own run (DoRun)
int wxWasmSetDeferUserInput(int defer)
{
    const int old = s_deferUserInput;
    s_deferUserInput = defer;
    return old;
}

void wxWasmDispatchInput()
{
    // A handler may run a nested loop that dispatches the rest of the queue, so the front is looked up again after
    // each one. User input waits, in order, while a yield inside a user input handler runs.
    for (;;)
    {
        auto it = s_inputQueue.begin();
        if (s_deferUserInput > 0)
            while (it != s_inputQueue.end() && it->first != 0)
                ++it;
        if (it == s_inputQueue.end())
            break;
        const bool press = it->first == 2;
        std::function<void()> handler = std::move(it->second);
        s_inputQueue.erase(it);
        if (press)
            ++s_pressDepth;
        handler();
        if (press)
            --s_pressDepth;
    }
}
'''
if 'int s_pressDepth = 0;' not in s:   # skip by marker: later edits (z20) change text inside b
    assert s.count(a) == 1, app
    s = s.replace(a, b)
    n = 0
    for cb in ('KeyCallbackNow(eventType, &copy, userData); });', 'wxWasmQueueInput([=]() {\n        MouseCallbackNow',
               'TouchCallbackNow(eventType, &copy, userData); });', 'WheelCallbackNow(eventType, &copy, userData); });',
               'FocusCallbackNow(eventType, &copy, userData); });'):
        if cb.startswith('wxWasmQueueInput'):
            assert s.count(cb) == 1, cb
            s = s.replace(cb, cb.replace('wxWasmQueueInput', 'wxWasmQueueUserInput'))
            # the mouse handler's lambda ends '    });\n    return true;' right after it: mark presses
            i = s.index('wxWasmQueueUserInput([=]() {\n        MouseCallbackNow'); j = s.index('    });\n    return true;', i)
            s = s[:j] + '    }, eventType == EMSCRIPTEN_EVENT_MOUSEDOWN);\n    return true;' + s[j + len('    });\n    return true;'):]
        else:
            old = 'wxWasmQueueInput([=]() { ' + cb
            assert s.count(old) == 1, cb
            s = s.replace(old, 'wxWasmQueueUserInput([=]() { ' + cb)
            if cb.startswith('Touch'):
                s = s.replace('wxWasmQueueUserInput([=]() { ' + cb, 'wxWasmQueueUserInput([=]() { ' + cb[:-4] + '}, eventType == EMSCRIPTEN_EVENT_TOUCHSTART);')
    open(app, 'w').write(s)

ev = 'src/wasm/evtloop.cpp'
s = open(ev).read()
a1 = '''extern "C" {
'''
b1 = '''bool wxWasmInPress();                   // app.cpp (z15)
int wxWasmSetDeferUserInput(int defer);

extern "C" {
'''
a2 = '''void wxGUIEventLoop::DoYieldFor(long eventsToProcess)
{
    while (Pending())
    {
        Dispatch();
    }
'''
b2 = '''void wxGUIEventLoop::DoYieldFor(long eventsToProcess)
{
    // inside a button press handler (or asked to leave input out) the next mouse/key events wait for it to end (z15)
    const bool defer = wxWasmInPress() || !(eventsToProcess & wxEVT_CATEGORY_USER_INPUT);
    const int oldDefer = defer ? wxWasmSetDeferUserInput(1) : -1;
    while (Pending())
    {
        Dispatch();
    }
    if (defer)
        wxWasmSetDeferUserInput(oldDefer);
'''
a3 = '''    static int s_depth = 0;
    if (s_depth++ == 0)
        FitTopWindow();
'''
b3 = '''    static int s_depth = 0;
    if (s_depth++ == 0)
        FitTopWindow();

    // a modal loop takes input even when it was started from a yield (z15)
    const int oldDefer = wxWasmSetDeferUserInput(0);
'''
a4 = '''    s_depth--;
    return m_exitCode;'''
b4 = '''    wxWasmSetDeferUserInput(oldDefer);
    s_depth--;
    return m_exitCode;'''
if b2 not in s:
    for x, y in ((a1, b1), (a2, b2), (a3, b3), (a4, b4)):
        assert s.count(x) == 1, (ev, x[:40])
        s = s.replace(x, y)
    open(ev, 'w').write(s)
