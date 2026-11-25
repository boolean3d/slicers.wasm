// claude-line.js: this slicer tab's standing line to the Claude connector (server/claude-connector), for a person who
// added Boolean3d to their Claude. Claude's tool calls arrive here and run in THIS tab through the slicer door
// (script-door.js, B3DDoor.act), the way the person's own hands would, while they watch and can step in.
//
// A page script of the slicer package (slicers-in-browser/package/package.mjs PAGE_SCRIPTS, FIRST in the list: it
// reads the address before home-folder-sync.js tidies it). This file is kept in cadterminal beside the connector it
// speaks to (server/claude-connector/slicer/) and copied into the package.
//
// Only in a tab opened from Boolean3d by a person who linked Claude: the opening address carries the connector's
// address after the # (b3d-claude, js/share/SlicerHome.js); it is kept for this browser. Nobody else makes a request.
// The line is one WebSocket with the tab's slicer key (the key Boolean3d handed this browser, b3d-slicer-home).
//
//   connector -> { op: 'act', id, do, args }      tab -> { op: 'answer', id, answer: { ok, error, result } }
// What it does:
//   every door action as it is (status, presets, pick_preset, settings, select, clone, fill_bed, arrange, slice,
//   results, picture, new_project, tab, plate, boxes, press)
//   add_part { part, name }   one of the person's Boolean3d parts by its id (asked of their account), onto the plate
//   lay { presets, items }    a fresh plate set for one printer, the parts with their copies, arranged
//   fit { presets, items, most }   how many (whole sets) fit one plate of that printer
//   show { lay?, keep?, key } slice, then the plate's numbers and its picture in one answer; `keep`: its printer file
//                             is kept in this tab under that name (needs the door's `export`)
//   send { printer, print, name, slots, file, bytes }   a kept printer file to the person's printer through their
//                             account. Asked by the connector alone, after the person's two yeses in the chat
//                             (server/claude-connector/jobs.js): the file is the plate that was shown.
//   lay, fit and show take a `key`: asked again under it, the ask joins the work under way or gets its answer.
(function () {
  if (typeof document === 'undefined' || typeof WebSocket === 'undefined') return;
  var KEEP = 'b3d-claude-line';
  var PROGRAM = { bambu: 'Bambu Studio', orca: 'OrcaSlicer', prusa: 'PrusaSlicer', snapmaker: 'Snapmaker Orca', elegoo: 'ElegooSlicer',
    anycubic: 'Anycubic Slicer Next', creality: 'Creality Print' }[(location.pathname.split('/').filter(Boolean)[0] || '')] || 'Slicer';

  var base = null;
  try {
    var h = new URLSearchParams(location.hash.slice(1)), given = h.get('b3d-claude');
    if (given && /^https?:\/\//.test(given)) {
      localStorage.setItem(KEEP, given);
      h.delete('b3d-claude');
      // The key and the door stay for home-folder-sync.js, which reads them next.
      history.replaceState(null, '', location.pathname + location.search + (String(h) ? '#' + h : ''));
    }
    base = localStorage.getItem(KEEP);
  } catch (e) { /* no storage: no line */ }
  if (!base) return;
  base = base.replace(/\/+$/, '');

  function link() {
    try {
      // The key in the address is not kept yet when this runs first (home-folder-sync.js keeps it): read both.
      var hh = new URLSearchParams(location.hash.slice(1));
      if (hh.get('b3d-key')) return { key: hh.get('b3d-key'), door: hh.get('b3d-door'), anon: hh.get('b3d-anon') || '' };
      var l = JSON.parse(localStorage.getItem('b3d-slicer-home') || 'null');
      return l && l.key && /^https?:\/\//.test(l.door || '') ? l : null;
    } catch (e) { return null; }
  }
  var first = link();

  var hasDoor = function () { return typeof B3DDoor !== 'undefined' && !!B3DDoor.act; };
  var running = function () { return typeof Module !== 'undefined' && !!Module.wxRunning && !!Module.wxRunning(); };
  function info() {
    return { title: document.title, address: location.origin + location.pathname, showing: document.visibilityState === 'visible',
      program: PROGRAM, door: hasDoor(), ready: hasDoor() && running() };
  }

  // The printers door sits beside the slicer-home door (functions/v1/slicer-home -> functions/v1/printers).
  function printers(method, op, body) {
    var l = link() || first;
    if (!l) return Promise.resolve({ ok: false, error: 'This slicer tab is not linked to the Boolean3d account. Open it from Boolean3d.' });
    var headers = { 'x-slicer-key': l.key };
    if (l.anon) { headers.apikey = l.anon; headers.Authorization = 'Bearer ' + l.anon; }
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(l.door.replace(/\/+$/, '').replace(/[^\/]+$/, 'printers') + '/' + op, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'Boolean3d cannot be reached from the slicer tab. Is this computer online?' }; });
  }

  var NO_DOOR = PROGRAM + ' in the browser has no door for Claude yet: only Bambu Studio has. The person can slice here by hand.';
  function door(what, args) {
    if (!hasDoor()) return Promise.resolve({ ok: false, error: NO_DOOR });
    return B3DDoor.act(what, args || {});
  }

  var pause = function (ms) { return new Promise(function (go) { setTimeout(go, ms); }); };
  var partBytes = {};   // part id -> its 3MF, fetched once for this tab

  /** One of the person's parts (its 3MF, made by Boolean3d from its last save), onto the plate. */
  function addPart(args) {
    if (!args.part) return door('add_part', args);
    if (typeof Module === 'undefined' || !Module.b3dHome) return Promise.resolve({ ok: false, error: 'This slicer tab is not linked to the Boolean3d account. Open it from Boolean3d.' });
    var name = String(args.name || 'Part').replace(/\.3mf$/i, '').replace(/[\/\\]/g, '_');
    var t0 = Date.now();
    function put(bytes) {
      try { FS.mkdir('/tmp/door'); } catch (e) { /* there */ }
      var path = '/tmp/door/' + name + '.3mf';
      FS.writeFile(path, bytes);
      return door('add_part', { path: path });
    }
    function once() {
      return Module.b3dHome.ask('part', { id: args.part }).then(function (r) {
        if ((r.headers.get('content-type') || '').indexOf('json') >= 0) {
          return r.json().then(function (a) {
            if (a.code === 'not_ready' && Date.now() - t0 < 90000) return pause(2000).then(once);
            return { ok: false, error: a.error || 'The part could not be opened.' };
          });
        }
        if (!r.ok) return { ok: false, error: 'The part could not be fetched from Boolean3d (' + r.status + ').' };
        return r.arrayBuffer().then(function (b) { partBytes[args.part] = new Uint8Array(b); return put(partBytes[args.part]); });
      });
    }
    if (partBytes[args.part]) return put(partBytes[args.part]);
    return once().catch(function (e) { return { ok: false, error: 'The part could not be fetched: ' + (e && e.message || e) }; });
  }

  // Work that outlasts one ask (a slice, a fit): asked again under the same key, the ask joins the work under way, or
  // gets the answer it ended with. One piece of work at a time: the plate is one.
  var work = { key: null, going: null, answer: null };
  function long(key, start) {
    if (key && work.key === key) return work.going || Promise.resolve(work.answer);
    if (work.going) return Promise.resolve({ ok: false, code: 'busy', error: 'The slicer tab is still busy with the work asked before. Ask again in a moment.' });
    var mine = work = { key: key, going: null, answer: null };
    mine.going = Promise.resolve().then(start).then(null, function (e) { return { ok: false, error: 'The slicer tab could not do that: ' + (e && e.message || e) }; })
      .then(function (a) { mine.going = null; mine.answer = a; return a; });
    return mine.going;
  }

  /** A fresh plate set for one printer: its presets, then the parts with their copies, arranged. */
  function lay(args) {
    var sets = args.presets || {}, items = args.items || [];
    var steps = [function () { return door('tab', { to: 'prepare' }); }, function () { return door('new_project'); }];
    if (sets.printer) steps.push(function () { return door('pick_preset', { type: 'printer', name: sets.printer }); });
    (sets.filaments || []).slice(0, 1).forEach(function (f) { steps.push(function () { return door('pick_preset', { type: 'filament', filament: 1, name: f }); }); });
    if (sets.process) steps.push(function () { return door('pick_preset', { type: 'process', name: sets.process }); });
    (args.settings || []).forEach(function (s) { steps.push(function () { return door('settings', { tab: s.tab, set: s.set }); }); });
    items.forEach(function (it, i) {
      steps.push(function () { return addPart({ part: it.part, name: it.name }); });
      if (it.fill) steps.push(function () { return door('fill_bed', { object: i }); });
      else if (it.copies > 1) steps.push(function () { return door('clone', { object: i, copies: it.copies - 1 }); });
    });
    steps.push(function () { return door('arrange'); });
    steps.push(function () { return door('status'); });
    var last = null;
    return steps.reduce(function (p, step) {
      return p.then(function (bad) {
        if (bad) return bad;
        return step().then(function (a) {
          // A box in the way (a part that wants a question answered) is the person's to answer.
          if (!a.ok) return { ok: false, error: a.error, boxes: a.boxes };
          last = a; return null;
        });
      });
    }, Promise.resolve(null)).then(function (bad) { return bad || last; });
  }

  /**
   * How many fit one plate of this printer: one part alone, as many as the plate takes (the program's own Fill bed);
   * several parts, the most whole sets that arrange onto one plate.
   */
  function fit(args) {
    var items = args.items || [], most = Math.max(1, Math.min(200, args.most | 0 || 1));
    if (items.length === 1) {
      return lay({ presets: args.presets, items: [{ part: items[0].part, name: items[0].name, fill: true }] }).then(function (a) {
        if (!a.ok) return a;
        var n = (a.result.objects || []).reduce(function (sum, o) { return sum + (o.copies || 0); }, 0);
        // Fill bed keeps to one plate; a part too big for the bed lands on a plate of its own making.
        return { ok: true, result: { sets: a.result.plates > 1 ? 0 : Math.floor(n / (items[0].per || 1)) } };
      });
    }
    function tryK(k) {
      return lay({ presets: args.presets, items: items.map(function (it) { return { part: it.part, name: it.name, copies: k * (it.per || 1) }; }) })
        .then(function (a) { return a.ok ? a.result.plates === 1 : Promise.reject(new Error(a.error)); });
    }
    var lo = 0, hi = most;
    function step() {
      if (lo >= hi) return Promise.resolve({ ok: true, result: { sets: lo } });
      var mid = Math.ceil((lo + hi) / 2);
      return tryK(mid).then(function (ok) { if (ok) lo = mid; else hi = mid - 1; return step(); });
    }
    return tryK(most).then(function (all) { if (all) return { ok: true, result: { sets: most } }; hi = most - 1; return step(); })
      .then(null, function (e) { return { ok: false, error: e && e.message || String(e) }; });
  }

  /**
   * The plate, sliced, with its numbers and picture; and its printer file kept in this tab under `keep`, so what is
   * printed later is the plate that was shown, whatever the tab does in between.
   */
  function show(args) {
    var before = args.lay ? lay(args.lay) : Promise.resolve({ ok: true, result: { plates: 1 } });
    return before.then(function (l) {
      if (!l.ok) return l;
      if (args.lay && l.result.plates !== 1) return { ok: false, code: 'no_fit', error: 'These parts do not fit one plate of this printer (' + l.result.plates + ' plates after Arrange).' };
      return door('slice').then(function (r) {
        if (!r.ok) return r;
        return door('picture').then(function (p) {
          if (p.ok && p.result) r.result.png = p.result.png;
          if (!args.keep) return r;
          return door('export').then(function (x) {
            if (!x.ok) { r.result.file = null; r.result.fileSay = /has no "export"/.test(x.error || '') ? 'no_export' : x.error; return r; }
            var kept = '/tmp/door/' + String(args.keep).replace(/[^\w.-]/g, '_') + '.gcode.3mf';
            try {
              if (x.result.path !== kept) { FS.writeFile(kept, FS.readFile(x.result.path)); FS.unlink(x.result.path); }
              r.result.file = kept; r.result.bytes = FS.stat(kept).size;
            } catch (e) { r.result.file = null; r.result.fileSay = String(e && e.message || e); }
            return r;
          });
        });
      });
    });
  }

  /** The kept printer file of a shown plate, to the printer, through the account. */
  function send(args) {
    var bytes;
    try { bytes = FS.readFile(String(args.file || '')); } catch (e) { return Promise.resolve({ ok: false, code: 'changed', error: 'The sliced file of that plate is no longer in the slicer tab (it was reloaded or closed). Slice and show the plate again.' }); }
    if (args.bytes && bytes.length !== args.bytes) return Promise.resolve({ ok: false, code: 'changed', error: 'The sliced file is not the one that was shown. Slice and show the plate again.' });
    return printers('POST', 'print-upload', { printer: args.printer, print: args.print, bytes: bytes.length }).then(function (a) {
      if (!a || !a.ok) return { ok: false, code: a && a.code, error: (a && a.error) || 'Boolean3d did not take the file.' };
      var to = typeof Module !== 'undefined' && Module.b3dHome && Module.b3dHome.beside ? Module.b3dHome.beside(a.upload) : a.upload;
      return fetch(to, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }).then(function (put) {
        if (!put.ok) return { ok: false, error: 'The file did not reach the Boolean3d account (' + put.status + ').' };
        return printers('POST', 'print-start', { printer: args.printer, print: args.print, name: args.name, bytes: bytes.length, slots: args.slots }).then(function (s) {
          if (!s || !s.ok) return { ok: false, code: s && s.code, error: (s && s.error) || 'Boolean3d did not send it to the printer.' };
          try { FS.unlink(String(args.file)); } catch (e) { /* kept */ }
          return { ok: true, result: { print: s.print, bytes: bytes.length } };
        });
      }, function () { return { ok: false, error: 'The file did not reach the Boolean3d account. Is this computer online?' }; });
    });
  }

  /** A kept file no plate needs any more. */
  function forget(args) { try { FS.unlink(String(args.file || '')); } catch (e) { /* gone */ } return Promise.resolve({ ok: true, result: {} }); }

  function run(m) {
    var what = String(m.do || ''), args = m.args || {};
    var p;
    try {
      p = what === 'add_part' ? addPart(args)
        : what === 'show' ? long(args.key, function () { return show(args); })
        : what === 'fit' ? long(args.key, function () { return fit(args); })
        : what === 'lay' ? long(args.key, function () { return lay(args); })
        : what === 'send' ? send(args)
        : what === 'forget' ? forget(args)
        : what === 'export' ? Promise.resolve({ ok: false, error: 'the door has no "export" for Claude' })
        : door(what, args);
    } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(null, function (e) { return { ok: false, error: 'The slicer tab could not do that: ' + (e && e.message || e) }; })
      .then(function (answer) { say({ op: 'answer', id: m.id, answer: answer }); });
  }

  var ws = null, retry = 2000, told = '', off = false, opened = false;
  function say(m) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); } catch (e) { /* the line dropped: it comes back */ } }
  function connect() {
    if (ws || off) return;
    var l = link() || first;
    if (!l) { setTimeout(connect, 15000); return; }
    var line;
    try { line = new WebSocket(base.replace(/^http/, 'ws') + '/tab?kind=slicer', ['b3d', l.key]); } catch (e) { setTimeout(connect, retry); return; }
    ws = line;
    line.onopen = function () { opened = true; retry = 2000; told = JSON.stringify(info()); say({ op: 'hello', info: info() }); };
    line.onmessage = function (e) {
      if (e.data === 'pong') return;
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.op === 'act') run(m);
    };
    line.onclose = function (e) {
      if (ws === line) ws = null;
      // Claude taken off the account, or a key the account no longer has: this browser stops asking.
      if (e.code === 4403 || e.code === 4401) { off = true; try { localStorage.removeItem(KEEP); } catch (x) { /* */ } return; }
      // A line refused before it opened (not linked any more, a key gone) is asked for rarely.
      setTimeout(connect, retry); retry = Math.min(opened ? 60000 : 600000, retry * 2);
    };
    line.onerror = function () { /* onclose follows */ };
  }
  setInterval(function () { try { if (ws && ws.readyState === 1) ws.send('ping'); } catch (e) { /* */ } }, 25000);
  setInterval(function () {
    if (!ws || ws.readyState !== 1) return;
    var now = JSON.stringify(info());
    if (now !== told) { told = now; say({ op: 'info', info: info() }); }
  }, 1500);
  connect();
})();
