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
