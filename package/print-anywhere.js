// print-anywhere.js: the program's own Print reaches the person's printer at home from any computer, through their
// Boolean3d account (all three slicers; brief print-anywhere-klipper).
//
// The programs send a sliced file to a printer with their print host link (OrcaSlicer and Bambu Studio: the printer's
// connection settings, host type "Octo/Klipper"; PrusaSlicer: a physical printer, host type OctoPrint): libcurl speaks
// OctoPrint's HTTP API to the address typed there. Here that address can be one of the account's printers by name,
//     <printer name>.boolean3d        e.g. garage-voron.boolean3d (any name works while the account has one printer)
// and the page answers it itself: the connection never leaves the page. "Test" is answered from the account's printer
// list; "Upload and Print" puts the file in the account (printers door: print-upload, then print-start, with this tab's
// slicer key) and the printer's helper at home (farm-helper/klipper, farm-helper/bambu-home) fetches it and starts it.
// Nothing on the house network is reached from the browser, so it works the same away from home.
//
// How: SOCKFS (the program's sockets) makes each connection's WebSocket in createPeer; for a .boolean3d address this
// hands createPeer a stand-in socket instead (createPeer takes a socket object as is) that runs a small HTTP server. The
// net layer (net-worker.js) calls pump() on every socket before each socket operation, so an answer reaches a program
// that waits for it inside a blocked call (Test runs on the page's thread).
//
// Module.b3dPrinters: { list() -> the account's printers (last read), hostOf(printer) -> its address, refresh() }.
(function () {
  if (typeof document === 'undefined' || typeof Module === 'undefined') return;
  var SUFFIX = '.boolean3d';
  var printers = [], readAt = 0, reading = null;

  function link() {
    try {
      var l = JSON.parse(localStorage.getItem('b3d-slicer-home') || 'null');
      return l && l.key && /^https?:\/\//.test(l.door || '') ? l : null;
    } catch (e) { return null; }
  }
  // The printers door sits beside the slicer-home door (functions/v1/slicer-home -> functions/v1/printers).
  function call(method, op, body) {
    var l = link();
    if (!l) return Promise.resolve({ ok: false, code: 'no_key', error: 'This slicer is not linked to your Boolean3d account. Open it from Boolean3d.' });
    var headers = { 'x-slicer-key': l.key };
    if (l.anon) { headers.apikey = l.anon; headers.Authorization = 'Bearer ' + l.anon; }
    if (body) headers['Content-Type'] = 'application/json';
    var url = l.door.replace(/\/+$/, '').replace(/[^\/]+$/, 'printers') + '/' + op;
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, code: 'offline', error: 'Boolean3d cannot be reached. Is this computer online?' }; });
  }
  function refresh() {
    if (!reading) {
      reading = call('GET', 'printers').then(function (a) {
        reading = null;
        if (a && a.ok) { printers = a.printers || []; readAt = Date.now(); }
        return a;
      });
    }
    return reading;
  }
  var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'printer'; };
  var hostOf = function (p) { return slug(p.name) + SUFFIX; };
  function printerFor(host) {
    var name = host.toLowerCase().slice(0, -SUFFIX.length);
    var paired = printers.filter(function (p) { return p.paired; });
    return paired.filter(function (p) { return slug(p.name) === name; })[0] || (paired.length === 1 ? paired[0] : null);
  }
  function whyNot(host) {
    if (!link()) return 'This slicer is not linked to your Boolean3d account. Open it from Boolean3d (Make > Slice) and try again.';
    if (!readAt) return 'Your printers are still being read from your Boolean3d account. Try again in a moment.';
    var names = printers.filter(function (p) { return p.paired; }).map(hostOf);
    if (!names.length) return 'Your Boolean3d account has no printer yet. Add it in Boolean3d: Make > Printers > Add a printer.';
    return 'No printer called ' + host + ' in your Boolean3d account. Yours: ' + names.join(', ') + '.';
  }

  // ── The stand-in socket: one HTTP connection to a .boolean3d address ──
  var enc = new TextEncoder(), dec = new TextDecoder();
  function Http(url) {
    this.url = url;
    this.host = /^wss?:\/\/([^:\/]+)/.exec(url)[1];
    this.readyState = 0;
    this.binaryType = 'arraybuffer';
    this.protocol = 'binary';
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    this.events = [{ type: 'open' }];
    this.got = new Uint8Array(0);
    this.busy = false;
    var me = this;
    setTimeout(function () { me.pump(); }, 0);
  }
  Http.CONNECTING = Http.prototype.CONNECTING = 0;
  Http.OPEN = Http.prototype.OPEN = 1;
  Http.CLOSING = Http.prototype.CLOSING = 2;
  Http.CLOSED = Http.prototype.CLOSED = 3;
  Http.prototype.pump = function () {
    while (this.events.length) {
      var e = this.events.shift();
      if (e.type === 'open') { this.readyState = 1; if (this.onopen) this.onopen({}); }
      else if (e.type === 'data') { if (this.onmessage) this.onmessage({ data: e.data }); }
      else if (e.type === 'close') { this.readyState = 3; if (this.onclose) this.onclose({}); }
    }
  };
  Http.prototype.later = function (ev) { var me = this; this.events.push(ev); setTimeout(function () { me.pump(); }, 0); };
  Http.prototype.close = function () { if (this.readyState < 2) { this.readyState = 2; this.later({ type: 'close' }); } };
  Http.prototype.send = function (data) {
    var b = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    var all = new Uint8Array(this.got.length + b.length);
    all.set(this.got); all.set(b, this.got.length); this.got = all;
    this.take();
  };
  // A whole request in hand (head + Content-Length body, or a chunked body) is answered; a request that asks to
  // be told to go on (Expect: 100-continue, libcurl does for big uploads) is told at once.
  Http.prototype.take = function () {
    if (this.busy) return;
    var buf = this.got, end = -1;
    for (var i = 3; i < buf.length; i++) if (buf[i] === 10 && buf[i - 1] === 13 && buf[i - 2] === 10 && buf[i - 3] === 13) { end = i + 1; break; }
    if (end < 0) return;
    var lines = dec.decode(buf.subarray(0, end)).split('\r\n'), first = lines.shift().split(' ');
    var head = {};
    lines.forEach(function (l) { var at = l.indexOf(':'); if (at > 0) head[l.slice(0, at).trim().toLowerCase()] = l.slice(at + 1).trim(); });
    var body;
    if (/chunked/i.test(head['transfer-encoding'] || '')) {
      var parts = [], at = end, done = false;
      for (;;) {
        var nl = -1;
        for (var j = at; j + 1 < buf.length; j++) if (buf[j] === 13 && buf[j + 1] === 10) { nl = j; break; }
        if (nl < 0) break;
        var n = parseInt(dec.decode(buf.subarray(at, nl)), 16);
        if (!(n >= 0) || buf.length < nl + 2 + n + 2) break;
        if (n === 0) { done = true; break; }
        parts.push(buf.subarray(nl + 2, nl + 2 + n)); at = nl + 2 + n + 2;
      }
      if (!done) return this.goOn(head);
      var size = parts.reduce(function (s, p) { return s + p.length; }, 0);
      body = new Uint8Array(size); size = 0;
      parts.forEach(function (p) { body.set(p, size); size += p.length; });
    } else {
      var want = parseInt(head['content-length'] || '0', 10) || 0;
      if (buf.length - end < want) return this.goOn(head);
      body = buf.slice(end, end + want);
    }
    this.got = new Uint8Array(0);
    this.busy = true;
    var me = this;
    Promise.resolve(answer(this.host, first[0], first[1] || '/', head, body)).then(function (a) { me.reply(a); }, function (e) {
      me.reply({ status: 500, body: { error: 'Something went wrong in this page: ' + (e && e.message || e) } });
    });
  };
  Http.prototype.goOn = function (head) {
    if (/100-continue/i.test(head.expect || '') && !this.continued) {
      this.continued = true;
      this.later({ type: 'data', data: enc.encode('HTTP/1.1 100 Continue\r\n\r\n').buffer });
    }
  };
  Http.prototype.reply = function (a) {
    var text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body || {});
    var bytes = enc.encode(text);
    var why = { 200: 'OK', 201: 'Created', 400: 'Bad Request', 404: 'Not Found', 409: 'Conflict', 500: 'Internal Server Error', 503: 'Service Unavailable' };
    var head = 'HTTP/1.1 ' + a.status + ' ' + (why[a.status] || 'OK') + '\r\nContent-Type: ' + (typeof a.body === 'string' ? 'text/plain; charset=utf-8' : 'application/json')
      + '\r\nContent-Length: ' + bytes.length + '\r\nConnection: close\r\n\r\n';
    var out = new Uint8Array(enc.encode(head).length + bytes.length);
    out.set(enc.encode(head)); out.set(bytes, out.length - bytes.length);
    this.busy = false; this.continued = false;
    this.later({ type: 'data', data: out.buffer });
    this.later({ type: 'close' });
  };

  // ── OctoPrint's API, as much as the programs use ──
  function answer(host, method, target, head, body) {
    var path = target.split('?')[0].replace(/\/+$/, '');
    var p = printerFor(host);
    if (method === 'GET' && /\/api\/version$/.test(path)) {
      // Test (on the page's thread: answered from the list read last; the list is read again for the next time)
      if (Date.now() - readAt > 15000) refresh();
      if (!p) return { status: 503, body: whyNot(host) };
      if (!p.online) return { status: 503, body: p.name + ' is offline: its helper has not called Boolean3d for a while. Is the printer switched on?' };
      return { status: 200, body: { api: '0.1', server: '1.10.0', text: 'OctoPrint 1.10.0 (Boolean3d: ' + p.name + ')' } };
    }
    if (method === 'POST' && /\/api\/files\/local$/.test(path)) return upload(host, head, body);
    if (method === 'GET' && /\/api\/(printer|job|connection|settings)$/.test(path)) return { status: 200, body: {} };
    return { status: 404, body: 'Not here: ' + method + ' ' + path };
  }
  function formParts(head, body) {
    var m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(head['content-type'] || '');
    if (!m) return null;
    var mark = enc.encode('--' + (m[1] || m[2]).trim()), out = {}, at = 0;
    function find(from) {
      outer: for (var i = from; i <= body.length - mark.length; i++) {
        for (var k = 0; k < mark.length; k++) if (body[i + k] !== mark[k]) continue outer;
        return i;
      }
      return -1;
    }
    var s = find(0);
    while (s >= 0) {
      var from = s + mark.length;
      if (body[from] === 45 && body[from + 1] === 45) break;   // the closing --
      from += 2;
      var e = find(from);
      if (e < 0) break;
      var part = body.subarray(from, e - 2), hEnd = -1;
      for (var i = 3; i < part.length; i++) if (part[i] === 10 && part[i - 1] === 13 && part[i - 2] === 10 && part[i - 3] === 13) { hEnd = i + 1; break; }
      if (hEnd > 0) {
        var hd = dec.decode(part.subarray(0, hEnd));
        var name = /name="([^"]*)"/i.exec(hd), file = /filename="([^"]*)"/i.exec(hd);
        if (name) out[name[1]] = { data: part.subarray(hEnd), filename: file ? file[1] : null };
      }
      s = e;
    }
    return out;
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  // After Print the program stays where it is: a small note says where the file went, and its "Watch it" opens that
  // printer on Boolean3d's Printers page in a new tab (status, camera, Stop, history). The same for every kind of
  // printer and on any computer. The site's address is the one the home bar keeps (home-bar.js).
  function watchOf(p) {
    var hub = null;
    try { hub = localStorage.getItem('b3d-hub'); } catch (e) { /* the public site */ }
    return (hub || 'https://boolean3d.com/').replace(/\/*$/, '/') + '#/printers/' + encodeURIComponent(p.id);
  }
  // The plate's picture for the print's history on the Printers page, as a data: address: Metadata/plate_1.png of a
  // .gcode.3mf (stored or deflated), or the biggest PNG thumbnail in a plain G-code's comments. null when it has none.
  function plateOf(bytes) {
    function png(b) { var s = ''; for (var i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return 'data:image/png;base64,' + btoa(s); }
    try {
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), want = 'Metadata/plate_1.png';
        for (var e = bytes.length - 22; e >= Math.max(0, bytes.length - 65557); e--) {
          if (v.getUint32(e, true) !== 0x06054b50) continue;
          for (var c = v.getUint32(e + 16, true), n = v.getUint16(e + 10, true); n-- > 0;) {
            var nl = v.getUint16(c + 28, true), name = dec.decode(bytes.subarray(c + 46, c + 46 + nl));
            if (name === want) {
              var how = v.getUint16(c + 10, true), size = v.getUint32(c + 20, true), at = v.getUint32(c + 42, true);
              var from = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true), raw = bytes.subarray(from, from + size);
              if (how === 0) return Promise.resolve(png(raw));
              if (how !== 8 || typeof DecompressionStream === 'undefined') return Promise.resolve(null);
              return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()
                .then(function (b) { return png(new Uint8Array(b)); }, function () { return null; });
            }
            c += 46 + nl + v.getUint16(c + 30, true) + v.getUint16(c + 32, true);
          }
          break;
        }
        return Promise.resolve(null);
      }
      var head = dec.decode(bytes.subarray(0, Math.min(bytes.length, 2000000))), best = null, m, re = /; thumbnail begin (\d+)x(\d+) \d+\r?\n([\s\S]*?); thumbnail end/g;
      while ((m = re.exec(head))) if (!best || m[1] * m[2] > best.area) best = { area: m[1] * m[2], b64: m[3].replace(/^; ?/gm, '').replace(/\s+/g, '') };
      return Promise.resolve(best ? 'data:image/png;base64,' + best.b64 : null);
    } catch (err) { return Promise.resolve(null); }
  }
  function upload(host, head, body) {
    var form = formParts(head, body);
    if (!form || !form.file) return { status: 400, body: 'No file came with the upload.' };
    var bytes = form.file.data.slice(), name = (form.file.filename || 'Part.gcode').replace(/^.*[\\\/]/, '');
    var print = form.print && dec.decode(form.print.data).trim() === 'true';
    return refresh().then(function () {
      var p = printerFor(host);
      if (!p) return { status: 409, body: whyNot(host) };
      if (!print) return { status: 409, body: 'From here the file goes to ' + p.name + ' to print: press Upload and Print.' };
      var id = uuid(), title = name.replace(/\.gcode(\.3mf)?$/i, '');
      return call('POST', 'print-upload', { printer: p.id, print: id, bytes: bytes.length }).then(function (a) {
        if (!a || !a.ok) return { status: 409, body: (a && a.error) || 'Boolean3d did not take the file.' };
        var to = Module.b3dHome && Module.b3dHome.beside ? Module.b3dHome.beside(a.upload) : a.upload;
        return fetch(to, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }).then(function (r) {
          if (!r.ok) return { status: 409, body: 'The file did not reach your Boolean3d account (' + r.status + '). Try again.' };
          return plateOf(bytes).then(function (picture) {
            return call('POST', 'print-start', { printer: p.id, print: id, name: title, picture: picture });
          }).then(function (s) {
            if (!s || !s.ok) return { status: 409, body: (s && s.error) || 'Boolean3d did not send it to ' + p.name + '.' };
            console.log('b3d print: ' + name + ' (' + bytes.length + ' bytes) sent to ' + p.name + ' through Boolean3d');
            if (Module.b3dNotice) Module.b3dNotice('Sent to ' + p.name, 'info', { label: 'Watch it', href: watchOf(p) });
            return { status: 201, body: { done: true, files: { local: { name: name, origin: 'local', refs: {} } }, effectivePrint: true, effectiveSelect: true } };
          });
        });
      });
    });
  }

  // ── Into SOCKFS: before the program runs ──
  (Module.preRun = [].concat(Module.preRun || [])).push(function () {
    if (typeof SOCKFS === 'undefined' || !SOCKFS.websocket_sock_ops) return;
    var ops = SOCKFS.websocket_sock_ops, createPeer = ops.createPeer;
    ops.createPeer = function (sock, addr, port) {
      if (typeof addr === 'string' && addr.toLowerCase().slice(-SUFFIX.length) === SUFFIX) {
        return createPeer.call(this, sock, new Http('ws://' + addr + ':' + port + '/'), port);
      }
      return createPeer.apply(this, arguments);
    };
  });
  // Once per browser and printer: where the printer is, in plain words (the program keeps the address in its printer
  // settings, which the account keeps too: every other computer knows it already).
  var PROGRAM = { bambu: 'Bambu Studio', orca: 'OrcaSlicer', prusa: 'PrusaSlicer' }[(location.pathname.split('/')[1] || '')] || 'the slicer';
  var WHERE = PROGRAM === 'PrusaSlicer' ? 'add a physical printer (the cog by Printer), host type OctoPrint, hostname '
    : 'click the Wi-Fi sign by Printer, host type Octo/Klipper, hostname ';
  function tell() {
    var told = {};
    try { told = JSON.parse(localStorage.getItem('b3d-printers-told') || '{}'); } catch (e) { /* none */ }
    // A printer the program was opened for has its address filled in already (home-folder-sync.js, b3dHostSet).
    var fresh = printers.filter(function (p) { return p.paired && !told[p.id] && hostOf(p) !== Module.b3dHostSet; });
    if (!fresh.length || !Module.b3dNotice) return;
    fresh.forEach(function (p) { told[p.id] = 1; });
    try { localStorage.setItem('b3d-printers-told', JSON.stringify(told)); } catch (e) { /* this tab only */ }
    Module.b3dNotice('Print to ' + fresh.map(function (p) { return p.name; }).join(' or ') + ' from any computer: in ' + PROGRAM + ', ' + WHERE
      + fresh.map(hostOf).join(' or ') + '. Then Print sends it through your Boolean3d account. Only once: your settings follow you.');
  }
  (Module.preRun = [].concat(Module.preRun || [])).push(function () { refresh().then(function () { setTimeout(tell, 8000); }); });
  setInterval(function () { if (!document.hidden) refresh(); }, 60000);
  Module.b3dPrinters = { list: function () { return printers.slice(); }, hostOf: hostOf, refresh: refresh };
})();
