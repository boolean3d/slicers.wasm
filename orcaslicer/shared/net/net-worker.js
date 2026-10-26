// Network for a slicer in a tab, off the page's thread (a --pre-js for every slicer; does its work on the page only).
//
// Emscripten keeps every socket on the page's thread (SOCKFS): a background thread's socket call is passed to the page
// and the socket's WebSocket delivers its events there. A call the page's thread makes itself and then blocks on
// (libcurl perform_sync from a click: Bambu Studio's printer warnings, PrusaSlicer's wizard Finish) could never see its
// WebSocket open or answer, because the page sits inside that call and its events wait: libcurl waited out its whole
// timeout with the window frozen, and always failed.
//
// Here the WebSockets live in a worker of their own. SOCKFS is unchanged; each WebSocket it makes is a stand-in on the
// page whose events the worker writes into shared memory (one ring per connection). Every socket operation first reads
// that ring (pump), so a page that is blocked inside a network call still sees the connection open, its bytes arrive
// and its close, as a desktop thread would; an idle page is also woken by a message from the worker, so background
// threads waiting in poll() are told at once. Bytes to send go to the worker by postMessage, which a blocked page can
// still post.
//
// Each connection is a WebSocket to the slicer host's relay (<page folder>/relay?to=host:port, relay.mjs), which opens
// the TCP connection and passes bytes both ways; one to an address on the house network goes to the home helper
// instead (below). TLS stays end to end inside the wasm (libcurl + OpenSSL check the certificates); the relay sees only
// encrypted bytes.
(function () {
  if (typeof ENVIRONMENT_IS_PTHREAD !== 'undefined' && ENVIRONMENT_IS_PTHREAD) return;
  if (typeof Worker === 'undefined' || typeof SharedArrayBuffer === 'undefined') return;

  // ---- the worker: owns the real WebSockets, writes their events into each connection's ring ----
  function workerMain() {
    var OPEN = 1, MESSAGE = 2, ERROR = 3, CLOSE = 4, HEAD = 16;
    var conns = new Map();
    function space(c) { return c.cap - ((Atomics.load(c.h, 0) - Atomics.load(c.h, 1)) | 0); }
    function put(c, type, bytes) {
      var n = bytes ? bytes.length : 0, w = Atomics.load(c.h, 0), at = w & (c.cap - 1);
      var rec = new Uint8Array(5 + n);
      rec[0] = type; rec[1] = n & 255; rec[2] = (n >> 8) & 255; rec[3] = (n >> 16) & 255; rec[4] = (n >>> 24) & 255;
      if (n) rec.set(bytes, 5);
      var first = Math.min(rec.length, c.cap - at);
      c.ring.set(rec.subarray(0, first), at);
      if (first < rec.length) c.ring.set(rec.subarray(first), 0);
      Atomics.store(c.h, 0, (w + rec.length) | 0);
    }
    // Records waiting for room in the ring go out in order once the page has read enough.
    function flush(c) {
      var wrote = false;
      while (c.pending.length && space(c) >= 5 + (c.pending[0].bytes ? c.pending[0].bytes.length : 0)) {
        var r = c.pending.shift(); put(c, r.type, r.bytes); wrote = true;
      }
      if (wrote) postMessage(c.id);
      if (c.pending.length && !c.waiting) {
        c.waiting = true;
        var read = Atomics.load(c.h, 1);
        Atomics.waitAsync(c.h, 1, read).value.then(function () { c.waiting = false; flush(c); });
      }
      if (!c.pending.length && c.done) conns.delete(c.id);
    }
    function queue(c, type, bytes) {
      // a big message goes in pieces of at most half the ring (a TCP stream has no message edges)
      var most = c.cap >> 1;
      if (bytes && bytes.length > most) {
        for (var i = 0; i < bytes.length; i += most) c.pending.push({ type: type, bytes: bytes.subarray(i, i + most) });
      } else c.pending.push({ type: type, bytes: bytes });
      flush(c);
    }
    onmessage = function (e) {
      var m = e.data, c = conns.get(m.id);
      if (m.op === 'open') {
        c = { id: m.id, h: new Int32Array(m.sab, 0, 4), ring: new Uint8Array(m.sab, HEAD), cap: m.sab.byteLength - HEAD,
          pending: [], waiting: false, done: false, ws: null };
        conns.set(m.id, c);
        try {
          c.ws = m.protocols ? new WebSocket(m.url, m.protocols) : new WebSocket(m.url);
        } catch (err) { queue(c, ERROR); queue(c, CLOSE); c.done = true; return; }
        c.ws.binaryType = 'arraybuffer';
        c.ws.onopen = function () { queue(c, OPEN); };
        c.ws.onmessage = function (ev) {
          var d = typeof ev.data === 'string' ? new TextEncoder().encode(ev.data) : new Uint8Array(ev.data);
          if (d.length) queue(c, MESSAGE, d);
        };
        c.ws.onerror = function () { queue(c, ERROR); };
        c.ws.onclose = function () { c.done = true; queue(c, CLOSE); };
      } else if (m.op === 'send') {
        if (c && c.ws && c.ws.readyState === 1) c.ws.send(m.data);
      } else if (m.op === 'close') {
        if (c && c.ws) { try { c.ws.close(); } catch (err) {} }
        if (c) { c.done = true; if (!c.pending.length) conns.delete(c.id); }
      }
    };
  }

  // ---- the page: a stand-in WebSocket for SOCKFS, fed from the ring ----
  var RING = 1 << 18, HEAD = 16;   // 256 KB per connection; more waits in the worker until the page has read
  var worker = new Worker(URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')()'], { type: 'text/javascript' })));
  var live = new Map(), nextId = 1;
  var log = function (s) { if (Module.netLog) Module.netLog(s); };

  // An address on the house network (a Klipper printer's Moonraker, a Prusa printer's PrusaLink, typed in the
  // slicer's printer settings as 192.168.1.50, voron.local or voron) is not reachable from the slicer host. Those
  // connections go to the home helper instead (farm-helper/bambu-home/tunnel.mjs): the same address Bambu Studio's
  // printer link uses (index.html?bridge=, default ws://localhost:8770; away from home the box relay's
  // wss://.../tab?key=...), with to=<host>:<port>. The helper opens the TCP connection on the house network.
  function onHouseNetwork(host) {
    var h = host.toLowerCase(), v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
    if (v4) {
      var a = +v4[1], b = +v4[2];
      return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    }
    return h === 'localhost' || /\.local$/.test(h) || /\.lan$/.test(h) || /\.home\.arpa$/.test(h) || h.indexOf('.') < 0;
  }
  function houseBridge() {
    var q = typeof location !== 'undefined' && new URLSearchParams(location.search).get('bridge');
    var b = Module.lanBridge || q || 'ws://localhost:8770';
    // the helper's door (farm-helper/bambu-home/pairing.mjs): a tunnel line needs the token this browser got when it
    // paired (lan-printer-link.js keeps it); without one the helper refuses the line
    try {
      var t = typeof localStorage !== 'undefined' && localStorage.getItem('b3d-helper-token');
      if (t) { var u = new URL(b, location.href); u.searchParams.set('token', t); return u.href; }
    } catch (e) {}
    return b;
  }
  function relayUrl(url) {
    var m = /^wss?:\/\/([^\/:?#]+):(\d+)\/?$/.exec(String(url));
    if (!m) return String(url);
    if (onHouseNetwork(m[1])) {
      // the person reached for a printer on their own network (the box below, when this browser is not paired yet)
      try { if (typeof B3DHelper !== 'undefined' && B3DHelper) B3DHelper.reaching(); } catch (e) {}
      var b = new URL(houseBridge(), location.href);
      b.searchParams.set('to', m[1] + ':' + m[2]);
      return b.href;
    }
    var u = new URL(Module.relayUrl || 'relay', location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.searchParams.set('to', m[1] + ':' + m[2]);
    return u.href;
  }

  function WorkerSocket(url, protocols) {
    this.url = String(url);
    this.readyState = 0;
    this.binaryType = 'arraybuffer';
    this.protocol = '';
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    this.id = nextId++;
    var sab = new SharedArrayBuffer(HEAD + RING);
    this.h = new Int32Array(sab, 0, 4);
    this.ring = new Uint8Array(sab, HEAD);
    live.set(this.id, this);
    log('connect ' + this.url);
    worker.postMessage({ op: 'open', id: this.id, url: relayUrl(url), protocols: protocols, sab: sab });
  }
  WorkerSocket.CONNECTING = WorkerSocket.prototype.CONNECTING = 0;
  WorkerSocket.OPEN = WorkerSocket.prototype.OPEN = 1;
  WorkerSocket.CLOSING = WorkerSocket.prototype.CLOSING = 2;
  WorkerSocket.CLOSED = WorkerSocket.prototype.CLOSED = 3;
  WorkerSocket.prototype.send = function (data) {
    if (this.readyState !== 1) throw new DOMException('not open', 'InvalidStateError');
    var copy = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer
      : new Uint8Array(data).slice().buffer;
    worker.postMessage({ op: 'send', id: this.id, data: copy }, [copy]);
  };
  WorkerSocket.prototype.close = function () {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    worker.postMessage({ op: 'close', id: this.id });
  };
  // Apply every event the worker has written so far, in order.
  WorkerSocket.prototype.pump = function () {
    if (this.pumping) return;   // a handler below polled this socket again
    this.pumping = true;
    try { this.drain(); } finally { this.pumping = false; }
  };
  WorkerSocket.prototype.drain = function () {
    var h = this.h, ring = this.ring, cap = RING;
    for (;;) {
      var r = Atomics.load(h, 1), w = Atomics.load(h, 0);
      if (r === w) return;
      var at = r & (cap - 1), head = new Uint8Array(5);
      for (var i = 0; i < 5; i++) head[i] = ring[(at + i) & (cap - 1)];
      var type = head[0], n = head[1] | (head[2] << 8) | (head[3] << 16) | (head[4] << 24);
      var data = null;
      if (n) {
        data = new Uint8Array(n);
        var from = (at + 5) & (cap - 1), first = Math.min(n, cap - from);
        data.set(ring.subarray(from, from + first), 0);
        if (first < n) data.set(ring.subarray(0, n - first), first);
      }
      Atomics.store(h, 1, (r + 5 + n) | 0);
      Atomics.notify(h, 1);
      if (type === 1) { this.readyState = 1; if (this.onopen) this.onopen({}); }
      else if (type === 2) { if (this.onmessage) this.onmessage({ data: data.buffer }); }
      else if (type === 3) { log('error ' + this.url); if (this.onerror) this.onerror({}); }
      else if (type === 4) {
        this.readyState = 3; live.delete(this.id);
        log('closed ' + this.url);
        if (this.onclose) this.onclose({});
      }
    }
  };
  worker.onmessage = function (e) { var s = live.get(e.data); if (s) s.pump(); };

  (Module.preRun = [].concat(Module.preRun || [])).unshift(function () {
    if (typeof SOCKFS === 'undefined' || !SOCKFS.websocket_sock_ops) return;
    var ops = SOCKFS.websocket_sock_ops;
    // SOCKFS makes its WebSocket by the global name: hand it the stand-in for that one call.
    var createPeer = ops.createPeer;
    ops.createPeer = function () {
      var Native = globalThis.WebSocket;
      globalThis.WebSocket = WorkerSocket;
      try { return createPeer.apply(this, arguments); } finally { globalThis.WebSocket = Native; }
    };
    // Every socket operation sees the connection as it is now, even on a page blocked inside a network call.
    ['poll', 'ioctl', 'close', 'connect', 'getname', 'sendmsg', 'recvmsg'].forEach(function (k) {
      var f = ops[k];
      ops[k] = function (sock) {
        for (var key in sock.peers) { var s = sock.peers[key].socket; if (s && s.pump) s.pump(); }
        return f.apply(this, arguments);
      };
    });
  });
})();

// ---- THE HOME HELPER: the line that pairs this browser with it, and the "Connect your printer" box (all three slicers) ----
// A page reaches printers on the person's own network through the Boolean3d helper (farm-helper/bambu-home): Bambu Studio
// and OrcaSlicer through their printer link (agent/lan-printer-link.js: one line carries the program's printer protocol), PrusaSlicer
// through the tunnel above (houseBridge: one line per connection). Either way the helper answers only a browser paired
// with it, so the pairing and the box live here, once:
//
// THE HELPER'S DOOR (farm-helper/bambu-home/pairing.mjs): the helper answers only our pages and only a browser paired
// with it once (by the download's secret, or the code the helper shows). This page keeps that token
// (localStorage 'b3d-helper-token', per origin) and puts it on every line to the helper (houseBridge reads it too).
//
//   B3DHelper.line(o): one line to the helper and its box. o (all optional):
//     text(s) / binary(bytes, ws)   what the helper says that is not about pairing (Bambu: to the program)
//     hello                          extra hello fields        paired(ws)   after this browser pairs (Bambu: its printer search again)
//     background(r)                  a request the program makes by itself (sent only once the person asks)
//     quiet(r)                       a request that is not the person asking for a printer
//     heard(r) -> {id, name, model, ip}   a printer the helper heard (listed in the box)   connected(r)  the printer linked: the box closes
//     pick / pickNone / looking      the box's words for step 3 (with printers found / none / while looking)
//   B3DHelper.house()               the line in use (made for PrusaSlicer on its first house-network link when none exists)
var B3DHelper = (typeof document === 'undefined' || (typeof ENVIRONMENT_IS_PTHREAD !== 'undefined' && ENVIRONMENT_IS_PTHREAD)) ? null : (function () {
  let current = null;
  function line(o) {
  o = o || {};
    const url = new URLSearchParams(location.search).get('bridge') || 'ws://localhost:8770';
    const TOKEN = 'b3d-helper-token';
    // Where the helper is downloaded from (scripts/helper/pack.mjs makes these; latest/ always holds the newest).
    // ?helper-downloads=/<path>/ points at a copy on this page's own site (a test copy); only a path on this site, so a
    // link can never send a person's download elsewhere.
    const DOWNLOADS = (function () {
      const d = new URLSearchParams(location.search).get('helper-downloads');
      return d && /^\/[^\/\\]/.test(d) ? location.origin + d.replace(/\/?$/, '/') : 'https://slicers.boolean3d.com/helper/latest/';
    })();
    const SYSTEMS = [
      ['win-x64', 'Windows'], ['darwin-arm64', 'Mac (Apple silicon)'], ['darwin-x64', 'Mac (Intel)'],
      ['linux-x64', 'Linux'], ['linux-arm64', 'Raspberry Pi'],
    ];
    let ws = null;
    let queue = []; // sent before the link was open
    let retry = null;
    // LOCAL NETWORK (z49): a page reaching the home network makes the browser ask the person first (Chrome: "wants to
    // access other apps and services on this device"). So the page never reaches it on its own: the program's start (its
    // agent start, the printer search at start) waits until the person asks for a printer (Device tab, the printer list,
    // Print/Send: asked() from the program; or any request of theirs: connect, Connect by IP, send, print), unless this
    // browser has linked to the helper before (the person said yes then; the browser remembers it).
    let personAsked = false;
    try { personAsked = localStorage.getItem('b3d-lan-linked') === '1'; } catch (e) {}
    if (new URLSearchParams(location.search).get('bridge')) personAsked = true; // an address naming the helper: their own setup
    if (token()) personAsked = true; // paired before: the person gave the browser's permission then
    let parked = null; // the program's background request (Bambu: its printer search), sent once the person asks
    const background = (m) => { if (typeof m !== 'string' || !o.background) return false; try { return o.background(JSON.parse(m)); } catch (e) { return false; } };
    let opened = false;   // the link opened at least once (the helper is there)
    let helper = null;    // {id, name, version, paired} from the helper's hello answer
    let wants = false;    // the person asked for a printer (connect, Connect by IP, send, print): the box may show
    function token() { try { return localStorage.getItem(TOKEN) || ''; } catch (e) { return ''; } }
    function lineUrl() {
      const t = token();
      if (!t) return url;
      try { const u = new URL(url, location.href); u.searchParams.set('token', t); return u.href; } catch (e) { return url; }
    }
    // ACCOUNT CHECK: opening and slicing need no account; reaching your own printer does, on the public
    // host only (boolean3d.com and its subdomains; ?b3d-account-check=1 turns it on elsewhere, for walks). Signed in =
    // the page holds the Slicers page's account key (localStorage 'b3d-slicer-home', home-folder-sync.js readLink). Without it
    // the page never links to the helper: a printer request is answered at once with the reason, and a small box offers
    // the Slicers page (in a new tab, so the plate stays).
    const accountCheck = /(^|\.)boolean3d\.com$/.test(location.hostname) || new URLSearchParams(location.search).get('b3d-account-check') === '1';
    function signedIn() {
      try { const l = JSON.parse(localStorage.getItem('b3d-slicer-home') || 'null'); return !!(l && l.key && /^https?:\/\//.test(l.door || '')); }
      catch (e) { return false; }
    }
    // OVER THE PROGRAM: the program takes its keys from the window and its mouse from the document (owx/src/wasm/app.cpp
    // 870-912: keydown, keyup, keypress on window; mouse and touch on document; each answered with preventDefault). A
    // box of ours sits over it, so what happens in the box must stop there: a key typed in a box's field would reach the
    // program as a character (its Access Code field took the helper code, printer-real run 3) and the browser would
    // drop it from the field (preventDefault); a click on the box would land on the window under it.
    function keepKeys(input) {
      ['keydown', 'keyup', 'keypress'].forEach(function (t) { input.addEventListener(t, function (e) { e.stopPropagation(); }); });
    }
    function shield(node) {
      ['mousedown', 'mouseup', 'click', 'dblclick', 'mousemove', 'contextmenu', 'wheel', 'touchstart', 'touchend', 'touchmove', 'pointerdown', 'pointerup']
        .forEach(function (t) { node.addEventListener(t, function (e) { e.stopPropagation(); }); });
    }
    const SIGN_IN = 'Sign in to Boolean3d to connect your printer';
    // SIGNING IN FROM HERE: "Sign in" opens the site's Slicers page as #/slicers?back=1 in a new tab, this tab as its
    // opener. Signed in there (or once the person signs in), that page posts this browser's key here as a message and
    // closes itself (js/share/SlicersPage.js backToSlicer); the key is kept as the Slicers page's link would have left it
    // (home-folder-sync.js readLink: localStorage 'b3d-slicer-home') and what the person asked for goes on. Pinned both ways:
    // the site posts to the slicer host's origin only, and this page takes the key from the site's origin only (on the
    // public host always https://boolean3d.com; elsewhere ?b3d-site= names the test site, for walks). No second slicer
    // tab, no landing on My files.
    const SITE = /(^|\.)boolean3d\.com$/.test(location.hostname) ? 'https://boolean3d.com'
      : (new URLSearchParams(location.search).get('b3d-site') || 'https://boolean3d.com').replace(/\/+$/, '');
    let signInWanted = false;
    window.addEventListener('message', function (e) {
      if (e.origin !== SITE || e.source === window) return;
      const d = e.data;
      if (!d || d.type !== 'b3d-slicer-home' || typeof d.key !== 'string' || !d.key || !/^https?:\/\//.test(d.door || '')) return;
      try { localStorage.setItem('b3d-slicer-home', JSON.stringify({ key: d.key, door: d.door, anon: typeof d.anon === 'string' ? d.anon : '' })); } catch (err) { return; }
      if (box && box.isConnected) box.remove();
      if (signInWanted) { signInWanted = false; offer(); }
    });
    let box = null;
    function askSignIn() {
      signInWanted = true;
      if (box && box.isConnected) return;
      box = document.createElement('div');
      box.id = 'b3d-sign-in-printer';
      box.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;gap:12px;' +
        'align-items:center;padding:10px 14px;background:#fff;color:#222;border:1px solid #ccc;border-radius:6px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.18);font:14px system-ui,sans-serif';
      const words = document.createElement('span'); words.textContent = SIGN_IN;
      const go = document.createElement('a'); go.textContent = 'Sign in'; go.href = SITE + '/#/slicers?back=1'; go.target = 'b3d-sign-in';
      go.onclick = function (ev) { ev.preventDefault(); window.open(go.href, 'b3d-sign-in'); };   // opener kept: the page answers to this tab
      go.style.cssText = 'padding:5px 12px;background:#00ae42;color:#fff;border-radius:4px;text-decoration:none';
      const x = document.createElement('button'); x.textContent = '×'; x.title = 'Close';
      x.style.cssText = 'border:0;background:none;font-size:18px;cursor:pointer;color:#666';
      x.onclick = function () { box.remove(); };
      box.append(words, go, x);
      shield(box);
      document.body.appendChild(box);
    }
    // The program's own background calls (the printer search at start, a disconnect) are dropped quietly; the box
    // answers what the person asked for (connect, Connect by IP, send, print).
    function refused(m) {
      if (typeof m !== 'string') return;
      let r; try { r = JSON.parse(m); } catch (e) { return; }
      if (!r || r.op === 'discover' || r.op === 'disconnect') return;
      askSignIn();
      if (r.id !== undefined && o.text) o.text(JSON.stringify({ id: r.id, stage: 'error', error: SIGN_IN, code: -1 }));
    }

    // ── THE HELPER BOX: download, open, linked by itself, pick the printer ──────────────────────────
    // Shown the moment the person asks for a printer (Device tab, the printer list, Print/Send: asked() from the program,
    // or a request of theirs), before they type anything, while this browser is not paired with a helper. Steps, in the
    // person's words: 1 download (one button, their system picked; the others behind "Other systems"), 2 open it (the page
    // keeps looking and links by itself), 3 the printers the helper found (pick one in the program's printer list, type
    // its access code). Never at start-up by itself.
    // LINKED BY ITSELF (farm-helper/bambu-home/pairing.mjs 2b): the download is saved under a one-time secret this page
    // makes (boolean3d-helper-<secret>.exe: the link's download name, so the address fetched carries no secret and no
    // server sees it); the helper finds it in its own name and this page's line pairs with it. The secret stays in this
    // browser (localStorage 'b3d-helper-secret', per origin) until it pairs. Where that cannot work (a download from
    // another address, a renamed file, the helper on another computer) the helper's 6-letter code is the way.
    const SECRET = 'b3d-helper-secret';
    const SECRET_LETTERS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // pairing.mjs CODE_LETTERS
    const SOURCE = 'https://github.com/boolean3d/slicers.wasm/tree/main/helper';
    const found = new Map();   // dev_id -> {name, model, ip}: printers the helper heard (paired lines only)
    let hbox = null, hstep = null, hparts = null, hideAt = null, looking = null;
    function secret() { try { return localStorage.getItem(SECRET) || ''; } catch (e) { return ''; } }
    function newSecret() {
      const b = new Uint8Array(12); crypto.getRandomValues(b);
      const s = Array.from(b, function (v) { return SECRET_LETTERS[v % SECRET_LETTERS.length]; }).join('');
      try { localStorage.setItem(SECRET, s); } catch (e) {}
      return s;
    }
    function likelySystem() {
      const ua = navigator.userAgent || '';
      if (/Windows/i.test(ua)) return 'win-x64';
      if (/Macintosh/i.test(ua)) return 'darwin-arm64';
      if (/Linux/i.test(ua) && /aarch64|arm/i.test(ua)) return 'linux-arm64';
      if (/Linux/i.test(ua)) return 'linux-x64';
      return 'win-x64';
    }
    // Windows gets the program itself (one click runs it); the others a zip (Mac and Linux keep its run permission).
    const fileOf = function (system) { return 'boolean3d-helper-' + system + (system === 'win-x64' ? '.exe' : '.zip'); };
    const css = {
      box: 'position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:2147483000;width:min(460px,calc(100vw - 32px));' +
        'padding:16px 18px;background:#fff;color:#222;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);' +
        'font:14px system-ui,sans-serif;line-height:1.45',
      big: 'display:block;text-align:center;padding:10px 14px;margin:10px 0 4px;background:#00ae42;color:#fff;border-radius:6px;' +
        'text-decoration:none;font-weight:600;font-size:15px',
      small: 'color:#2563eb;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;font:13px system-ui,sans-serif',
      muted: 'margin:6px 0 0;color:#555;font-size:13px',
      steps: 'display:flex;gap:6px;margin:10px 0 2px;font-size:12px;color:#888',
      input: 'flex:1;padding:6px 8px;font:16px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;border:1px solid #bbb;' +
        'border-radius:4px;color:#222;background:#fff',
      button: 'padding:6px 14px;background:#00ae42;color:#fff;border:0;border-radius:4px;cursor:pointer;font:14px system-ui,sans-serif',
    };
    function el(tag, style, text) { const e = document.createElement(tag); if (style) e.style.cssText = style; if (text) e.textContent = text; return e; }
    function helperBox() {
      if (hbox && hbox.isConnected) return hbox;
      hbox = el('div', css.box); hbox.id = 'b3d-helper-box';
      const title = el('div', 'font-weight:600;font-size:16px;margin-right:24px', 'Connect your printer');
      const x = el('button', 'position:absolute;top:8px;right:10px;border:0;background:none;font-size:20px;cursor:pointer;color:#666', '×');
      x.title = 'Close'; x.onclick = function () { hbox.remove(); hstep = null; };
      hparts = el('div');
      hbox.append(title, x, hparts);
      shield(hbox);
      document.body.appendChild(hbox);
      return hbox;
    }
    function progress(n) {   // 1 Download · 2 Open it · 3 Pick your printer
      const p = el('div', css.steps);
      ['Download', 'Open it', 'Pick your printer'].forEach(function (w, i) {
        const s = el('span', i + 1 === n ? 'color:#00ae42;font-weight:600' : (i + 1 < n ? 'color:#222' : ''), (i + 1) + ' ' + w);
        p.appendChild(s);
        if (i < 2) p.appendChild(el('span', '', '›'));
      });
      return p;
    }
    // The code, typed: for a helper on another computer, or when it did not link by itself.
    function codeRow(hint) {
      const wrap = el('div');
      if (hint) wrap.appendChild(el('p', 'margin:8px 0 4px', hint));
      const row = el('div', 'display:flex;gap:8px;align-items:center;margin-top:6px');
      const input = el('input', css.input); input.placeholder = 'Code from the helper'; input.maxLength = 7; input.autocapitalize = 'characters'; input.spellcheck = false;
      const go = el('button', css.button, 'Pair');
      const status = el('p', css.muted);
      const pairNow = function () {
        const code = (input.value || '').toUpperCase().replace(/[\s-]/g, '');
        if (code.length < 6) { status.textContent = 'The code is 6 letters and digits, as the helper shows it.'; return; }
        if (!ws || ws.readyState !== 1) { status.textContent = 'The helper is not reachable yet. Is it open? This page looks for it at ' + url + '.'; open(); return; }
        status.textContent = 'Pairing…'; go.disabled = true;
        ws.send(JSON.stringify({ op: 'pair', code: code, name: browserName() }));
      };
      input.onkeydown = function (e) { if (e.key === 'Enter') pairNow(); };
      keepKeys(input);
      go.onclick = pairNow;
      row.append(input, go);
      wrap.append(row, status);
      wrap.wrong = function (words) { status.textContent = words; go.disabled = false; input.select(); };
      return wrap;
    }
    let codeBox = null;
    let quietAt = null, quietLong = false, searchBox = null, searchId = 9e8;
    // Chrome's permission for a page to reach this computer and the home network (Local network access; Chrome 142 named
    // it local-network-access, later loopback-network and local-network): 'prompt' = its Allow/Block bubble is coming
    // with the first link to the helper; 'denied' = blocked, the link never opens and the box says how to undo it.
    let lna = null;
    function checkLna() {
      if (!navigator.permissions || !navigator.permissions.query) return;
      const names = ['loopback-network', 'local-network-access', 'local-network'];
      (function next(i) {
        if (i >= names.length) return;
        navigator.permissions.query({ name: names[i] }).then(function (st) {
          lna = st.state;
          st.onchange = function () {
            lna = st.state;
            if (lna === 'granted' && hstep === 'blocked') { showHelperBox(secret() || token() ? 'open' : 'download'); open(); }
            else if (lna === 'denied' && boxUp()) showHelperBox('blocked');
          };
        }, function () { next(i + 1); });
      })(0);
    }
    checkLna();
    const LNA_ASK = 'Chrome will ask to let this page talk to the helper on this computer: press Allow.';
    // "Search my network" (the helper knocks on the printer port at this computer's own network's addresses) and the
    // printer's address, typed (the helper asks that one address only). The printers found come in the list as heard ones do.
    function searchRow() {
      const wrap = el('div', 'margin-top:10px;padding-top:8px;border-top:1px solid #eee');
      wrap.appendChild(el('p', 'margin:0 0 4px', 'Not showing up? The helper can look for it.'));
      const b = el('button', css.button, 'Search my network');
      wrap.appendChild(b);
      wrap.appendChild(el('p', css.muted, 'The helper asks each address on your home network whether it is a printer. It takes about 20 seconds.'));
      wrap.appendChild(el('p', 'margin:10px 0 0', 'Or type the printer\'s address (on its screen, under its network settings):'));
      const row = el('div', 'display:flex;gap:8px;align-items:center;margin-top:6px');
      const input = el('input', css.input.replace('text-transform:uppercase;', '')); input.placeholder = '192.168.1.50'; input.inputMode = 'decimal'; input.spellcheck = false;
      const go = el('button', css.button, 'Find it');
      row.append(input, go);
      const status = el('p', css.muted);
      wrap.append(row, status);
      const ask = function (ip) {
        if (!ws || ws.readyState !== 1) { status.textContent = 'The helper is not reachable. Is it still open?'; return; }
        if (ip !== null && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { status.textContent = 'An address looks like 192.168.1.50.'; return; }
        status.textContent = ip ? 'Asking ' + ip + '…' : 'Searching your network…'; b.disabled = go.disabled = true;
        ws.send(JSON.stringify(Object.assign({ op: 'search', id: ++searchId }, ip ? { ip: ip } : {})));
      };
      b.onclick = function () { ask(null); };
      go.onclick = function () { ask((input.value || '').trim()); };
      input.onkeydown = function (e) { if (e.key === 'Enter') go.onclick(); };
      keepKeys(input);
      wrap.done = function (r) {
        b.disabled = go.disabled = false;
        if (!r.ok) status.textContent = r.error || 'The helper could not search. Is it the newest one? Download it again.';
        else if (!r.found) status.textContent = r.ip ? 'No printer answered at ' + r.ip + '. Is it on, in LAN-only mode, at that address?' : 'No printer answered. Is it on, in LAN-only mode, and on the same network as this computer?';
      };
      searchBox = wrap;
      return wrap;
    }
    function showHelperBox(step, why) {
      if (step === hstep && hbox && hbox.isConnected && step !== 'printers' && step !== 'allow') return;
      helperBox();
      clearTimeout(hideAt); clearTimeout(looking);
      hstep = step; codeBox = null;
      hparts.textContent = '';
      const add = function (e) { hparts.appendChild(e); return e; };
      const system = likelySystem();
      const named = SYSTEMS.find(function (s) { return s[0] === system; })[1];
      if (step === 'download') {
        add(progress(1));
        add(el('p', 'margin:8px 0 0', 'Your printer is on your own network, and a web page cannot reach it by itself. A small helper program on this computer does that.'));
        const a = add(el('a', css.big, 'Download the helper for ' + named));
        a.href = DOWNLOADS + fileOf(system); a.rel = 'noopener';
        a.onclick = function () { downloaded(system, a); };
        const src = add(el('a', 'display:block;text-align:center;font-size:13px;color:#2563eb;margin:2px 0 8px', 'Read the code'));
        src.href = SOURCE; src.target = '_blank'; src.rel = 'noopener';
        const others = add(el('p', css.muted));
        const more = el('button', css.small, 'Other systems');
        const list = el('span', 'display:none');
        more.onclick = function () { more.style.display = 'none'; list.style.display = ''; };
        SYSTEMS.filter(function (s) { return s[0] !== system; }).forEach(function (s, i) {
          if (i) list.appendChild(document.createTextNode(' · '));
          const o = el('a', 'color:#2563eb', s[1]); o.href = DOWNLOADS + fileOf(s[0]); o.rel = 'noopener';
          o.onclick = function () { downloaded(s[0], o); };
          list.appendChild(o);
        });
        others.append(more, list);
        add(el('p', css.muted, 'The helper talks to your printer and to this page only.'));
      } else if (step === 'open') {
        add(progress(2));
        const how = {
          'win-x64': 'Open the helper from your downloads (the browser\'s download list). Windows may say it protected your PC: choose More info, then Run anyway.',
          'darwin-arm64': 'Open the zip from your downloads, then the boolean3d-helper inside it. The first time, right-click it and choose Open.',
          'darwin-x64': 'Open the zip from your downloads, then the boolean3d-helper inside it. The first time, right-click it and choose Open.',
        }[hbox.system || system] || 'Unzip it and run boolean3d-helper in a terminal.';
        add(el('p', 'margin:8px 0 0', how));
        add(el('p', 'margin:10px 0 0;font-weight:600', 'Looking for the helper…'));
        add(el('p', css.muted, 'This page links to it by itself as soon as it runs. Keep this tab open.'));
        if (lna === 'prompt') add(el('p', 'margin:8px 0 0;font-weight:600', LNA_ASK));
        const other = add(el('p', css.muted));
        const b = el('button', css.small, 'The helper is on another computer, or shows a code');
        b.onclick = function () { other.remove(); codeBox = add(codeRow('Type the code the helper shows (in its window, or at http://localhost:8770 on that computer).')); };
        other.appendChild(b);
      } else if (step === 'linking') {
        add(progress(2));
        add(el('p', 'margin:10px 0 0;font-weight:600', 'Found the helper' + (helper && helper.name ? ' on ' + helper.name : '') + '. Linking…'));
      } else if (step === 'blocked') {
        add(progress(2));
        add(el('p', 'margin:8px 0 0;font-weight:600;color:#b45309', 'Chrome is blocking this page from talking to the helper on this computer.'));
        add(el('p', 'margin:6px 0 0', 'To allow it: click the icon left of the address bar, then Site settings, and set Local network access to Allow. Then reload this page.'));
      } else if (step === 'code') {
        add(progress(2));
        if (lna === 'prompt') add(el('p', 'margin:8px 0 0;font-weight:600', LNA_ASK));
        codeBox = add(codeRow('The helper is running' + (helper && helper.name ? ' on ' + helper.name : '') + '. Type the code it shows (in its window, or at http://localhost:8770 on that computer).'));
      } else if (step === 'allow' || step === 'allowing') {
        add(el('p', 'margin:8px 0 0;font-weight:600', 'Let this slicer control your printer?'));
        add(el('p', 'margin:6px 0 0', 'That is moving the head, heating, the light and its settings. Printing, pausing and stopping a print need no yes.'));
        if (typeof why === 'string') add(el('p', css.muted, why));
        const row = add(el('div', 'display:flex;gap:8px;align-items:center;margin-top:10px'));
        const yes = el('button', css.button, step === 'allowing' ? 'Asking the helper…' : 'Yes, let it'); yes.disabled = step === 'allowing';
        const no = el('button', css.small, 'Not now');
        yes.onclick = function () { if (!ws || ws.readyState !== 1) { showHelperBox('allow', 'The helper is not reachable. Is it still open?'); return; } ws.send(JSON.stringify({ op: 'allow', what: 'control' })); showHelperBox('allowing'); };
        no.onclick = function () { hbox.remove(); hstep = null; };
        row.append(yes, no);
      } else if (step === 'printers') {
        add(progress(3));
        add(el('p', 'margin:8px 0 0;color:#00ae42;font-weight:600', 'Linked with the helper' + (helper && helper.name ? ' on ' + helper.name : '') + '.'));
        if (!found.size) {
          if (o.looking) {
            add(el('p', 'margin:8px 0 0;font-weight:600', 'Looking for printers on your network…'));
            add(el('p', css.muted, o.looking));
          }
          if (o.pickNone) add(el('p', 'margin:8px 0 0', o.pickNone));
          // the helper's own ask found nothing after a while (a firewall can hide the printers' announcements): the
          // person may ask it to look harder, or type the printer's address
          if (o.search) { if (quietLong) add(searchRow()); else { clearTimeout(quietAt); quietAt = setTimeout(function () { quietLong = true; if (hstep === 'printers' && boxUp() && !found.size) showHelperBox('printers'); }, 10000); } }
        } else {
          add(el('p', 'margin:8px 0 4px', 'Printers on your network:'));
          const ul = add(el('ul', 'margin:0 0 6px;padding-left:20px'));
          for (const p of found.values()) {
            const li = el('li', 'margin:2px 0'); li.appendChild(el('b', '', p.name));
            li.appendChild(el('span', 'color:#666', '  ' + [p.model, p.ip].filter(Boolean).join(' · ')));
            ul.appendChild(li);
          }
          add(el('p', 'margin:6px 0 0', o.pick));
        }
      }
    }
    // A download link was clicked: save the file under this browser's one-time secret (a link's download name is kept
    // only for an address of this page's own site; elsewhere the file keeps its plain name and the code is the way).
    function downloaded(system, a) {
      a.download = 'boolean3d-helper-' + (secret() || newSecret()) + (system === 'win-x64' ? '.exe' : '.zip');
      hbox.system = system;
      personAsked = true;
      setTimeout(function () { showHelperBox('open'); open(); }, 300);
    }
    // The person asked for a printer: show where they stand, before they type anything.
    function offer() {
      if (accountCheck && !signedIn()) return askSignIn();
      wants = true;
      if (helper && helper.paired) return;
      if (token() && !(helper && !helper.paired)) return open();   // paired before: the line will say if not any more
      open();
      clearTimeout(looking);
      looking = setTimeout(function () {
        if (helper && helper.paired) return;
        if (!ws || ws.readyState !== 1) showHelperBox(lna === 'denied' ? 'blocked' : secret() || token() ? 'open' : 'download');
      }, 1500);
    }
    function browserName() {
      const ua = navigator.userAgent || '';
      const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
      const o = /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
      return (b + (o ? ' on ' + o : '')).slice(0, 60);
    }
    const boxUp = function () { return !!(hbox && hbox.isConnected); };
    function hideSoon() { clearTimeout(hideAt); hideAt = setTimeout(function () { if (boxUp()) hbox.remove(); hstep = null; }, 1500); }
    // What the helper says about itself and this line: handled here, never delivered to the program.
    function fromHelper(r) {
      if (r.ev === 'helper') {
        helper = r;
        if (r.paired) { if (boxUp() && hstep !== 'printers') hbox.remove(); return true; }
        if (secret() && r.bySecret) {   // the helper this browser downloaded: link by itself
          if (boxUp() || wants) showHelperBox('linking');
          ws.send(JSON.stringify({ op: 'pair', code: secret(), name: browserName(), by: 'download' }));
        } else if (boxUp() || wants) showHelperBox('code');
        return true;
      }
      if (r.ev === 'pair') { if ((boxUp() || wants) && hstep !== 'linking') showHelperBox('code'); return true; }
      if (r.ev === 'searched') { if (searchBox && searchBox.isConnected) searchBox.done(r); return true; }
      // CONTROL, ASKED ONCE: a paired browser watches and prints from the start; the first time the program moves, heats
      // or sets something on the printer, the helper keeps that message and asks (ev needs); yes = op allow, kept in the
      // helper for this browser, the kept message goes to the printer. Printing, pausing and stopping need no yes.
      if (r.ev === 'needs') { if (r.what === 'control' && hstep !== 'allowing') showHelperBox('allow'); return true; }
      if (r.ev === 'allowed') {
        if (r.ok) { if (boxUp() && (hstep === 'allow' || hstep === 'allowing')) { hbox.remove(); hstep = null; } }
        else if (hstep === 'allowing') showHelperBox('allow', r.error || 'The helper could not keep that. Is it the newest one?');
        return true;
      }
      if (r.ev === 'paired') {
        if (r.ok && r.token) {
          try { localStorage.setItem(TOKEN, r.token); localStorage.removeItem(SECRET); } catch (e) {}
          if (helper) helper.paired = true;
          if (r.helper && helper) helper.name = r.helper.name || helper.name;
          showHelperBox('printers');
          if (o.paired) o.paired(ws);
        } else if (r.ok) {
          if (boxUp() && hstep !== 'printers') hbox.remove();
        } else if (hstep === 'linking') {
          // the download's secret did not take (used, or this is another helper): the code
          try { localStorage.removeItem(SECRET); } catch (e) {}
          showHelperBox('code');
        } else if (codeBox) codeBox.wrong(r.error || 'That is not the code the helper shows.');
        return true;
      }
      // printers the helper heard: listed in the box, and delivered to the program as always
      const f = o.heard && o.heard(r);
      if (f) {
        const was = found.has(f.id);
        found.set(f.id, f);
        if (!was && hstep === 'printers' && boxUp()) showHelperBox('printers');
      }
      // the printer linked (the program has it): the box has done its job
      if (o.connected && o.connected(r) && hstep === 'printers' && boxUp()) hideSoon();
      return false;
    }
    // Something the person asked for, which needs the helper: remember it, and if the helper is not there, say so.
    function wanted(m) {
      if (typeof m !== 'string') return;
      let r; try { r = JSON.parse(m); } catch (e) { return; }
      if (!r || (o.quiet && o.quiet(r))) return;
      wants = true;
      if (!opened) showHelperBox(secret() ? 'open' : 'download');
      else if (helper && !helper.paired && hstep !== 'linking') showHelperBox('code');
    }

    function open() {
      if (!personAsked) return;
      if (accountCheck && !signedIn()) return;
      if (ws && ws.readyState <= 1) return;
      ws = new WebSocket(lineUrl());
      ws.binaryType = 'arraybuffer';
      ws.onopen = function () {
        opened = true;
        console.log('b3d-lan: helper linked at ' + url);
        try { localStorage.setItem('b3d-lan-linked', '1'); } catch (e) {}
        ws.send(JSON.stringify(Object.assign({ op: 'hello', name: browserName() }, o.hello || {})));
        const q = queue; queue = [];
        for (const m of q) ws.send(m);
      };
      ws.onmessage = function (e) {
        if (typeof e.data === 'string') {
          let r = null; try { r = JSON.parse(e.data); } catch (x) {}
          if (r && fromHelper(r)) return;
          if (o.text) o.text(e.data);
          return;
        }
        if (o.binary) o.binary(new Uint8Array(e.data), ws);
      };
      ws.onclose = function () {
        helper = null;
        clearTimeout(retry);
        console.log('b3d-lan: helper link closed, retrying');
        // blocked by Chrome: say so and how to undo it, never sit on "looking"
        if (lna === 'denied' && (boxUp() || wants)) showHelperBox('blocked');
        // looking for the helper after a download: a shorter wait, so the page links right after it starts
        retry = setTimeout(open, hstep === 'open' ? 1500 : 3000);
      };
      ws.onerror = function () {};
    }
    function send(m) {
      if (!personAsked) {
        if (background(m)) { if (JSON.parse(m).op === 'discover') parked = m; return; }
        personAsked = true;
      }
      if (accountCheck && !signedIn()) return refused(m);
      wanted(m);
      if (ws && ws.readyState === 1) ws.send(m);
      else { queue.push(m); open(); }
    }
    return {
      open: open,
      send: send,
      // The person asked for their printer (Bambu z49: Device tab, printer list, Print/Send; Prusa: its first link to an
      // address on the house network): the box says where they stand (download, open it, the code) before they type anything.
      asked: function () {
        if (!personAsked) {
          personAsked = true;
          const m = parked; parked = null;
          if (m) send(m);
        }
        offer();
      },
      helper: function () { return helper; },
      askHelper: function () { wants = true; personAsked = true; offer(); if (opened && helper && !helper.paired) showHelperBox('code'); },
      found: function () { return [...found.values()]; },
      paired: function () { return !!(helper && helper.paired) || !!token(); },
      hideSoon: function () { if (hstep === 'printers' && boxUp()) hideSoon(); },
      // reaching a printer is allowed here (the public host asks for a sign-in first)
      mayReach: function () { return !(accountCheck && !signedIn()); },
    };
  }
  return {
    line: function (o) { current = line(o); return current; },
    // A link to an address on the house network is starting (the tunnel's relayUrl): the person reached for a printer.
    // Unpaired, the box says how (download, open it, the code); paired, a box still on its last step closes.
    reaching: function () { const h = this.house(); if (h.paired()) h.hideSoon(); else h.asked(); },
    // PrusaSlicer has no printer link of its own: its first link to a house-network address without a token asks here
    house: function () {
      if (!current) current = line({
        pick: 'Add it in PrusaSlicer as a physical printer (the cog next to the printer list): its address, and the PrusaLink user and password from the printer\'s screen (Settings › Network › PrusaLink).',
        pickNone: 'Add your printer in PrusaSlicer as a physical printer (the cog next to the printer list): its address, and the PrusaLink user and password from the printer\'s screen (Settings › Network › PrusaLink). Then press Test.',
      });
      return current;
    },
  };
})();
