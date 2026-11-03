# z50: the main loop paints at most once per animation frame. Since R10 (wx.js wxWakeOnInput) the loop's wait ends as
# soon as the page forwards input, so every mouse message ran a full pass WITH a paint; while input kept arriving faster
# than a paint took, the worker's event loop never reached its animation-frame turn, so none of those paints was shown
# (KiCad's 3D view: 77 frames painted in a row in 1.8 s with nothing on screen, then one frame shown; kicad-play-10,
# 10-26). Now the wait says what ended it: an animation frame (paint this pass) or input (handle it now, paint at the
# frame). A pass also paints when no frame came for 50 ms (a tab whose frames are throttled). Yield passes (Dispatch)
# paint as before. Rerun-safe; does nothing on a tree it does not fit. Run in pwx/owx.
MARK = 'z50'
def edit(path, pairs):
    s = open(path).read()
    if MARK in s:
        print(MARK, 'already in', path); return True
    for a, b in pairs:
        if s.count(a) != 1:
            print(MARK + ': ' + path + ' does not fit, skipped (' + a[:40].replace('\n', ' ') + ')'); return False
    for a, b in pairs:
        s = s.replace(a, b)
    open(path, 'w').write(s); print(MARK, 'ok', path); return True

ok = edit('build/wasm/wx.js', [(
'''  var wxWaitFrame = function () {
    return new Promise(function (resolve) {
      var done = false;
      var fin = function () { if (done) return; done = true; wxFrameWaiter = null; resolve(); };
      if (wxWakeOnInput) wxFrameWaiter = fin;
      requestAnimationFrame(fin);
    });
  };
''',
'''  // z50: resolves 1 when an animation frame ended the wait (the pass paints), 0 when input did (handled now, painted at the frame)
  var wxWaitFrame = function () {
    return new Promise(function (resolve) {
      var done = false;
      var fin = function (frame) { if (done) return; done = true; wxFrameWaiter = null; resolve(frame); };
      if (wxWakeOnInput) wxFrameWaiter = function () { fin(0); };
      requestAnimationFrame(function () { fin(1); });
    });
  };
''')])
ok = edit('src/wasm/evtloop.cpp', [(
'''EM_ASYNC_JS(void, wxWasmWaitFrameJs, (), {
    await wxWaitFrame();   // wx.js: a frame, or (experiment) input from the page
});
''',
'''EM_ASYNC_JS(int, wxWasmWaitFrameJs, (), {
    return await wxWaitFrame();   // wx.js: 1 an animation frame, 0 input from the page (z50)
});
'''), (
'''static void wxWasmWaitFrame()
{
    if (wxWasmLoopOffMainThread())
        emscripten_thread_sleep(8);
    else
        wxWasmWaitFrameJs();
}
''',
'''// z50: true when an animation frame ended the wait (the next pass paints); false when input did
static bool wxWasmWaitFrame()
{
    if (wxWasmLoopOffMainThread())
    {
        emscripten_thread_sleep(8);
        return true;
    }
    return wxWasmWaitFrameJs() != 0;
}

// z50: the pass after an input wake handles the input and leaves the paint to the frame's pass, unless no frame
// came for 50 ms (frames throttled); every other pass (the first, a yield's) paints
static bool s_paintThisPass = true;
static double s_lastPaintMs = 0;
'''), (
'''        wxWasmDispatchInput();

        if (wxTheApp)
        {
            wxTheApp->ProcessPendingEvents();
            wxTheApp->Paint();
''',
'''        wxWasmDispatchInput();

        if (wxTheApp)
        {
            wxTheApp->ProcessPendingEvents();
            const double nowMs = emscripten_get_now();
            if (s_paintThisPass || nowMs - s_lastPaintMs > 50)   // z50
            {
                wxTheApp->Paint();
                s_lastPaintMs = nowMs;
            }
            s_paintThisPass = true;
'''), (
'''    while (!m_shouldExit)
    {
        ProcessEvents();
        if (!m_shouldExit)
            wxWasmWaitFrame();
    }
''',
'''    while (!m_shouldExit)
    {
        ProcessEvents();
        if (!m_shouldExit)
            s_paintThisPass = wxWasmWaitFrame();   // z50: input woke the loop -> this pass handles it, the frame's pass paints
    }
''')]) and ok
print(MARK, 'done' if ok else 'INCOMPLETE')
