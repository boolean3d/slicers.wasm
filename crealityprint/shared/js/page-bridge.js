// Page side of the wx port when main() runs in a worker (PROXY_TO_PTHREAD).
// Every function here runs on the browser thread: 'sync' ones block the calling pthread until done,
// 'async' ones are fire-and-forget (queued in order). The page owns one <div> + placeholder <canvas>
// per wx top-level window; the canvas's bitmap is transferred to the worker (OffscreenCanvas).
addToLibrary({
  $wxPage: {
    tid: 0,                 // pthread id of the thread running main(); PThread.pthreads[tid] is its Worker
    wins: {},
    gl: {},
    replies: {},
    worker: function() { return PThread.pthreads[wxPage.tid]; },
    post: function(m, transfer) { var w = wxPage.worker(); if (w) w.postMessage(m, transfer || []); },
    mods: function(e) { return (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0); },
    mouseMsg: function(t, e) {
      return { wx: 'in', t: t, ts: performance.timeOrigin + e.timeStamp, now: performance.timeOrigin + performance.now(),
               sx: e.screenX, sy: e.screenY, cx: e.clientX, cy: e.clientY, mx: e.movementX, my: e.movementY,
               button: e.button, buttons: e.buttons, mods: wxPage.mods(e), detail: e.detail };
    },
    installInput: function() {
      var mainWindow = document.getElementById('main-window');
      ['mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave'].forEach(function(t) {
        document.addEventListener(t, function(e) {
          // the port prevented the default of every mouse event (MouseCallback returned true)
          e.preventDefault();
          if (t === 'mousedown' && !pageOwn(e.target)) wxPage.focusText();
          wxPage.post(wxPage.mouseMsg(t, e));
        });
      });
      // touch (phase 2b): the port's TouchCallback turned the first finger into the mouse; the page forwards each event
      // as Emscripten built it (the touches still down plus the ones that changed, marked). Default-prevented, so the
      // browser neither scrolls nor makes its own mouse events from the tap.
      ['touchstart', 'touchend', 'touchmove', 'touchcancel'].forEach(function(t, i) {
        document.addEventListener(t, function(e) {
          if (pageOwn(e.target)) return;
          e.preventDefault();
          var list = [], seen = {};
          var add = function(tt, changed) {
            if (seen[tt.identifier] !== undefined) { list[seen[tt.identifier]].ch = changed ? 1 : list[seen[tt.identifier]].ch; return; }
            seen[tt.identifier] = list.length;
            list.push({ id: tt.identifier, cx: Math.round(tt.clientX), cy: Math.round(tt.clientY), sx: Math.round(tt.screenX), sy: Math.round(tt.screenY), ch: changed ? 1 : 0 });
          };
          for (var a = 0; a < e.touches.length; a++) add(e.touches[a], false);
          for (var b = 0; b < e.changedTouches.length; b++) add(e.changedTouches[b], true);
          wxPage.post({ wx: 'in', t: 'touch', k: i + 1, ts: performance.timeOrigin + e.timeStamp, now: performance.timeOrigin + performance.now(),
                        mods: wxPage.mods(e), touches: list.slice(0, 32) });
        }, { passive: false });
      });
      document.addEventListener('wheel', function(e) {
        e.preventDefault();
        var m = wxPage.mouseMsg('wheel', e);
        m.dx = e.deltaX; m.dy = e.deltaY; m.dz = e.deltaZ; m.mode = e.deltaMode;
        wxPage.post(m);
      }, { passive: false });
      // Keys: the port prevents the default of every key, except a paste key (Ctrl/Cmd+V, Shift+Insert): only an
      // unprevented one makes the browser fire its paste event, the one place the computer's clipboard can be read
      // (wx/wasm/clipbrd.h, z17). The key's message waits for that event (150 ms at most), so the text is in the worker
      // first and the key then pastes it. A paste aimed at the page's own box or a frame is the browser's.
      var keyMsg = function(t, e) {
        return { wx: 'in', t: t, ts: performance.timeOrigin + e.timeStamp, now: performance.timeOrigin + performance.now(),
                 key: e.key, code: e.code, keyCode: e.keyCode, which: e.which, charCode: e.charCode,
                 location: e.location, repeat: e.repeat, mods: wxPage.mods(e) };
      };
      var isPasteKey = function(e) {
        return !e.altKey && (((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) ||
                             (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === 'Insert'));
      };
      var pageOwn = function(t) { return t && t !== wxPage.ime && t.nodeType === 1 && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(t.tagName)); };
      // ---- text: a hidden <textarea> on the caret takes the keyboard (spike R12). Characters come from the browser's own
      // editing events (beforeinput insertText; composition events while an IME composes; the paste event), never from
      // keydown, which knows no dead keys, AltGr, accents or IMEs. A keydown is default-prevented only when it cannot
      // produce text (decided here, at once: the program's answer would come too late). The box is moved onto the
      // program's caret by wxpage_set_caret (generic/caret.cpp), so an IME's candidate window opens at the right place.
      var ta = document.createElement('textarea');
      ta.id = 'wx-text'; ta.tabIndex = -1; ta.spellcheck = false;
      ta.setAttribute('autocomplete', 'off'); ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocorrect', 'off');
      ta.setAttribute('aria-hidden', 'true');
      ta.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:20px;opacity:0;pointer-events:none;caret-color:transparent;' +
        'resize:none;border:0;padding:0;margin:0;overflow:hidden;outline:none;z-index:2147483647;font-size:16px;line-height:20px;';
      document.body.appendChild(ta);
      wxPage.ime = ta;
      wxPage.focusText = function() { if (document.activeElement !== ta) { try { ta.focus({ preventScroll: true }); } catch (e) {} } };
      wxPage.focusText();
      var textKey = function(e) {   // may this key produce text? then the browser must see it (beforeinput or a composition follows)
        if (e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.key === 'Dead' || e.key === 'Unidentified') return true;
        if (e.metaKey) return false;
        var one = e.key.length === 1 || (e.key.length === 2 && e.key.codePointAt(0) > 0xffff);
        if (!one) return false;
        return !e.ctrlKey || e.altKey || (e.getModifierState && e.getModifierState('AltGraph'));
      };
      var composingKey = function(e) { return e.isComposing || e.keyCode === 229 || e.key === 'Process'; };
      ta.addEventListener('beforeinput', function(e) {
        if (e.inputType === 'insertCompositionText') return;   // the IME edits the box while composing (not cancelable anyway)
        e.preventDefault();
        if ((e.inputType === 'insertText' || e.inputType === 'insertReplacementText') && e.data)
          wxPage.post({ wx: 'in', t: 'text', text: e.data });
      });
      ta.addEventListener('compositionstart', function() { wxPage.post({ wx: 'in', t: 'comp', stage: 0, text: '' }); });
      ta.addEventListener('input', function(e) {
        if (e.isComposing || e.inputType === 'insertCompositionText') wxPage.post({ wx: 'in', t: 'comp', stage: 1, text: ta.value });
      });
      ta.addEventListener('compositionend', function(e) { wxPage.post({ wx: 'in', t: 'comp', stage: 2, text: e.data || '' }); ta.value = ''; });
      wxPage.flushKey = function() {
        clearTimeout(wxPage.heldKeyTimer);
        var m = wxPage.heldKey; wxPage.heldKey = null;
        if (m) wxPage.post(m);
      };
      window.addEventListener('keydown', function(e) {
        if (isPasteKey(e) && !pageOwn(document.activeElement)) {
          wxPage.flushKey();
          wxPage.heldKey = keyMsg('keydown', e);
          wxPage.heldKeyTimer = setTimeout(wxPage.flushKey, 150);
          return;
        }
        var m = keyMsg('keydown', e);
        if (!pageOwn(document.activeElement)) wxPage.focusText();   // the browser's text of this key goes to our box
        if (textKey(e) && !pageOwn(document.activeElement)) { m.text = 1; if (composingKey(e)) m.composing = 1; }
        else e.preventDefault();
        wxPage.post(m);
      });
      window.addEventListener('keyup', function(e) { e.preventDefault(); var u = keyMsg('keyup', e); if (composingKey(e)) u.composing = 1; wxPage.post(u); });
      window.addEventListener('paste', function(e) {
        if (pageOwn(e.target)) return;
        wxPage.post({ wx: 'in', t: 'paste', text: (e.clipboardData && e.clipboardData.getData('text/plain')) || '' });
        e.preventDefault();
        wxPage.flushKey();
      }, true);
      window.addEventListener('resize', function() {
        wxPage.post({ wx: 'in', t: 'resize', w: window.innerWidth, h: window.innerHeight,
                      top: mainWindow ? mainWindow.offsetTop : 0, dpr: window.devicePixelRatio });
      });
      window.addEventListener('focus', function() { if (!pageOwn(document.activeElement)) wxPage.focusText(); wxPage.post({ wx: 'in', t: 'focus' }); });
      window.addEventListener('blur', function() { wxPage.post({ wx: 'in', t: 'blur' }); });
    },
  },

  wxpage_init__proxy: 'sync',
  wxpage_init: function(tid) {
    wxPage.tid = tid;
    wxPage.installInput();
    if (location.search.indexOf('wake') >= 0) wxPage.post({ wx: 'cfg', wake: 1 });
    Module.wxPage = wxPage;
    Module.wxDirty = true;   // the browser asks before leaving while the program runs (page-extras.js)
    document.addEventListener('fullscreenchange', function() { wxPage.post({ wx: 'fs', on: document.fullscreenElement ? 1 : 0 }); });
    if (Module.wxPostFonts) Module.wxPostFonts();   // app-fonts.js kept the TTF bytes: the worker gets its own FontFaces
    else {   // a build without app-fonts.js (Prusa): the package's fonts by address, then the empty byte list so the worker's
             // wait ends now (it waited its whole 5 s cap at every Prusa start: off-thread-build-5, prof/b19-trace)
      wxPage.post({ wx: 'fonts-url', faces: Module.wxLazyFonts || [] });
      wxPage.post({ wx: 'fonts', faces: [] });
    }
    return 1;
  },
  wxpage_init__deps: ['$wxPage', 'wxpage_reply', 'wxpage_relayout'],
  // the worker asks for a relayout (a lazy font arrived): the same resize the page's own font loads trigger (install-and-lazy-load.js)
  wxpage_relayout__proxy: 'async',
  wxpage_relayout: function() { window.dispatchEvent(new Event('resize')); },

  // div + placeholder canvas on the page; the canvas's drawing surface goes to the worker
  wxpage_create_window__proxy: 'sync',
  wxpage_create_window__deps: ['$wxPage'],
  wxpage_create_window: function(id, isVisible, classListPtr) {
    var div = document.createElement('div');
    div.className = UTF8ToString(classListPtr);
    div.id = 'window-' + id;
    div.style.display = isVisible ? 'block' : 'none';
    var canvas = document.createElement('canvas');
    canvas.className = 'window-canvas';
    div.appendChild(canvas);
    document.getElementById('window-container').appendChild(div);
    wxPage.wins[id] = { div: div, canvas: canvas };
    var oc = canvas.transferControlToOffscreen();
    wxPage.post({ wx: 'canvas', id: id, canvas: oc, dpr: window.devicePixelRatio }, [oc]);
    return 1;
  },

  wxpage_destroy_window__proxy: 'async',
  wxpage_destroy_window__deps: ['$wxPage'],
  wxpage_destroy_window: function(id) {
    var w = wxPage.wins[id]; if (!w) return;
    if (w.div.parentNode) w.div.parentNode.removeChild(w.div);
    delete wxPage.wins[id];
  },

  wxpage_set_window_rect__proxy: 'async',
  wxpage_set_window_rect__deps: ['$wxPage'],
  wxpage_set_window_rect: function(id, x, y, width, height) {
    var w = wxPage.wins[id]; if (!w) return;
    var header = document.getElementsByClassName('header')[0];
    var headerHeight = header ? header.offsetHeight : 0;
    w.div.style.left = x + 'px'; w.div.style.top = (y + headerHeight) + 'px';
    w.div.style.width = width + 'px'; w.div.style.height = height + 'px';
    w.canvas.style.width = width + 'px'; w.canvas.style.height = height + 'px';
  },

  wxpage_set_window_visibility__proxy: 'async',
  wxpage_set_window_visibility__deps: ['$wxPage'],
  wxpage_set_window_visibility: function(id, isVisible) {
    var w = wxPage.wins[id]; if (w) w.div.style.display = isVisible ? 'block' : 'none';
  },

  wxpage_set_window_zindex__proxy: 'async',
  wxpage_set_window_zindex__deps: ['$wxPage'],
  wxpage_set_window_zindex: function(id, z) {
    var w = wxPage.wins[id]; if (w) w.div.style.zIndex = z;
  },

  wxpage_set_window_decorated__proxy: 'async',
  wxpage_set_window_decorated__deps: ['$wxPage'],
  wxpage_set_window_decorated: function(id, on) {
    var w = wxPage.wins[id]; if (w) w.div.classList.toggle('decorated', !!on);
  },

  wxpage_set_cursor__proxy: 'async',
  wxpage_set_cursor: function(namePtr) {
    var c = UTF8ToString(namePtr);
    if (Module.canvas) Module.canvas.style.cursor = c;
    document.body.style.cursor = c;
  },

  // a bitmap cursor (phase 2c): the worker's RGBA pixels (malloc'd there, freed here after the copy) become a PNG data URL
  wxpage_set_cursor_image__proxy: 'async',
  wxpage_set_cursor_image: function(ptr, w, h, hx, hy) {
    try {
      var px = new Uint8ClampedArray(HEAPU8.buffer, ptr, w * h * 4);   // bare HEAPU8: fresh after memory growth
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
      var css = 'url(' + c.toDataURL('image/png') + ') ' + hx + ' ' + hy + ', auto';
      if (Module.canvas) Module.canvas.style.cursor = css;
      document.body.style.cursor = css;
    } catch (e) { console.log('cursor image: ' + e); }
    _free(ptr);
  },

  // the window icon (phase 2c): not shown, see below
  wxpage_set_icon_image__proxy: 'async',
  // The program's window icon is the slicer maker's logo: the tab keeps the page's own icon (the package's index.html),
  // so the icon is not drawn into the page (the rule of these builds: no maker logos on our pages).
  wxpage_set_icon_image: function(ptr, w, h) {
    _free(ptr);
  },

  wxpage_set_title__proxy: 'sync',
  wxpage_set_title: function(ptr) { document.title = UTF8ToString(ptr); },

  wxpage_screen_width__proxy: 'sync',
  wxpage_screen_width: function() { return window.innerWidth; },
  wxpage_screen_height__proxy: 'sync',
  wxpage_screen_height: function() {
    var mw = document.getElementById('main-window');
    return window.innerHeight - (mw ? mw.offsetTop : 0);
  },
  wxpage_dpr__proxy: 'sync',
  wxpage_dpr: function() { return window.devicePixelRatio; },


  // ---- GL canvases: a <canvas id=wxgl-N> inside a top-level window's div, its bitmap owned by the worker ----
  wxpage_gl_create__proxy: 'sync',
  wxpage_gl_create__deps: ['$wxPage'],
  wxpage_gl_create: function(id, windowId) {
    var w = wxPage.wins[windowId];
    var host = w ? w.div : document.getElementById('window-container');
    var c = document.createElement('canvas');
    c.id = 'wxgl-' + id;
    c.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:5;display:none';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(c);
    wxPage.gl[id] = c;
    var oc = c.transferControlToOffscreen();
    wxPage.post({ wx: 'glcanvas', id: id, canvas: oc }, [oc]);
    return 1;
  },
  wxpage_gl_set_host__proxy: 'async',
  wxpage_gl_set_host__deps: ['$wxPage'],
  wxpage_gl_set_host: function(id, windowId) {
    var c = wxPage.gl[id], w = wxPage.wins[windowId]; if (!c || !w) return;
    if (c.parentNode === w.div) return;
    if (getComputedStyle(w.div).position === 'static') w.div.style.position = 'relative';
    w.div.appendChild(c);
  },
  wxpage_gl_set_rect__proxy: 'async',
  wxpage_gl_set_rect__deps: ['$wxPage'],
  wxpage_gl_set_rect: function(id, x, y, w, h, shown) {
    var c = wxPage.gl[id]; if (!c) return;
    c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.width = w + 'px'; c.style.height = h + 'px';
    c.style.display = (shown && w > 0 && h > 0) ? 'block' : 'none';
  },
  wxpage_gl_destroy__proxy: 'async',
  wxpage_gl_destroy__deps: ['$wxPage'],
  wxpage_gl_destroy: function(id) {
    var c = wxPage.gl[id]; if (!c) return;
    if (c.parentNode) c.parentNode.removeChild(c);
    delete wxPage.gl[id];
  },

  // ---- fullscreen, dirty flag, replies from the worker ----
  wxpage_fullscreen__proxy: 'async',
  wxpage_fullscreen: function(on) {
    try {
      if (on) { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function(e) { console.log('fullscreen: ' + e); }); }
      else if (document.fullscreenElement) document.exitFullscreen();
    } catch (e) { console.log('fullscreen: ' + e); }
  },
  // a copy (wxClipboard::AddData) also goes to the computer's clipboard: from the page, since navigator.clipboard does
  // not exist on a worker; allowed while the page has the focus and a gesture is recent, refused quietly otherwise
  wxpage_clipboard_write__proxy: 'sync',
  wxpage_clipboard_write: function(ptr) {
    var text = UTF8ToString(ptr);
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function() {}); } catch (e) {}
  },
  // the program's caret (screen px, the port's screen = the page below its header): the hidden text box sits on it
  wxpage_set_caret__proxy: 'async',
  wxpage_set_caret__deps: ['$wxPage'],
  wxpage_set_caret: function(x, y, w, h) {
    var ta = wxPage.ime; if (!ta || h <= 0) return;
    var header = document.getElementsByClassName('header')[0];
    ta.style.left = x + 'px'; ta.style.top = (y + (header ? header.offsetHeight : 0)) + 'px';
    ta.style.height = h + 'px'; ta.style.lineHeight = h + 'px'; ta.style.fontSize = Math.max(8, h - 4) + 'px';
  },
  wxpage_set_dirty__proxy: 'async',
  wxpage_set_dirty: function(flag) { Module.wxDirty = !!flag; },
  // the worker answers a {wx:'call', reply:<id>} message: strings malloc'd by the worker, freed here
  wxpage_reply__proxy: 'async',
  wxpage_reply__deps: ['$wxPage'],
  wxpage_reply: function(idPtr, valPtr) {
    var id = UTF8ToString(idPtr), v = UTF8ToString(valPtr);
    _free(idPtr); _free(valPtr);
    var r = wxPage.replies[id];
    if (r) { delete wxPage.replies[id]; r(v); }
    else window.dispatchEvent(new CustomEvent('wx-reply', { detail: { id: id, value: v } }));
  },
});
