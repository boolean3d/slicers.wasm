// The page's link to the Boolean3d helper on the home network (lan_printer_agent.cpp). One websocket; every message is
// JSON text, except a file for the printer, which follows its request as one binary message. What the helper says
// goes to the program's b3d_lan_incoming; camera JPEGs (binary) to b3d_lan_camera_frame, camera video (binary H.264) to
// B3DCam below. Helper address: index.html?bridge=ws://host:8770 (default ws://localhost:8770).
//
// THE HELPER'S DOOR (farm-helper/bambu-home/pairing.mjs): the helper answers only our pages and only a browser paired
// with it once, by the code the helper shows. This page keeps that token (localStorage 'b3d-helper-token', per origin)
// and puts it on the line's address; without one, the helper answers every printer request "pair first" and this page
// shows the box: where to download the helper (one program per system, no install) and where to type the code.
var B3DLan = (function () {
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
  let parked = null; // the program's printer search, sent once the person asks
  const background = (m) => { if (typeof m !== 'string') return false; try { const r = JSON.parse(m); return r.op === 'discover' || r.op === 'disconnect'; } catch (e) { return false; } };
  let opened = false;   // the link opened at least once (the helper is there)
  let helper = null;    // {id, name, version, paired} from the helper's hello answer
  let wants = false;    // the person asked for a printer (connect, Connect by IP, send, print): the box may show
  function token() { try { return localStorage.getItem(TOKEN) || ''; } catch (e) { return ''; } }
  function lineUrl() {
    const t = token();
    if (!t) return url;
    try { const u = new URL(url, location.href); u.searchParams.set('token', t); return u.href; } catch (e) { return url; }
  }
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
    const x = document.createElement('button'); x.textContent = '×'; x.title = 'Close';
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
    input.onkeydown = function (e) { if (e.key === 'Enter') pairNow(); e.stopPropagation(); };
    input.onkeyup = function (e) { e.stopPropagation(); };
    go.onclick = pairNow;
    row.append(input, go);
    wrap.append(row, status);
    wrap.wrong = function (words) { status.textContent = words; go.disabled = false; input.select(); };
    return wrap;
  }
  let codeBox = null;
  function showHelperBox(step) {
    if (step === hstep && hbox && hbox.isConnected && step !== 'printers') return;
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
      const other = add(el('p', css.muted));
      const b = el('button', css.small, 'The helper is on another computer, or shows a code');
      b.onclick = function () { other.remove(); codeBox = add(codeRow('Type the code the helper shows (in its window, or at http://localhost:8770 on that computer).')); };
      other.appendChild(b);
    } else if (step === 'linking') {
      add(progress(2));
      add(el('p', 'margin:10px 0 0;font-weight:600', 'Found the helper' + (helper && helper.name ? ' on ' + helper.name : '') + '. Linking…'));
    } else if (step === 'code') {
      add(progress(2));
      codeBox = add(codeRow('The helper is running' + (helper && helper.name ? ' on ' + helper.name : '') + '. Type the code it shows (in its window, or at http://localhost:8770 on that computer).'));
    } else if (step === 'printers') {
      add(progress(3));
      add(el('p', 'margin:8px 0 0;color:#00ae42;font-weight:600', 'Linked with the helper' + (helper && helper.name ? ' on ' + helper.name : '') + '.'));
      if (!found.size) {
        add(el('p', 'margin:8px 0 0;font-weight:600', 'Looking for printers on your network…'));
        add(el('p', css.muted, 'A Bambu Lab printer shows up when it is on and in LAN-only mode (on its screen, under its network settings).'));
      } else {
        add(el('p', 'margin:8px 0 4px', 'Printers on your network:'));
        const ul = add(el('ul', 'margin:0 0 6px;padding-left:20px'));
        for (const p of found.values()) {
          const li = el('li', 'margin:2px 0'); li.appendChild(el('b', '', p.name));
          li.appendChild(el('span', 'color:#666', '  ' + [p.model, p.ip].filter(Boolean).join(' · ')));
          ul.appendChild(li);
        }
        add(el('p', 'margin:6px 0 0', 'Pick it in the printer list at the top left, then type its access code: the printer\'s screen shows it next to LAN-only mode.'));
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
      if (!ws || ws.readyState !== 1) showHelperBox(secret() || token() ? 'open' : 'download');
    }, 1500);
  }
  function browserName() {
    const ua = navigator.userAgent || '';
    const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
    const o = /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    return (b + (o ? ' on ' + o : '')).slice(0, 60);
  }
  const boxUp = function () { return !!(hbox && hbox.isConnected); };
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
    if (r.ev === 'paired') {
      if (r.ok && r.token) {
        try { localStorage.setItem(TOKEN, r.token); localStorage.removeItem(SECRET); } catch (e) {}
        if (helper) helper.paired = true;
        if (r.helper && helper) helper.name = r.helper.name || helper.name;
        showHelperBox('printers');
        // the printer list again, now that this line may hear it
        ws.send(JSON.stringify({ op: 'discover', on: true }));
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
    if (r.ev === 'ssdp' && r.info && r.info.dev_id) {
      const was = found.has(r.info.dev_id);
      found.set(r.info.dev_id, { name: r.info.dev_name || r.info.dev_id, model: modelName(r.info.dev_type), ip: r.info.dev_ip });
      if (!was && hstep === 'printers' && boxUp()) showHelperBox('printers');
    }
    // the printer linked (its access code taken): the box has done its job
    if (r.ev === 'connect' && r.status === 0 && hstep === 'printers' && boxUp()) {
      hideAt = setTimeout(function () { if (boxUp()) hbox.remove(); hstep = null; }, 1500);
    }
    return false;
  }
  function modelName(t) {
    return { 'O1S': 'H2S', 'O1D': 'H2D', 'BL-P001': 'X1 Carbon', 'BL-P002': 'X1', 'C11': 'P1P', 'C12': 'P1S', 'C13': 'X1E',
      'N1': 'A1 mini', 'N2S': 'A1' }[t] || t || '';
  }
  // Something the person asked for, which needs the helper: remember it, and if the helper is not there, say so.
  function wanted(m) {
    if (typeof m !== 'string') return;
    let r; try { r = JSON.parse(m); } catch (e) { return; }
    if (!r || r.op === 'discover' || r.op === 'disconnect' || r.op === 'camera_got' || r.op === 'hello') return;
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
      // z31: this page confirms camera pictures (camera_got), so the helper holds back video, not the reports
      ws.send(JSON.stringify({ op: 'hello', camera_acks: true, name: browserName() }));
      const q = queue; queue = [];
      for (const m of q) ws.send(m);
    };
    ws.onmessage = function (e) {
      if (typeof e.data === 'string') {
        let r = null; try { r = JSON.parse(e.data); } catch (x) {}
        if (r && fromHelper(r)) return;
        return deliver(e.data);
      }
      const b = new Uint8Array(e.data), nl = b.indexOf(10);
      if (nl > 0 && nl <= 64) ws.send(JSON.stringify({ op: 'camera_got', dev_id: new TextDecoder().decode(b.subarray(0, nl)) }));   // z31
      picture(b);
    };
    ws.onclose = function () {
      helper = null;
      clearTimeout(retry);
      console.log('b3d-lan: helper link closed, retrying');
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
    start: open,
    send: send,
    // The person asked for their printer (z49 in the program: Device tab, printer list, Print/Send): the box says
    // where they stand (download, open it, the code) before they type anything.
    asked: function () {
      if (!personAsked) {
        personAsked = true;
        const m = parked; parked = null;
        if (m) send(m);
      }
      offer();
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
    // For a page that wants the box by hand (a Help link), and for tests.
    helper: function () { return helper; },
    askHelper: function () { wants = true; personAsked = true; offer(); if (opened && helper && !helper.paired) showHelperBox('code'); },
    found: function () { return [...found.values()]; },
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
