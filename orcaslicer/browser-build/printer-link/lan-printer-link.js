// The page's link to the Boolean3d helper on the home network (lan_printer_agent.cpp). One websocket; every message is
// JSON text, except a file for the printer, which follows its request as one binary message. What the helper says
// goes to the program's b3d_lan_incoming; camera JPEGs (binary) to b3d_lan_camera_frame, camera video (binary H.264) to
// B3DCam below. Helper address: index.html?bridge=ws://host:8770 (default ws://localhost:8770).
var B3DLan = (function () {
  const url = new URLSearchParams(location.search).get('bridge') || 'ws://localhost:8770';
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
  let parked = null; // the program's printer search, sent once the person asks
  const background = (m) => { if (typeof m !== 'string') return false; try { const r = JSON.parse(m); return r.op === 'discover' || r.op === 'disconnect'; } catch (e) { return false; } };
  function deliver(text) {
    const p = stringToNewUTF8(text);
    // posted to the program's thread, which frees p after the call (page-extras.js); before main runs: dropped
    if (!Module.wxCall || !Module.wxCall('_b3d_lan_incoming', [p], { free: [0] })) Module._free(p);
  }
  // A camera picture: "<dev_id>\n" then one JPEG (FF D8; lan_printer_camera.cpp) or one H.264 picture (00 00 [00] 01; B3DCam).
  function picture(b) {
    const nl = b.indexOf(10);
    if (nl <= 0 || nl > 64) return;
    if (b[nl + 1] === 0 && b[nl + 2] === 0) return B3DCam.feed(new TextDecoder().decode(b.subarray(0, nl)), b.subarray(nl + 1));
    const dev = stringToNewUTF8(new TextDecoder().decode(b.subarray(0, nl)));
    const data = Module._malloc(b.length - nl - 1);
    HEAPU8.set(b.subarray(nl + 1), data);   // bare HEAPU8: Emscripten refreshes it after memory growth
    if (!Module.wxCall || !Module.wxCall('_b3d_lan_camera_frame', [dev, data, b.length - nl - 1], { free: [0, 1] })) { Module._free(data); Module._free(dev); }
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
  const SIGN_IN = 'Sign in to Boolean3d to connect your printer';
  let box = null;
  function askSignIn() {
    if (box && box.isConnected) return;
    box = document.createElement('div');
    box.id = 'b3d-sign-in-printer';
    box.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;gap:12px;' +
      'align-items:center;padding:10px 14px;background:#fff;color:#222;border:1px solid #ccc;border-radius:6px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.18);font:14px system-ui,sans-serif';
    const words = document.createElement('span'); words.textContent = SIGN_IN;
    const go = document.createElement('a'); go.textContent = 'Sign in'; go.href = 'https://boolean3d.com/#/slicers'; go.target = '_blank'; go.rel = 'noopener';
    go.style.cssText = 'padding:5px 12px;background:#00ae42;color:#fff;border-radius:4px;text-decoration:none';
    const x = document.createElement('button'); x.textContent = '\u00d7'; x.title = 'Close';
    x.style.cssText = 'border:0;background:none;font-size:18px;cursor:pointer;color:#666';
    x.onclick = function () { box.remove(); };
    box.append(words, go, x);
    document.body.appendChild(box);
  }
  // The program's own background calls (the printer search at start, a disconnect) are dropped quietly; the box
  // answers what the person asked for (connect, Connect by IP, send, print).
  function refused(m) {
    if (typeof m !== 'string') return;
    let r; try { r = JSON.parse(m); } catch (e) { return; }
    if (!r || r.op === 'discover' || r.op === 'disconnect') return;
    askSignIn();
    if (r.id !== undefined) deliver(JSON.stringify({ id: r.id, stage: 'error', error: SIGN_IN, code: -1 }));
  }
  function open() {
    if (!personAsked) return;
    if (accountCheck && !signedIn()) return;
    if (ws && ws.readyState <= 1) return;
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = function () {
      console.log('b3d-lan: helper linked at ' + url);
      try { localStorage.setItem('b3d-lan-linked', '1'); } catch (e) {}
      // z31: this page confirms camera pictures (camera_got), so the helper holds back video, not the reports
      ws.send(JSON.stringify({ op: 'hello', camera_acks: true }));
      const q = queue; queue = [];
      for (const m of q) ws.send(m);
    };
    ws.onmessage = function (e) {
      if (typeof e.data === 'string') return deliver(e.data);
      const b = new Uint8Array(e.data), nl = b.indexOf(10);
      if (nl > 0 && nl <= 64) ws.send(JSON.stringify({ op: 'camera_got', dev_id: new TextDecoder().decode(b.subarray(0, nl)) }));   // z31
      picture(b);
    };
    ws.onclose = function () {
      console.log('b3d-lan: helper link closed, retrying');
      clearTimeout(retry);
      retry = setTimeout(open, 3000);
    };
    ws.onerror = function () {};
  }
  function send(m) {
    if (!personAsked) {
      if (background(m)) { if (JSON.parse(m).op === 'discover') parked = m; return; }
      personAsked = true;
    }
    if (accountCheck && !signedIn()) return refused(m);
    if (ws && ws.readyState === 1) ws.send(m);
    else { queue.push(m); open(); }
  }
  return {
    start: open,
    send: send,
    // The person asked for their printer (z49 in the program: Device tab, printer list, Print/Send).
    asked: function () {
      if (personAsked) return;
      personAsked = true;
      const m = parked; parked = null;
      if (m) send(m); else open();
    },
    // The request, then the file's bytes (path '' = no file).
    sendFile: function (req, path) {
      send(req);
      if (!path || (accountCheck && !signedIn())) return;
      let bytes;
      try { bytes = FS.readFile(path); } catch (e) {
        const r = JSON.parse(req);
        deliver(JSON.stringify({ id: r.id, stage: 'error', error: 'the page could not read ' + path, code: -1 }));
        return;
      }
      send(bytes.slice().buffer);
    },
  };
})();

// The printer's live video in the tab. The helper passes the printer's own H.264 through untouched (one picture per
// message, Annex B); the browser decodes it (WebCodecs, the graphics card where there is one) and draws each picture at
// once on a <canvas> laid over the program's camera view, as wxwidgets-opengl lays WebGL over a 3D view: in the top-level window's
// div, taking no pointer events. Decoding and drawing run in a worker on the canvas's OffscreenCanvas: the program keeps
// the page thread busy for 100-300 ms at a time, and a player on that thread fell behind and skipped to the next key
// picture (~1 s on an H2S): 15 pictures a second and 1 s stalls in Bambu Studio b25 (10-24) where the player alone
// drew 30. lan_printer_camera.cpp starts and stops a printer's player, tells it where the camera view is (place), and asks
// for full screen; the first picture's size goes back to it (b3d_lan_camera_size), which is when the program shows
// "Playing". A player more than half a second behind waits for the next key picture.
var B3DCam = (function () {
  const players = new Map(); // dev_id -> player
  let styled = false, worker = null, asks = 0;
  const asked = new Map(); // stats() answers waited for
  // The worker: one decoder and one OffscreenCanvas per printer.
  function workerMain() {
    const ps = new Map();
    const hex = (v) => v.toString(16).padStart(2, '0');
    // Each NAL unit's type (Annex B: 00 00 01 or 00 00 00 01 before each) and where its header byte is.
    function nals(b) {
      const out = [];
      for (let i = 0; i + 3 < b.length; i++) {
        if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) { out.push([b[i + 3] & 31, i + 3]); i += 3; }
      }
      return out;
    }
    function lost(dev, p, e) {
      postMessage({ op: 'log', text: 'camera video of ' + dev + ': ' + (e && e.message || e) });
      p.decoder = null; p.codec = ''; p.waitKey = true;
    }
    function draw(dev, p, frame) {
      try {
        const w = frame.displayWidth, h = frame.displayHeight, c = p.canvas;
        if (!p.sized) { p.sized = true; postMessage({ op: 'size', dev: dev, w: w, h: h }); }
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const sw = w / p.zoom, sh = h / p.zoom;
        p.ctx.drawImage(frame, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, w, h);
        const now = performance.timeOrigin + performance.now(), at = p.at.get(frame.timestamp);
        p.at.delete(frame.timestamp);
        if (at !== undefined) p.lat.push(now - at);
        if (p.last) p.gap = Math.max(p.gap, now - p.last);
        p.last = now; p.drawn++;
      } finally { frame.close(); }
    }
    function feed(dev, p, b, at) {
      const units = nals(b);
      const key = units.some((u) => u[0] === 5);
      const sps = units.find((u) => u[0] === 7);
      if (sps) {
        const codec = 'avc1.' + hex(b[sps[1] + 1]) + hex(b[sps[1] + 2]) + hex(b[sps[1] + 3]);
        if (!p.decoder || p.decoder.state === 'closed') {
          p.decoder = new VideoDecoder({ output: (f) => draw(dev, p, f), error: (e) => lost(dev, p, e) });
          p.codec = '';
        }
        if (codec !== p.codec) { p.decoder.configure({ codec: codec, optimizeForLatency: true }); p.codec = codec; p.waitKey = true; }
      }
      if (!p.codec) return;
      if (p.decoder.decodeQueueSize > 15) p.waitKey = true; // half a second behind: drop until the next key picture
      if (p.waitKey && !key) return;
      p.waitKey = false;
      p.ts += 33333;
      p.at.set(p.ts, at);
      if (p.at.size > 300) p.at.clear();
      try { p.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: p.ts, data: b })); }
      catch (e) { lost(dev, p, e); }
    }
    onmessage = function (e) {
      const m = e.data;
      if (m.op === 'add') ps.set(m.dev, { canvas: m.canvas, ctx: m.canvas.getContext('2d', { alpha: false }), decoder: null, codec: '', waitKey: true, ts: 0, sized: false, zoom: 1,
        at: new Map(), lat: [], drawn: 0, gap: 0, last: 0 });
      const p = ps.get(m.dev);
      if (!p) return;
      if (m.op === 'chunk') feed(m.dev, p, new Uint8Array(m.data), m.at);
      else if (m.op === 'stats') {
        const l = p.lat.sort((a, b) => a - b);
        postMessage({ op: 'stats', id: m.id, drawn: p.drawn, maxGapMs: Math.round(p.gap), latMed: +(l[l.length >> 1] || 0).toFixed(1),
          latP99: +(l[Math.floor(l.length * 0.99)] || 0).toFixed(1), codec: p.codec });
        p.lat = []; p.drawn = 0; p.gap = 0;
      }
      else if (m.op === 'zoom') p.zoom = m.zoom;
      else if (m.op === 'remove') { if (p.decoder && p.decoder.state !== 'closed') p.decoder.close(); ps.delete(m.dev); }
    };
  }
  function workerOf() {
    if (worker) return worker;
    worker = new Worker(URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')()'], { type: 'text/javascript' })));
    worker.onmessage = function (e) {
      const m = e.data;
      if (m.op === 'log') console.log('b3d-lan: ' + m.text);
      else if (m.op === 'stats') { const r = asked.get(m.id); asked.delete(m.id); if (r) r(m); }
      else if (m.op === 'size' && players.has(m.dev)) {
        const d = stringToNewUTF8(m.dev);
        if (!Module.wxCall || !Module.wxCall('_b3d_lan_camera_size', [d, m.w, m.h], { free: [0] })) Module._free(d);
      }
    };
    return worker;
  }
  // The picture's zoom: the program's own zoom in its view, none in full screen.
  function zoomOf(dev, p) {
    if (!p.canvas) return;
    const z = document.fullscreenElement === p.canvas ? 1 : p.zoom;
    if (z !== p.sentZoom) { p.sentZoom = z; workerOf().postMessage({ op: 'zoom', dev: dev, zoom: z }); }
  }
  function canvasOf(dev, p) {
    if (p.canvas) return p.canvas;
    if (!styled) {
      styled = true;
      const st = document.createElement('style');
      st.textContent = 'canvas.b3d-cam{position:absolute;pointer-events:none;z-index:5;display:none;background:#000;object-fit:contain}' +
        'canvas.b3d-cam:fullscreen{pointer-events:auto;display:block!important}';
      document.head.appendChild(st);
    }
    const c = document.createElement('canvas');
    c.className = 'b3d-cam';
    c.width = 16; c.height = 9;
    c.addEventListener('dblclick', () => { if (document.fullscreenElement === c) document.exitFullscreen(); });
    c.addEventListener('fullscreenchange', () => zoomOf(dev, p));
    p.canvas = c;
    const off = c.transferControlToOffscreen();
    workerOf().postMessage({ op: 'add', dev: dev, canvas: off }, [off]);
    return c;
  }
  return {
    start: function (dev) {
      let p = players.get(dev);
      // The canvas goes to the worker now: the program places the view only once the first picture's size is known.
      if (!p) { players.set(dev, p = { users: 0, canvas: null, zoom: 1, sentZoom: 1 }); canvasOf(dev, p); }
      p.users++;
    },
    stop: function (dev) {
      const p = players.get(dev);
      if (!p || --p.users > 0) return;
      players.delete(dev);
      worker.postMessage({ op: 'remove', dev: dev });
      if (p.canvas) {
        if (document.fullscreenElement === p.canvas) document.exitFullscreen();
        p.canvas.remove();
      }
    },
    feed: function (dev, b) {
      const p = players.get(dev);
      if (!p || typeof VideoDecoder === 'undefined') return;
      const data = b.slice().buffer, at = performance.timeOrigin + performance.now();
      worker.postMessage({ op: 'chunk', dev: dev, data: data, at: at }, [data]);
    },
    // Where the camera view is: its top-level window's div (wx.js windowMap) and its rect there, in CSS pixels.
    place: function (dev, windowId, x, y, w, h, shown, zoom) {
      const p = players.get(dev);
      if (!p) return;
      const c = p.canvas;
      // the top-level window's div lives on the page (page-bridge.js); wx.js's windowMap moved into the worker
      const div = Module.wxPage && Module.wxPage.wins[windowId] ? Module.wxPage.wins[windowId].div
        : (typeof windowMap !== 'undefined' && windowMap.get(windowId) ? windowMap.get(windowId).window : null);
      const data = div ? { window: div } : null;
      if (data && c.parentNode !== data.window) {
        if (getComputedStyle(data.window).position === 'static') data.window.style.position = 'relative';
        data.window.appendChild(c);
      }
      c.style.left = x + 'px'; c.style.top = y + 'px';
      c.style.width = w + 'px'; c.style.height = h + 'px';
      c.style.display = shown && w > 0 && h > 0 && data ? 'block' : 'none';
      p.zoom = zoom > 1 ? zoom : 1;
      zoomOf(dev, p);
    },
    hide: function (dev) {
      const p = players.get(dev);
      if (p && p.canvas) p.canvas.style.display = 'none';
    },
    // For test scripts: pictures drawn since the last ask, the longest wait between two, and page arrival -> drawn (ms).
    stats: function (dev) {
      if (!players.get(dev)) return Promise.resolve(null);
      const id = ++asks;
      return new Promise((r) => { asked.set(id, r); worker.postMessage({ op: 'stats', dev: dev, id: id }); });
    },
    // The camera's full-screen button: the picture alone fills the screen (the browser's own full screen); the same
    // button, Esc or a double click leave it.
    fullscreen: function (dev) {
      const p = players.get(dev);
      if (!p || !p.canvas) return;
      if (document.fullscreenElement === p.canvas) { document.exitFullscreen(); return; }
      p.canvas.requestFullscreen().catch((e) => console.log('b3d-lan: camera full screen: ' + e.message));
    },
  };
})();
