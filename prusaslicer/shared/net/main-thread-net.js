// A network call made on the page's own thread fails at once instead of freezing the window (a --pre-js, all slicers).
// Emscripten keeps every socket on the page's thread: a background thread's socket call is passed there and waits
// while the page goes on, so its WebSocket can open, answer or fail. A call the page's thread makes itself and then
// blocks on (libcurl perform_sync from a click or a printer message) can never see its WebSocket open or fail, because
// the page is stuck inside that call: libcurl waits out its whole timeout (Bambu Studio's printer warnings (HMS):
// two 10 s waits right after a printer connects; PrusaSlicer: 3 x 10 s after the wizard's Finish) and always fails.
// Such a connect now fails with "network unreachable", as on a desktop with no network: the program takes its
// offline path at once (HMS texts from its own resources/hms files). Background threads keep their network.
(function () {
  if (typeof ENVIRONMENT_IS_PTHREAD !== 'undefined' && ENVIRONMENT_IS_PTHREAD) return;
  (Module.preRun = [].concat(Module.preRun || [])).unshift(function () {
    if (typeof SOCKFS === 'undefined' || !SOCKFS.websocket_sock_ops) return;
    var ops = SOCKFS.websocket_sock_ops, connect = ops.connect;
    var ENETUNREACH = 40;   // __WASI_ERRNO_NETUNREACH (Emscripten's errno numbers are WASI's)
    ops.connect = function (sock, addr, port) {
      var fromThread = typeof PThread !== 'undefined' && PThread.currentProxiedOperationCallerThread;
      if (!fromThread) {
        if (Module.netLog) Module.netLog('page-thread connect refused ' + addr + ':' + port);
        throw new FS.ErrnoError(ENETUNREACH);
      }
      return connect.apply(this, arguments);
    };
  });
})();
