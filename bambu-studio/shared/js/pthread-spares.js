// --pre-js: the thread pool always keeps SPARES loaded workers ready, so starting a thread never needs a brand-new
// Worker while the page thread is blocked. A browser starts a new Worker only after the page thread returns to its
// event loop; Emscripten (PTHREAD_POOL_SIZE_STRICT=0) makes one on the spot when the pool is empty, so a page thread
// that starts a thread and then waits for it locks up for good. PrusaSlicer 2.9.6 BackgroundSlicingProcess::start()
// does exactly that at Slice (create_thread, then m_condition.wait for STATE_IDLE); with TBB's workers and the app's
// own threads already holding the 24 pre-made workers, Slice froze ~1 start in 3 (stacks: page thread in a futex wait,
// no slicing thread). Bambu Studio and Orca start their slicing thread the same way.
// Each time a worker is taken from the pool, a task on the page's event loop tops the spares up again; the pool
// grows only as threads are actually started, never shrinks below what the program uses (threads ending go back).
(function () {
  if (typeof ENVIRONMENT_IS_PTHREAD !== 'undefined' && ENVIRONMENT_IS_PTHREAD) return;
  const SPARES = 8;
  let queued = false;
  const topUp = () => {
    queued = false;
    while (PThread.unusedWorkers.length < SPARES) PThread.loadWasmModuleToWorker(PThread.allocateUnusedWorker());
  };
  (Module['preRun'] ??= []).push(() => {
    const take = PThread.getNewWorker;
    PThread.getNewWorker = function () {
      const w = take.apply(this, arguments);
      if (!queued) { queued = true; setTimeout(topUp, 0); }
      return w;
    };
  });
})();
