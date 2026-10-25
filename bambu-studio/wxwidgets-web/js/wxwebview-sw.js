// Service worker of the wasm port's wxWebView (beside index.html, registered by webview_wasm.cpp).
// Every page loaded into a web view frame gets one first script that asks the parent page to give it
// window.wx / window.webkit.messageHandlers (wxwvBridge), so they exist before the page's own scripts.
// It also gets the web view's default font: WebKitGTK (the Linux desktop's web view) draws a page that names no
// font in sans-serif; a browser frame would use its own default, serif. A zero-specificity rule before the page's
// own styles, so any font the page names wins, as with WebKitGTK's default-font-family.
// Cross-origin pictures and media the frames ask for without CORS (the home page's model cards, MakerWorld thumbnails)
// go through the page host's fetch?url= (shared/net/relay.mjs): the page is cross-origin isolated and
// those hosts send no CORP header, so the browser would refuse them; through the host they are same-origin.
//
// A printer's own web page on the house network (a Klipper printer's Mainsail or Fluidd in OrcaSlicer's Device tab,
// PrusaLink's page in PrusaSlicer's) shows in the web view as on desktop. The browser cannot reach the house network
// from a page of our site, so the frame loads <scope>__lan/<host>/<port>/<path> (webview_wasm.cpp, wxwvResolve) and
// everything that page asks of its own site travels over the home helper's tunnel (farm-helper/bambu-home/tunnel.mjs,
// the same address the slicer's printer link uses: index.html?bridge=, posted here by the page): plain HTTP/1.1
// spoken here, one TCP connection per request; the page's own websocket (Moonraker's /websocket) by a stand-in
// WebSocket put into the page (lanFrame below). The page first moves its address to the printer's own path, so a
// page written for the root of its site (Mainsail's router) finds itself there.
//
// Everything else passes through untouched.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const BRIDGE = '<style>:where(html){font-family:sans-serif}</style><script>(function(){try{var f=window.frameElement;if(f&&f.dataset.wxwv&&parent.wxwvBridge)parent.wxwvBridge(window,f);}catch(e){}})();</script>';

// ---- a printer's page on the house network ----
const LAN = '__lan/';
const lanClients = new Map();   // frame client id -> {host, port}
let lanBridge = null;
// <host>/<port>/<path> of a __lan/ address in any folder under this worker's scope (the page's folder may be a
// versioned one below it), else null
function lanRest(u) {
  const scope = self.registration.scope;
  if (!u.startsWith(scope)) return null;
  const i = u.indexOf('/' + LAN, scope.length - 1);
  return i < 0 ? null : u.slice(i + 1 + LAN.length);
}
const lanStore = () => caches.open('wxwv-lan');   // survives this worker being stopped and started again
self.addEventListener('message', e => {
  if (e.data && typeof e.data.wxwvLanBridge === 'string') {
    lanBridge = e.data.wxwvLanBridge;
    e.waitUntil(lanStore().then(c => c.put('bridge', new Response(lanBridge))));
  }
  const l = e.data && e.data.wxwvLanLogin;
  if (l && typeof l.host === 'string') {
    const key = 'login/' + l.host + ':' + l.port;
    const done = () => { if (e.ports[0]) e.ports[0].postMessage(1); };
    if (l.user) lanLogins.set(l.host + ':' + l.port, { user: l.user, password: l.password || '', ch: null, nc: 0 });
    else lanLogins.delete(l.host + ':' + l.port);
    e.waitUntil(lanStore().then(c => l.user ? c.put(key, new Response(JSON.stringify({ user: l.user, password: l.password || '' }))) : c.delete(key)).then(done, done));
  }
});

// A printer page's HTTP login (PrusaLink: Digest, user "maker"), given by the program for the printer it shows
// (wxWebView SetHttpCredentials, as a desktop web view answers its authentication request): every request to that
// printer carries it, and a 401 with a new challenge is answered once.
const lanLogins = new Map();   // "host:port" -> { user, password, ch: challenge or null, nc }
async function lanLogin(t) {
  const k = t.host + ':' + t.port;
  if (lanLogins.has(k)) return lanLogins.get(k);
  const r = await (await lanStore()).match('login/' + k);
  if (!r) return null;
  const j = await r.json();
  const l = { user: j.user, password: j.password, ch: null, nc: 0 };
  lanLogins.set(k, l);
  return l;
}
function lanChallenge(h) {
  const m = /^\s*(Digest|Basic)\b(.*)$/i.exec(h || '');
  if (!m) return null;
  const ch = { scheme: m[1].toLowerCase() };
  for (const p of m[2].matchAll(/([a-z]+)\s*=\s*(?:"([^"]*)"|([^,\s]*))/gi)) ch[p[1].toLowerCase()] = p[2] !== undefined ? p[2] : p[3];
  return ch;
}
function lanAuthorization(l, method, path) {
  const ch = l.ch;
  if (!ch) return null;
  if (ch.scheme === 'basic') return 'Basic ' + btoa(unescape(encodeURIComponent(l.user + ':' + l.password)));
  const ha1 = md5(l.user + ':' + ch.realm + ':' + l.password), ha2 = md5(method + ':' + path);
  const qop = ch.qop && ch.qop.split(',').map(s => s.trim()).includes('auth') ? 'auth' : null;
  const q = (s) => '"' + String(s).replace(/["\\]/g, '\\$&') + '"';
  let a = 'Digest username=' + q(l.user) + ', realm=' + q(ch.realm || '') + ', nonce=' + q(ch.nonce || '') + ', uri=' + q(path);
  if (qop) {
    const nc = (++l.nc).toString(16).padStart(8, '0'), cnonce = crypto.randomUUID().replace(/-/g, '');
    a += ', qop=auth, nc=' + nc + ', cnonce=' + q(cnonce) + ', response=' + q(md5(ha1 + ':' + ch.nonce + ':' + nc + ':' + cnonce + ':auth:' + ha2));
  } else a += ', response=' + q(md5(ha1 + ':' + ch.nonce + ':' + ha2));
  if (ch.opaque !== undefined) a += ', opaque=' + q(ch.opaque);
  if (ch.algorithm) a += ', algorithm=' + ch.algorithm;
  return a;
}
// MD5 of a string's UTF-8 bytes, as hex (RFC 1321; Digest needs it and Web Crypto has none)
function md5(str) {
  const b = new TextEncoder().encode(str), n = ((b.length + 8) >> 6) + 1, w = new Uint32Array(n * 16);
  for (let i = 0; i < b.length; i++) w[i >> 2] |= b[i] << ((i % 4) * 8);
  w[b.length >> 2] |= 0x80 << ((b.length % 4) * 8);
  w[n * 16 - 2] = b.length * 8; w[n * 16 - 1] = Math.floor(b.length / 0x20000000);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
  for (let o = 0; o < w.length; o += 16) {
    let a = h0, bb = h1, c = h2, d = h3;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (bb & c) | (~bb & d); g = i; }
      else if (i < 32) { f = (d & bb) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = bb ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (bb | ~d); g = (7 * i) % 16; }
      const x = (a + f + K[i] + w[o + g]) >>> 0, s = S[(i >> 4) * 4 + (i % 4)];
      a = d; d = c; c = bb; bb = (bb + ((x << s) | (x >>> (32 - s)))) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
  }
  return [h0, h1, h2, h3].map(v => Array.from({ length: 4 }, (_, i) => ((v >>> (i * 8)) & 255).toString(16).padStart(2, '0')).join('')).join('');
}
// lanFetch with the printer's login: the stored challenge answered up front, a fresh 401 challenge answered once
async function lanFetchAs(t, req, path, intoFrame) {
  const l = req.headers.has('authorization') ? null : await lanLogin(t);
  if (!l) return lanFetch(t, req, path, intoFrame);
  const again = req.clone();
  const res = await lanFetch(t, req, path, intoFrame, lanAuthorization(l, req.method, path));
  if (res.status !== 401) return res;
  const ch = lanChallenge(res.headers.get('www-authenticate'));
  // the same nonce refused again (and not "stale"): a wrong password; the printer's own answer stands
  if (!ch || (l.ch && ch.nonce && l.ch.nonce === ch.nonce && !/^true$/i.test(ch.stale || ''))) return res;
  l.ch = ch; l.nc = 0;
  try { await res.body?.cancel(); } catch (e) {}
  return lanFetch(t, again, path, intoFrame, lanAuthorization(l, again.method, path));
}
async function bridgeUrl() {
  if (!lanBridge) { const r = await (await lanStore()).match('bridge'); lanBridge = r ? await r.text() : 'ws://localhost:8770'; }
  return lanBridge;
}
async function lanTarget(id) {
  if (!id) return null;
  if (lanClients.has(id)) return lanClients.get(id);
  const r = await (await lanStore()).match('client/' + id);
  let t = r ? await r.json() : null;
  if (!t) {
    // a worker the printer page started (lanFrame) lives at its __lan/ address
    const c = await self.clients.get(id);
    const rest = c && lanRest(c.url), m = rest && /^([^/]+)\/(\d+)\//.exec(rest);
    if (m) t = { host: decodeURIComponent(m[1]), port: Number(m[2]) };
  }
  lanClients.set(id, t);
  return t;
}
function keepTarget(id, t) {
  if (!id) return;
  lanClients.set(id, t);
  lanStore().then(c => c.put('client/' + id, new Response(JSON.stringify(t))));
}
async function tunnelTo(t) {
  const u = new URL(await bridgeUrl(), self.registration.scope);
  u.searchParams.set('to', t.host + ':' + t.port);
  return u.href;
}

// The page, first thing: its address becomes the printer's own path, and its websockets to its own site go over the
// tunnel (a WebSocket speaking RFC 6455 over the TCP connection, as the browser would to the printer).
function lanFrame(t, tunnel) {
  try { history.replaceState(history.state, '', t.path); } catch (e) {}
  // its own service worker would take over our site's root; a printer page works without one (no offline copy)
  try { if (navigator.serviceWorker) navigator.serviceWorker.register = function () { return Promise.reject(new Error('not in a web view')); }; } catch (e) {}
  window.__wxwvLan = { host: t.host, port: t.port };
  // its workers (Mainsail reads the camera in one): a worker's own address decides which service worker serves it,
  // so one from the printer's site starts at its __lan/ address, inside ours
  var NativeWorker = window.Worker;
  if (NativeWorker) {
    window.Worker = function (url, opts) {
      var u = new URL(url, location.href);
      if (u.origin === location.origin && u.href.indexOf(t.scope) !== 0)
        url = t.scope + '__lan/' + encodeURIComponent(t.host) + '/' + t.port + u.pathname + u.search;
      return new NativeWorker(url, opts);
    };
    window.Worker.prototype = NativeWorker.prototype;
  }
  var Native = window.WebSocket, enc = new TextEncoder(), dec = new TextDecoder();
  function Lan(url, protocols) {
    var u = new URL(url, location.href);
    if (u.host !== location.host) return protocols === undefined ? new Native(url) : new Native(url, protocols);
    var self = this, key = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(16))));
    var protos = protocols === undefined ? [] : [].concat(protocols);
    self.url = u.href; self.readyState = 0; self.protocol = ''; self.extensions = ''; self.binaryType = 'blob'; self.bufferedAmount = 0;
    self.onopen = self.onmessage = self.onerror = self.onclose = null;
    self._l = {};
    var ws = new Native(tunnel, ['binary']), open = false, buf = new Uint8Array(0), parts = [], partOp = 0, gone = false;
    ws.binaryType = 'arraybuffer';
    self._ws = ws;
    ws.onopen = function () {
      ws.send(enc.encode('GET ' + u.pathname + u.search + ' HTTP/1.1\r\nHost: ' + t.host + ':' + t.port +
        '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n' +
        'Origin: http://' + t.host + ':' + t.port + '\r\n' + (protos.length ? 'Sec-WebSocket-Protocol: ' + protos.join(', ') + '\r\n' : '') + '\r\n'));
    };
    ws.onmessage = function (e) {
      var d = new Uint8Array(e.data), b = new Uint8Array(buf.length + d.length);
      b.set(buf); b.set(d, buf.length); buf = b;
      if (!open) {
        var text = dec.decode(buf), end = text.indexOf('\r\n\r\n');
        if (end < 0) return;
        var head = text.slice(0, end);
        if (!/^HTTP\/1\.1 101/.test(head)) { finish(1006); return; }
        var p = /\r\nsec-websocket-protocol:\s*([^\r\n]+)/i.exec(head);
        self.protocol = p ? p[1].trim() : '';
        buf = buf.slice(enc.encode(text.slice(0, end + 4)).length);
        open = true; self.readyState = 1; fire('open', {});
      }
      for (;;) {
        if (buf.length < 2) return;
        var fin = buf[0] & 0x80, op = buf[0] & 15, n = buf[1] & 127, at = 2;
        if (n === 126) { if (buf.length < 4) return; n = (buf[2] << 8) | buf[3]; at = 4; }
        else if (n === 127) { if (buf.length < 10) return; n = 0; for (var i = 2; i < 10; i++) n = n * 256 + buf[i]; at = 10; }
        if (buf.length < at + n) return;
        var pl = buf.slice(at, at + n);
        buf = buf.slice(at + n);
        if (op === 8) { frame(8, pl.slice(0, 2)); finish(pl.length >= 2 ? (pl[0] << 8) | pl[1] : 1005); return; }
        if (op === 9) { frame(10, pl); continue; }
        if (op === 10) continue;
        if (op !== 0) { partOp = op; parts = []; }
        parts.push(pl);
        if (!fin) continue;
        var len = 0; parts.forEach(function (x) { len += x.length; });
        var whole = new Uint8Array(len), o = 0; parts.forEach(function (x) { whole.set(x, o); o += x.length; });
        parts = [];
        fire('message', { data: partOp === 1 ? dec.decode(whole) : self.binaryType === 'arraybuffer' ? whole.buffer : new Blob([whole]) });
      }
    };
    ws.onerror = function () { if (!open) fire('error', {}); };
    ws.onclose = function () { finish(open ? 1006 : 1006); };
    function frame(op, payload) {
      var n = payload.length, h = n < 126 ? 2 : n < 65536 ? 4 : 10, f = new Uint8Array(h + 4 + n), mask = crypto.getRandomValues(new Uint8Array(4));
      f[0] = 0x80 | op;
      if (n < 126) f[1] = 0x80 | n;
      else if (n < 65536) { f[1] = 0x80 | 126; f[2] = n >> 8; f[3] = n & 255; }
      else { f[1] = 0x80 | 127; for (var i = 0; i < 8; i++) f[9 - i] = Math.floor(n / Math.pow(256, i)) & 255; }
      f.set(mask, h);
      for (var j = 0; j < n; j++) f[h + 4 + j] = payload[j] ^ mask[j & 3];
      if (ws.readyState === 1) ws.send(f);
    }
    function finish(code) {
      if (gone) return;
      gone = true; self.readyState = 3;
      try { ws.close(); } catch (e) {}
      fire('close', { code: code, reason: '', wasClean: code === 1000 });
    }
    function fire(type, init) {
      var ev = new Event(type);
      for (var k in init) Object.defineProperty(ev, k, { value: init[k] });
      var h = self['on' + type];
      if (h) h.call(self, ev);
      (self._l[type] || []).slice().forEach(function (f) { f.call(self, ev); });
    }
    self._frame = frame; self._finish = finish;
  }
  Lan.prototype.send = function (data) {
    if (this.readyState !== 1) throw new DOMException('not open', 'InvalidStateError');
    var self = this;
    if (typeof data === 'string') return self._frame(1, new TextEncoder().encode(data));
    if (data instanceof Blob) { data.arrayBuffer().then(function (b) { self._frame(2, new Uint8Array(b)); }); return; }
    self._frame(2, ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data));
  };
  Lan.prototype.close = function (code) {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    var c = code || 1000;
    this._frame(8, new Uint8Array([c >> 8, c & 255]));
    this._finish(c);
  };
  Lan.prototype.addEventListener = function (type, f) { (this._l[type] = this._l[type] || []).push(f); };
  Lan.prototype.removeEventListener = function (type, f) { var a = this._l[type] || []; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); };
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k, i) { Lan[k] = Lan.prototype[k] = i; });
  window.WebSocket = Lan;
}

// One HTTP/1.1 request to the printer over its own tunnel; the answer's body streams (a camera stream never ends).
async function lanFetch(t, req, path, intoFrame, authorization) {
  const tunnel = await tunnelTo(t);
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : new Uint8Array(await req.arrayBuffer());
  const head = [req.method + ' ' + path + ' HTTP/1.1', 'Host: ' + t.host + ':' + t.port, 'Connection: close'];
  for (const [k, v] of req.headers) if (!/^(host|connection|origin|referer|cookie|content-length|accept-encoding|sec-|upgrade)/i.test(k)) head.push(k + ': ' + v);
  if (authorization) head.push('Authorization: ' + authorization);
  head.push('Accept-Encoding: identity');
  if (body) head.push('Content-Length: ' + body.length);
  const enc = new TextEncoder(), dec = new TextDecoder();
  return new Promise((resolve) => {
    const ws = new WebSocket(tunnel, ['binary']);
    ws.binaryType = 'arraybuffer';
    let buf = new Uint8Array(0), ctl = null, answered = false, left = -1, chunked = false, chunkLeft = -1;
    const fail = () => { if (!answered) { answered = true; resolve(new Response('The printer did not answer (' + t.host + ':' + t.port + ').', { status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' } })); } else if (ctl) { try { ctl.close(); } catch (e) {} } };
    const out = (bytes) => { if (bytes.length) { try { ctl.enqueue(bytes); } catch (e) {} } };
    const done = () => { try { ctl.close(); } catch (e) {} try { ws.close(); } catch (e) {} };
    // body bytes as they come: Content-Length, chunked, or until the printer closes
    const feed = () => {
      if (!chunked) {
        if (left < 0) { out(buf); buf = new Uint8Array(0); return; }
        const n = Math.min(left, buf.length); out(buf.slice(0, n)); buf = buf.slice(n); left -= n;
        if (left === 0) done();
        return;
      }
      for (;;) {
        if (chunkLeft < 0) {
          const s = dec.decode(buf.slice(0, Math.min(buf.length, 64))), e = s.indexOf('\r\n');
          if (e < 0) return;
          chunkLeft = parseInt(s.slice(0, e), 16); buf = buf.slice(e + 2);
          if (chunkLeft === 0) { done(); return; }
        }
        if (buf.length < chunkLeft + 2) { const n = Math.min(buf.length, chunkLeft); out(buf.slice(0, n)); buf = buf.slice(n); chunkLeft -= n; return; }
        out(buf.slice(0, chunkLeft)); buf = buf.slice(chunkLeft + 2); chunkLeft = -1;
      }
    };
    ws.onopen = () => {
      const h = enc.encode(head.join('\r\n') + '\r\n\r\n');
      if (!body) return ws.send(h);
      const all = new Uint8Array(h.length + body.length); all.set(h); all.set(body, h.length); ws.send(all);
    };
    ws.onmessage = async (e) => {
      const d = new Uint8Array(e.data), b = new Uint8Array(buf.length + d.length);
      b.set(buf); b.set(d, buf.length); buf = b;
      if (answered) return feed();
      const text = dec.decode(buf.slice(0, Math.min(buf.length, 65536))), end = text.indexOf('\r\n\r\n');
      if (end < 0) return;
      const lines = text.slice(0, end).split('\r\n'), m = /^HTTP\/1\.[01] (\d+) ?(.*)$/.exec(lines[0]);
      if (!m) return fail();
      buf = buf.slice(enc.encode(text.slice(0, end + 4)).length);
      const headers = new Headers();
      for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) { try { headers.append(l.slice(0, i).trim(), l.slice(i + 1).trim()); } catch (x) {} } }
      chunked = /chunked/i.test(headers.get('transfer-encoding') || '');
      left = chunked ? -1 : headers.has('content-length') ? Number(headers.get('content-length')) : -1;
      for (const k of ['transfer-encoding', 'connection', 'keep-alive', 'content-length', 'content-encoding']) headers.delete(k);
      // the program's page is cross-origin isolated: a frame in it must say the same (as our own pages do)
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      const status = Number(m[1]);
      answered = true;
      const stream = new ReadableStream({ start(c) { ctl = c; }, cancel() { try { ws.close(); } catch (x) {} } });
      const noBody = req.method === 'HEAD' || status === 204 || status === 304;
      if (noBody) { resolve(new Response(null, { status, statusText: m[2], headers })); try { ws.close(); } catch (x) {} return; }
      if (left === 0) setTimeout(done);
      if (intoFrame && /text\/html/i.test(headers.get('content-type') || '')) {
        // the whole page, then the frame's first scripts in front of its own
        feed();
        const html = await new Response(stream).text();
        const first = BRIDGE + '<script>(' + lanFrame.toString() + ')(' + JSON.stringify({ host: t.host, port: t.port, path: path, scope: self.registration.scope }) + ',' + JSON.stringify(tunnel) + ');</script>';
        const hd = html.match(/<head[^>]*>/i);
        headers.set('content-type', 'text/html; charset=utf-8');
        resolve(new Response(hd ? html.replace(hd[0], hd[0] + first) : first + html, { status, statusText: m[2], headers }));
        return;
      }
      resolve(new Response(stream, { status, statusText: m[2], headers }));
      feed();
    };
    ws.onerror = fail;
    ws.onclose = () => { if (!answered) fail(); else done(); };
  });
}

self.addEventListener('fetch', e => {
  const r = e.request, url = new URL(r.url), scope = self.registration.scope;
  const rest = lanRest(r.url);
  if (rest !== null) {
    const m = /^([^/]+)\/(\d+)(\/.*)?$/.exec(rest);
    if (!m) return;
    const t = { host: decodeURIComponent(m[1]), port: Number(m[2]) }, path = m[3] || '/';
    if (r.mode === 'navigate') keepTarget(e.resultingClientId, t);
    return e.respondWith(lanFetchAs(t, r, path, r.mode === 'navigate'));
  }
  // A printer page asking for its own site: paths outside the slicer's folder (the slicer's files are all inside it)
  if (url.origin === self.location.origin && !r.url.startsWith(scope) && e.clientId) {
    return e.respondWith(lanTarget(e.clientId).then(t => t ? lanFetchAs(t, r, url.pathname + url.search, false) : fetch(r)));
  }
  if (r.method === 'GET' && r.mode === 'no-cors' && url.origin !== self.location.origin && /^https:/.test(r.url)
    && ['image', 'video', 'audio'].includes(r.destination)) {
    return e.respondWith(fetch(new URL('fetch?url=' + encodeURIComponent(r.url), scope)));
  }
  if (r.destination !== 'iframe' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const res = await fetch(r);
    if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
    let html = await res.text();
    const head = html.match(/<head[^>]*>/i);
    html = head ? html.replace(head[0], head[0] + BRIDGE) : BRIDGE + html;
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.set('content-type', 'text/html; charset=utf-8');
    return new Response(html, { status: res.status, statusText: res.statusText, headers });
  })());
});
