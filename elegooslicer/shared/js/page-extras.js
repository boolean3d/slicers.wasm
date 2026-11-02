// Page-side extras when main() runs in a worker (PROXY_TO_PTHREAD). --pre-js of the app, next to lan-printer-link.js and
// script-door.js; the page half of the wx port is bulk/page-bridge.js (a js-library: $wxPage, wxpage_init, ...).
// Pre-js code also runs inside every pthread worker: everything here is for the page only.
(function () {
  if (typeof document === 'undefined') return;

  // ---- calls into the program -------------------------------------------------------------------------------------
  // The page can no longer call a wasm export that works on the program's state: main() and wx run on one pthread, so
  // the call is posted to that thread's Worker as { wx: 'call', fn, args, free: [indices], reply: id, freeResult }
  // and the worker-side inbox (wx.js) runs Module[fn](...args), frees the args named in `free`, and when `reply` is
  // set reads the returned C string (UTF8ToString; freed there unless freeResult: false) and hands it to the page's
  // resolver Module.wxPage.replies[id] (a proxied page function calls it and deletes the key).
  // Pointers in args are made here with stringToNewUTF8 / _malloc + HEAPU8.set (bare HEAPU8: Emscripten refreshes it
  // after memory growth; Module.HEAPU8 is stale between proxied calls, R17).
  var n = 0;

  function running() { return !!(Module.wxPage && Module.wxPage.tid && Module.wxPage.worker()); }

  Module.wxRunning = running;

  // Module.wxCall(fn, args, opts) -> true/false (posted or not), or a Promise of the returned string when opts.reply.
  // opts: free (indices of args the worker frees after the call), reply (true), freeResult (default true),
  // transfer (list), patience (ms, default 10 s).
  Module.wxCall = function (fn, args, opts) {
    opts = opts || {};
    if (!running()) {
      if (opts.reply) return Promise.reject(new Error('the program is still loading'));
      return false;
    }
    var m = { wx: 'call', fn: fn, args: args || [] };
    if (opts.free && opts.free.length) m.free = opts.free;
    if (opts.freeResult === false) m.freeResult = false;
    if (!opts.reply) { Module.wxPage.post(m, opts.transfer); return true; }
    var id = fn.replace(/^_/, '').replace(/_/g, '-') + '-' + (++n);   // '_b3d_door_now' -> 'b3d-door-now-7'
    m.reply = id;
    var replies = Module.wxPage.replies || (Module.wxPage.replies = {});
    var patience = opts.patience || 10000;
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        if (replies[id]) { delete replies[id]; reject(new Error('the program did not answer ' + fn + ' within ' + Math.round(patience / 1000) + ' s')); }
      }, patience);
      replies[id] = function (v) { clearTimeout(t); resolve(v); };
      Module.wxPage.post(m, opts.transfer);
    });
  };

  // ---- leaving the page ---------------------------------------------------------------------------------------------
  // Today owx/src/wasm/app.cpp:759-781 UnloadCallback ran the wx close event inside the browser's beforeunload and
  // returned "veto" (every modal answered Cancel without showing). From a worker that cannot happen: beforeunload is
  // synchronous on the page and the program's answer would arrive after the browser decided. So the page asks
  // "Leave site?" itself while the program runs and has not said it is clean: Module.wxDirty is undefined (or true)
  // until the C++ side calls wxpage_set_dirty(0) (bulk/page-bridge.js), which sets Module.wxDirty = false.
  // emscripten_set_beforeunload_callback in app.cpp:843 must go: registered from a pthread its string return is lost.
  window.addEventListener('beforeunload', function (e) {
    if (!running()) return;
    if (Module.wxDirty === false) return;
    e.preventDefault();
    e.returnValue = '';
  });
})();
