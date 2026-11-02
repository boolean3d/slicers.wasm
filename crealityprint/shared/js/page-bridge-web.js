// Page side of wxWebView (webview_wasm.cpp) and wxFileDialog (filedlg.cpp) when main() runs in a worker
// (PROXY_TO_PTHREAD). Every function here runs on the browser thread, where the DOM, the iframes and Emscripten's
// FS live. `__proxy:'sync'` ones block the calling pthread until done (used whenever a C string is passed, so the
// pointer stays valid, and whenever a value comes back); `__proxy:'async'` ones are fire-and-forget with numeric
// arguments, queued in order with the sync ones. wxpage_fd_pick is `__async:'auto'` too: it awaits the picker
// while the pthread blocks; by R13's rule it may only be called from main's call chain (the wx event loop), never
// from a proxied task or a message handler.
//
// Page -> C++ goes one way, never blocking: wxPage.post({wx:'call', fn, args}) makes the worker (wx.js inbox) call
// Module[fn](...args) on the main pthread; strings travel as pointers malloc'd here (stringToNewUTF8, shared heap)
// and are freed by the C++ handler, which only queues (wxWasmQueueInput).
addToLibrary({
  $wxPageWeb__deps: ['$wxPage', '$stringToNewUTF8', '$UTF8ToString', '$FS'],
  $wxPageWeb: {
    ready: false,
    lastGesture: -1e9,          // performance.now() of the last trusted gesture on the page (R16)
    gestureWaiters: [],         // resolve functions run inside the next trusted gesture handler
    call: function (fn, args) { wxPage.post({ wx: 'call', fn: fn, args: args }); },
    // the top-level window's div on the page (wxpage_create_window made it; '#window-N' is the same element)
    host: function (tlwId) {
      var w = wxPage.wins[tlwId];
      return (w && w.div) || document.getElementById('window-' + tlwId);
    },
    // R16: the page owns the gesture. Recorded in capture phase so a frame or the wx input listeners cannot hide it.
    ensure: function () {
      if (wxPageWeb.ready) return;
      wxPageWeb.ready = true;
      var onGesture = function (e) {
        if (!e.isTrusted) return;
        wxPageWeb.lastGesture = performance.now();
        var ws = wxPageWeb.gestureWaiters;
        wxPageWeb.gestureWaiters = [];
        ws.forEach(function (fn) { try { fn(); } catch (err) { console.error(err); } });
      };
      ['pointerdown', 'mousedown', 'keydown'].forEach(function (t) { window.addEventListener(t, onGesture, true); });
    },
    // true while a user-activation-gated call (picker click) may run now: the browser's own word when it has one,
    // else our own clock with R16's 1 s margin on the 5 s window
    activationOk: function () {
      if (navigator.userActivation) return navigator.userActivation.isActive;
      return performance.now() - wxPageWeb.lastGesture < 4000;
    },
    // resolves inside the next trusted gesture handler (fn runs there, so the API it calls has the gesture), or
    // rejects after ms
    onNextGesture: function (fn, ms) {
      return new Promise(function (resolve, reject) {
        var done = false;
        var t = setTimeout(function () {
          if (done) return;
          done = true;
          var i = wxPageWeb.gestureWaiters.indexOf(run);
          if (i >= 0) wxPageWeb.gestureWaiters.splice(i, 1);
          reject(new Error('no gesture within ' + ms + ' ms'));
        }, ms);
        var run = function () { if (done) return; done = true; clearTimeout(t); try { resolve(fn()); } catch (e) { reject(e); } };
        wxPageWeb.gestureWaiters.push(run);
      });
    },
    // EVERY page-side await has a timeout (R16 surprise 1: a promise that never settles freezes the slicer)
    withTimeout: function (p, ms, what) {
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error(what + ' did not settle in ' + ms + ' ms')); }, ms);
        Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
      });
    },
  },

  // ------------------------------------------------------------------------------------------------------------
  // wxWebView. A web view shows the program's own pages only: a page of another site (http/https outside the
  // page's origin) opens in a new browser tab instead, whether the program asks for it (LoadURL) or the page does
  // (a link, location = ..., window.open, a form). The frame stays on the page it had. A desktop web view would show
  // that site inside the program; in a browser tab it would be a site inside our site (sign-in pages included), and
  // the page's cross-origin isolation refuses most of them anyway. The new tab cannot reach back (noopener).
  //
  // A file:// path names the same path on the server the program came from (the program's files are preloaded at
  // the paths the server has them). The service worker wxwebview-sw.js (beside index.html) puts a first <script>
  // into every page the frames load, which calls wxwvBridge: so window.wx / window.webkit.messageHandlers.wx exist
  // before the page's own scripts run. Without the worker, they appear at "load".
  // The Module.wxwv* helpers keep their names: page code and the service worker's injected script know them.
  // ------------------------------------------------------------------------------------------------------------
  wxpage_wv_setup__proxy: 'sync',
  wxpage_wv_setup__deps: ['$wxPageWeb'],
  wxpage_wv_setup: function () {
    wxPageWeb.ensure();
    if (Module.wxwvViews) return 1;
    Module.wxwvViews = new Map();
    // A press anywhere outside a web view takes the keyboard back from it, as a click on a native window does on
    // desktop. The program reads keys on the page's window; once a frame (home page, setup wizard) had focus, a click
    // on the program's own canvases left the focus in the frame, and typed keys never reached a text box (the
    // printer's IP address box of Connect via LAN).
    window.addEventListener('pointerdown', function (e) {
      var a = document.activeElement;
      if (a && a.tagName === 'IFRAME' && a.dataset.wxwv !== undefined && e.target !== a) { a.blur(); window.focus(); }
    }, true);
    // frame -> C++: one queued call on the main pthread per message; the handler frees both strings
    Module.wxwvPost = function (id, name, m) {
      var text = typeof m === 'string' ? m : JSON.stringify(m);
      wxPageWeb.call('_wxwv_message', [id, stringToNewUTF8(name), stringToNewUTF8(text)]);
    };
    Module.wxwvResolve = function (url) {
      // file:/p, file:///p and file://localhost/p all name path p. Read by hand, not with URL(): Chrome on Windows
      // takes the first folder of file:/bambu/... for a host ("//bambu/" = a network share) and drops it.
      var m = /^file:(?:\/\/([^/?#]*))?([^?#]*)(.*)$/i.exec(url);
      if (!m) return Module.wxwvHouseUrl(url) || url;
      var path = m[2] || '/';
      if (path.charAt(0) !== '/') path = '/' + path;
      return new URL(path + m[3], location.origin).href;
    };
    // A printer's own page on the house network (a Klipper printer's Mainsail at http://192.168.1.50, voron.local):
    // loaded through the home helper by the service worker (wxwebview-sw.js) at <page folder>/__lan/<host>/<port>/...,
    // so it shows in the web view as on desktop instead of a tab that cannot reach the house network.
    Module.wxwvHouse = function (host) {
      var h = host.toLowerCase(), p = h.split('.');
      if (p.length === 4 && p.every(function (x) { return x !== '' && !isNaN(+x); })) {
        var a = +p[0], b = +p[1];
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
      }
      return h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa') || p.length === 1;
    };
    Module.wxwvLanBridge = function () {
      return Module.lanBridge || new URLSearchParams(location.search).get('bridge') || 'ws://localhost:8770';
    };
    Module.wxwvHouseUrl = function (url) {
      try {
        var u = new URL(url);
        if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !Module.wxwvHouse(u.hostname)) return null;
        var port = u.port || (u.protocol === 'https:' ? '443' : '80');
        return new URL('__lan/' + encodeURIComponent(u.hostname) + '/' + port + u.pathname + u.search + u.hash, new URL('./', location.href)).href;
      } catch (e) { return null; }
    };
    // The login for a printer page (<page folder>/__lan/<host>/<port>/...) goes to the service worker, which answers
    // the printer's 401 with it; resolves once the worker has it, so the page's first request already carries it.
    Module.wxwvLanLogin = function (href, login) {
      var m = /[/]__lan[/]([^/]+)[/]([0-9]+)([/]|$)/.exec(href);
      var w = navigator.serviceWorker && (navigator.serviceWorker.controller || Module.wxwvWorker);
      if (!m || !w) return Promise.resolve();
      return new Promise(function (resolve) {
        var ch = new MessageChannel();
        ch.port1.onmessage = function () { resolve(); };
        w.postMessage({ wxwvLanLogin: { host: decodeURIComponent(m[1]), port: Number(m[2]), user: login.user, password: login.password } }, [ch.port2]);
        setTimeout(resolve, 2000);
      });
    };
    Module.wxwvOutside = function (url, base) {
      try {
        var u = new URL(url, base || location.href);
        return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== location.origin;
      } catch (e) { return false; }
    };
    // Only for something the user just did (a click, a key): a page loading by itself opens no tab. Read on the
    // page, so it holds for a proxied call too, as long as the worker answered within the activation window (R16).
    Module.wxwvOpenTab = function (url, base) {
      var href = new URL(url, base || location.href).href;
      if (!wxPageWeb.activationOk()) {
        console.log('wxWebView: ' + href + ' not opened (another site, and nothing the user did asked for it)');
        return;
      }
      window.open(href, '_blank', 'noopener,noreferrer');
    };
    // In the frame: links, script navigation, forms and window.open to another site go to a new tab.
    // Navigation API where there is one (every navigation the page starts); link clicks and window.open
    // also directly (new-window links, browsers without it).
    Module.wxwvKeepHome = function (win) {
      if (win.__wxwvHome) return;
      win.__wxwvHome = true;
      var out = function (url) {
        var base = win.location.href;
        if (!Module.wxwvOutside(url, base)) return false;
        Module.wxwvOpenTab(url, base);
        return true;
      };
      if (win.navigation && win.navigation.addEventListener) {
        win.navigation.addEventListener('navigate', function (e) {
          if (e.cancelable && e.destination && out(e.destination.url)) e.preventDefault();
        });
      }
      win.document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (a && out(a.href)) e.preventDefault();
      }, true);
      // This wrapper is the program page's function, so WebKit resolves a relative address given to the frame's own
      // open against the program page (guide/0/load.js: window.open('../11/index.html', '_self') -> /bambu/11/, a 404).
      // Resolved here against the frame's page, as the page meant it.
      var open = win.open;
      win.open = function (url) {
        if (url && out(String(url))) return null;
        var a = Array.prototype.slice.call(arguments);
        if (url) { try { a[0] = new URL(String(url), win.document.baseURI).href; } catch (e) {} }
        return open.apply(win, a);
      };
    };
    Module.wxwvUnresolve = function (href) {
      try {
        var u = new URL(href);
        if (u.origin === location.origin) return 'file://' + decodeURIComponent(u.pathname) + u.search + u.hash;
      } catch (e) {}
      return href;
    };
    // Runs js inside the frame's own document (an inline <script>), so the page is the script's
    // entry: relative addresses (window.open('../1/index.html'), location = ...) resolve against
    // the page, as in a desktop web view. contentWindow.eval from here would resolve them against
    // the program's page. Returns { ok, value }.
    // A script whose value nobody reads (RunScript without output: HandleStudio(...) answers) goes to the frame by
    // message and runs as the frame's own task: in WebKit a script started while the program page's code is on the
    // stack still resolves location.href = '../21/index.html' against the program page, inline <script> or not.
    Module.wxwvPostRun = function (win, js) {
      // A MessageChannel made inside the frame carries the scripts: pages replace window.postMessage (Orca's Home:
      // window.postMessage = HandleStudio, home.js:510), which then got the message instead of the runner and every
      // such script was lost. The port belongs to the frame's document, so a new page gets a new runner.
      if (!win.__wxwvRunPort) {
        var r = Module.wxwvEval(win, '(function () { var c = new MessageChannel(); c.port1.onmessage = function (e) {' +
          ' try { (0, eval)(e.data); } catch (x) { console.error(x); } }; return c.port2; })()');
        if (!r.ok) return;
        win.__wxwvRunPort = r.value;
      }
      win.__wxwvRunPort.postMessage(js);
    };
    Module.wxwvEval = function (win, js) {
      var doc = win.document;
      win.__wxwvJs = js;
      win.__wxwvOut = { ok: false };
      var s = doc.createElement('script');
      s.text = 'try { window.__wxwvOut = { ok: true, value: (0, eval)(window.__wxwvJs) }; } catch (e) { console.error(e); window.__wxwvOut = { ok: false }; }';
      (doc.head || doc.documentElement).appendChild(s);
      s.remove();
      var out = win.__wxwvOut;
      delete win.__wxwvJs;
      delete win.__wxwvOut;
      return out;
    };
    window.wxwvBridge = function (win, frame) {
      var v = Module.wxwvViews.get(+frame.dataset.wxwv);
      if (!v) return;
      Module.wxwvKeepHome(win);
      // wxWebView::SetUserAgent: what the page's own script reads (pages test it, e.g. Orca's
      // "BBL-Slicer"); requests keep the browser's, as a page cannot change those.
      if (v.userAgent) {
        try { Object.defineProperty(win.navigator, 'userAgent', { get: function () { return v.userAgent; }, configurable: true }); } catch (e) {}
      }
      win.webkit = win.webkit || {};
      win.webkit.messageHandlers = win.webkit.messageHandlers || {};
      v.handlers.forEach(function (name) {
        var h = { postMessage: function (m) { Module.wxwvPost(v.id, name, m); } };
        win[name] = h;
        win.webkit.messageHandlers[name] = h;
      });
      // A key the page leaves alone goes on to the program, as WebKitGTK hands a key its page did not use to the
      // web view's window on desktop (Escape in Orca's Setup Wizard closes the wizard). The program reads keys on
      // the page's window, so a key typed while a frame has the keyboard never reached it. Keys a page uses
      // itself stay in the page: default-prevented ones, typing in its text boxes (Escape still goes on), Tab and
      // the scrolling keys.
      if (!win.__wxwvKeys) {
        win.__wxwvKeys = true;
        // The frame having the keyboard gives its web view the program's focus, as a click in a desktop web
        // view focuses that widget: the keys sent on below then reach the window around it (its char hook).
        var focused = function () { wxPageWeb.call('_wxwv_focused', [v.id]); };
        win.addEventListener('focus', focused);
        win.addEventListener('pointerdown', focused, true);
        ['keydown', 'keyup'].forEach(function (type) {
          win.addEventListener(type, function (e) {
            if (e.defaultPrevented || e.isComposing) return;
            var t = e.target;
            var edit = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
            if (edit ? e.key !== 'Escape' : /^(Tab|Arrow|Page|Home$|End$| $)/.test(e.key)) return;
            // the page's own key listeners (page-bridge.js) forward this to the worker as every key on the page
            window.dispatchEvent(new KeyboardEvent(type, { key: e.key, code: e.code, location: e.location,
              repeat: e.repeat, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
              bubbles: true, cancelable: true }));
          });
        });
      }
      if (!win.__wxwvScripts) {
        win.__wxwvScripts = true;
        v.scripts.forEach(function (s) { Module.wxwvEval(win, s); });
      }
    };
    Module.wxwvReady = Promise.resolve();
    if (navigator.serviceWorker && window.isSecureContext) {
      Module.wxwvReady = navigator.serviceWorker.register('wxwebview-sw.js', { scope: './' }).then(function (reg) {
        // Ready once the worker is active ('activating' counts): Firefox held a first visit's worker in 'activating'
        // ~60 s while the page was busy starting, so every web view (the setup wizard) stayed blank that long.
        return new Promise(function (resolve) {
          var w = reg.active || reg.waiting || reg.installing;
          if (reg.active || !w) return resolve();
          w.addEventListener('statechange', function () { if (w.state === 'activating' || w.state === 'activated') resolve(); });
          navigator.serviceWorker.addEventListener('controllerchange', function () { resolve(); });
        }).then(function () {
          Module.wxwvWorker = reg.active;
          if (reg.active) reg.active.postMessage({ wxwvLanBridge: Module.wxwvLanBridge() });
        });
      }).catch(function (e) { console.error('web view service worker: ' + e); });
    }
    return 1;
  },

  wxpage_wv_create__proxy: 'async',
  wxpage_wv_create__deps: ['$wxPageWeb'],
  wxpage_wv_create: function (id, tlwId) {
    var host = wxPageWeb.host(tlwId);
    if (!host) { console.error('wxWebView ' + id + ': no page div for window ' + tlwId); return; }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var f = document.createElement('iframe');
    f.dataset.wxwv = id;
    f.style.position = 'absolute';
    f.style.border = '0';
    f.style.zIndex = 6;
    f.style.pointerEvents = 'auto';
    f.style.background = 'white';
    f.style.display = 'none';
    var v = { id: id, frame: f, handlers: new Set(), scripts: [], userAgent: '' };
    Module.wxwvViews.set(id, v);
    f.addEventListener('load', function () {
      var win = f.contentWindow, href = 'about:blank', title = '';
      try {
        window.wxwvBridge(win, f);
        href = win.location.href;
        if (win.__wxwvLan) href = 'http://' + win.__wxwvLan.host + ':' + win.__wxwvLan.port + win.location.pathname + win.location.search + win.location.hash;
        title = win.document.title || '';
      } catch (e) {}
      if (href === 'about:blank' && !v.started) return;
      wxPageWeb.call('_wxwv_loaded', [id, stringToNewUTF8(Module.wxwvUnresolve(href)), stringToNewUTF8(title)]);
    });
    host.appendChild(f);
  },

  wxpage_wv_set_rect__proxy: 'async',
  wxpage_wv_set_rect__deps: ['$wxPageWeb'],
  wxpage_wv_set_rect: function (id, tlwId, x, y, w, h, shown) {
    var v = Module.wxwvViews && Module.wxwvViews.get(id);
    if (!v) return;
    var host = wxPageWeb.host(tlwId);
    if (host && v.frame.parentNode !== host) host.appendChild(v.frame);
    var s = v.frame.style;
    s.left = x + 'px';
    s.top = y + 'px';
    s.width = w + 'px';
    s.height = h + 'px';
    s.display = (shown && w > 0 && h > 0) ? 'block' : 'none';
  },

  // 1 if url is a page of another site: it opens in a new tab, not in the web view
  wxpage_wv_open_outside__proxy: 'sync',
  wxpage_wv_open_outside__deps: ['$wxPageWeb'],
  wxpage_wv_open_outside: function (urlPtr) {
    var u = Module.wxwvResolve(UTF8ToString(urlPtr));
    if (!Module.wxwvOutside(u)) return 0;
    Module.wxwvOpenTab(u);
    return 1;
  },

  wxpage_wv_load__proxy: 'sync',
  wxpage_wv_load__deps: ['$wxPageWeb'],
  wxpage_wv_load: function (id, urlPtr, userPtr, passPtr) {
    var v = Module.wxwvViews.get(id);
    if (!v) return;
    var href = Module.wxwvResolve(UTF8ToString(urlPtr));
    v.started = true;
    var login = { user: UTF8ToString(userPtr), password: UTF8ToString(passPtr) };
    Module.wxwvReady.then(function () { return Module.wxwvLanLogin(href, login); }).then(function () { v.frame.src = href; });
  },

  wxpage_wv_set_html__proxy: 'sync',
  wxpage_wv_set_html__deps: ['$wxPageWeb'],
  wxpage_wv_set_html: function (id, htmlPtr) {
    var v = Module.wxwvViews.get(id);
    if (!v) return;
    v.started = true;
    v.frame.srcdoc = UTF8ToString(htmlPtr);
  },

  wxpage_wv_reload__proxy: 'async',
  wxpage_wv_reload__deps: ['$wxPageWeb'],
  wxpage_wv_reload: function (id) {
    var v = Module.wxwvViews && Module.wxwvViews.get(id);
    if (v) { try { v.frame.contentWindow.location.reload(); } catch (e) {} }
  },

  // RunScript: the value of the script as text (malloc'd, freed by C++), or 0 if it threw or there is no page.
  // Plain proxy-sync (R13's rule): callable from anywhere on the main pthread, which blocks for the round trip
  // (~0.05 ms). Always returns: a script that never ends would hang the page thread itself, as it does today.
  wxpage_wv_run__proxy: 'sync',
  wxpage_wv_run__deps: ['$wxPageWeb'],
  wxpage_wv_run: function (id, jsPtr, want) {
    try {
      var v = Module.wxwvViews.get(id);
      if (!v) return 0;
      if (!want) {
        Module.wxwvPostRun(v.frame.contentWindow, UTF8ToString(jsPtr));
        return stringToNewUTF8('');
      }
      var out = Module.wxwvEval(v.frame.contentWindow, UTF8ToString(jsPtr));
      if (!out || !out.ok) return 0;
      var r = out.value;
      var s = r === undefined || r === null ? '' : (typeof r === 'string' ? r : (typeof r === 'object' ? JSON.stringify(r) : String(r)));
      return stringToNewUTF8(s);
    } catch (e) {
      console.error('wxWebView RunScript: ' + e);
      return 0;
    }
  },

  wxpage_wv_handler__proxy: 'sync',
  wxpage_wv_handler__deps: ['$wxPageWeb'],
  wxpage_wv_handler: function (id, namePtr, add) {
    var v = Module.wxwvViews.get(id);
    if (!v) return;
    var n = UTF8ToString(namePtr);
    if (add) v.handlers.add(n); else v.handlers.delete(n);
    try {
      var win = v.frame.contentWindow;
      if (add) window.wxwvBridge(win, v.frame);
      else { delete win[n]; if (win.webkit && win.webkit.messageHandlers) delete win.webkit.messageHandlers[n]; }
    } catch (e) {}
  },

  // js == 0 removes every user script
  wxpage_wv_user_script__proxy: 'sync',
  wxpage_wv_user_script__deps: ['$wxPageWeb'],
  wxpage_wv_user_script: function (id, jsPtr) {
    var v = Module.wxwvViews.get(id);
    if (!v) return;
    if (jsPtr) v.scripts.push(UTF8ToString(jsPtr)); else v.scripts = [];
  },

  wxpage_wv_user_agent__proxy: 'sync',
  wxpage_wv_user_agent__deps: ['$wxPageWeb'],
  wxpage_wv_user_agent: function (id, uaPtr) {
    var v = Module.wxwvViews.get(id);
    if (!v) return;
    v.userAgent = UTF8ToString(uaPtr);
    try { window.wxwvBridge(v.frame.contentWindow, v.frame); } catch (e) {}
  },

  wxpage_wv_destroy__proxy: 'async',
  wxpage_wv_destroy__deps: ['$wxPageWeb'],
  wxpage_wv_destroy: function (id) {
    var v = Module.wxwvViews && Module.wxwvViews.get(id);
    if (!v) return;
    if (v.frame.parentNode) v.frame.parentNode.removeChild(v.frame);
    Module.wxwvViews.delete(id);
  },

  // ------------------------------------------------------------------------------------------------------------
  // wxFileDialog. Save = the program writes into the download folder of the page's FS and the watcher below hands
  // the file to the browser; Open = the browser's picker, run on the page.
  // ------------------------------------------------------------------------------------------------------------

  // Every file written (closed after writing) or renamed into the download folder is handed to the browser
  // as a download, once it has been quiet for half a second (a program that writes, closes and appends
  // gives one download). Files ending in .tmp wait for their rename. FS here is the page's, the real one:
  // the worker's file syscalls are proxied to it.
  wxpage_fd_watch_downloads__proxy: 'sync',
  wxpage_fd_watch_downloads__deps: ['$wxPageWeb'],
  wxpage_fd_watch_downloads: function (dirPtr) {
    if (Module.wxDownloads) return;
    var dir = UTF8ToString(dirPtr) + '/';
    var timers = {};
    var give = function (path) {
      if (!path || path.indexOf(dir) !== 0 || /\.tmp$/i.test(path)) return;
      clearTimeout(timers[path]);
      timers[path] = setTimeout(function () {
        delete timers[path];
        var data;
        try { data = FS.readFile(path); } catch (e) { return; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
        a.download = path.slice(dir.length);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
        console.log('wx download ' + a.download + ' ' + data.length + ' bytes');
      }, 500);
    };
    Module.wxDownloads = give;
    var close = FS.close;
    FS.close = function (stream) {
      var path = stream.path, wrote = (stream.flags & 3) !== 0;
      var r = close.apply(this, arguments);
      if (wrote) give(path);
      return r;
    };
    var rename = FS.rename;
    FS.rename = function (oldPath, newPath) {
      var r = rename.apply(this, arguments);
      give(newPath);
      return r;
    };
  },

  // The browser's file picker; picked files are copied into dir (the page's FS). Returns their names joined by
  // '\n' (malloc'd, freed by C++), or 0 when nothing was picked, the wait ran out, or something threw.
  // Runs on the page while the main pthread blocks (__async:'auto' + __proxy:'sync'); call it only from main's
  // chain (wxFileDialog::ShowModal under the wx event loop), never from a proxied task or a message handler.
  //
  // R16: input.click() needs transient user activation (5 s from the gesture in every browser). The pick is run
  // at once when the page still has it (navigator.userActivation.isActive); otherwise it is deferred and opened
  // inside the next trusted pointerdown/mousedown/keydown handler on the page (the user's next click or key
  // opens the dialog). A page that replaced HTMLInputElement.prototype.click with its own DOM dialog
  // (boolean3d-folder.js) needs no activation, so that case never defers. Timeouts: 10 min for the whole pick (waiting
  // for the gesture included), 5 min for reading the picked files; a timeout returns 0 (= Cancel) so wx goes on.
  wxpage_fd_pick__async: 'auto',
  wxpage_fd_pick__proxy: 'sync',
  wxpage_fd_pick__deps: ['$wxPageWeb'],
  wxpage_fd_pick: async function (acceptPtr, multiple, dirPtr) {
    var PICK_MS = 600000, READ_MS = 300000;
    var accept = UTF8ToString(acceptPtr), dir = UTF8ToString(dirPtr);
    wxPageWeb.ensure();
    var input = document.createElement('input');
    try {
      input.type = 'file';
      if (accept) input.accept = accept;
      if (multiple) input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
      var customClick = Object.prototype.hasOwnProperty.call(HTMLInputElement.prototype, 'click');
      var t0 = performance.now();
      var picked = new Promise(function (resolve) {
        input.onchange = function () { resolve(input.files); };
        input.oncancel = function () { resolve(null); };
        if (!('oncancel' in input)) {
          // no cancel event (old browsers): the window getting its focus back with no change soon after = cancelled
          var onFocus = function () {
            window.removeEventListener('focus', onFocus);
            setTimeout(function () { resolve(input.files && input.files.length ? input.files : null); }, 1500);
          };
          setTimeout(function () { window.addEventListener('focus', onFocus); }, 0);
        }
      });
      var open = function () { input.click(); };
      if (customClick || wxPageWeb.activationOk()) {
        open();
      } else {
        console.log('wxFileDialog: no user activation left (' + Math.round(performance.now() - wxPageWeb.lastGesture) + ' ms since the last gesture); the picker opens on the next click or key');
        await wxPageWeb.onNextGesture(open, PICK_MS);
      }
      var files = await wxPageWeb.withTimeout(picked, Math.max(1000, PICK_MS - (performance.now() - t0)), 'file picker');
      if (!files || !files.length) return 0;
      FS.mkdirTree(dir);
      var names = [];
      for (var i = 0; i < files.length; i++) {
        var buf = await wxPageWeb.withTimeout(files[i].arrayBuffer(), READ_MS, 'reading ' + files[i].name);
        FS.writeFile(dir + '/' + files[i].name, new Uint8Array(buf));
        names.push(files[i].name);
      }
      return stringToNewUTF8(names.join('\n'));
    } catch (e) {
      console.error('wxFileDialog: ' + (e && e.message || e));
      return 0;
    } finally {
      input.remove();
    }
  },
});
