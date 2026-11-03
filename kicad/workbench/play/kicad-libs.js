// kicad-libs.js: KiCad's stock symbol and footprint libraries in the tab, read when KiCad reads them.
// The libraries: symbols one file per library (<Lib>.kicad_sym, 223 files, packed as KiCad's installers ship them; a
// 'flat' set), footprints folders of small files (<Lib>.pretty/<footprint>.kicad_mod, 15.4k files); 388 MB as text. Each library is one stored object (a "pack": a zero byte,
// then its files one after the other), fetched whole the first time any of its files is read. Every file is in the file
// system from the start with its real name and size, read-only, under KICAD10_SYMBOL_DIR / KICAD10_FOOTPRINT_DIR (kicad-pre.js):
// KiCad lists, stats and opens them as on a computer. The bytes are not kept in the file: a read copies them out of the
// pack, and only open and recently used packs stay in memory (KiCad reads every library once at a board or schematic open
// and keeps what it parsed; a later read fetches the pack again, from the browser's cache: the objects never change).
// window.KICAD_LIBS (kicad-libs-list.js, made by kicad-package.mjs): { base, tag, sets: { symbols: { dir, ext, libs: { <Lib>:
// [[file, bytes], ...] } }, footprints: {...} }, tables: { sym: text, fp: text } }.
// Also the stock library tables: written as KiCad's template (/kicad/share/kicad/template/{sym,fp}-lib-table), which its
// first-start wizard copies, and into a home folder whose global table is missing or lists no library (homes made before the
// libraries were in the tab got empty ones).
(function () {
  var L = window.KICAD_LIBS;
  if (!L) return;
  var stats = window.KICAD_LIBS_STATS = { packs: 0, bytes: 0, ms: 0, failed: [] };
  // A pack is kept as the text the request gave (one character per byte); a read copies out only the bytes it asks for. Packs
  // stay while any of their files is open, and up to KEEP of closed ones (least recently used goes first): KiCad loads every
  // library at start on several threads at once, each reading its files in small pieces, so a pack dropped while another
  // thread still reads it would be fetched and decoded again for every piece (kicad-gerbers-3: a 96 MB limit and whole-pack
  // decoding per read froze the page for minutes after the first-start wizard).
  var KEEP = 256e6, cache = new Map(), kept = 0, open = new Map();   // pack address -> text; pack address -> files open

  function packText(url, size) {
    var s = cache.get(url);
    if (s !== undefined) { cache.delete(url); cache.set(url, s); return s; }
    var t0 = performance.now(), x = new XMLHttpRequest();
    x.open('GET', url, false);
    // A synchronous request on the page cannot ask for bytes: text in the x-user-defined charset, one byte per character.
    x.overrideMimeType('text/plain; charset=x-user-defined');
    try { x.send(null); s = x.status === 200 ? x.responseText : null; } catch (e) { x = null; s = null; }
    if (s === null || s.length !== size + 1) {
      stats.failed.push(url);
      console.error('kicad: library ' + url + ' could not be read (' + (x ? x.status + ', ' + (s ? s.length : 0) + ' bytes, listed ' + (size + 1) : 'no answer') + ')');
      return null;
    }
    stats.packs++; stats.bytes += size; stats.ms += performance.now() - t0;
    cache.set(url, s); kept += size;
    for (var k of cache.keys()) {
      if (kept <= KEEP) break;
      if (k === url || open.get(k)) continue;
      kept -= cache.get(k).length - 1; cache.delete(k);
    }
    return s;
  }

  function libFile(FS, dir, name, size, url, packSize, at) {
    var node = FS.createFile(dir, name, {}, true, false);   // read-only: the stock libraries are not edited in place
    node.usedBytes = size;
    var ops = {
      llseek: node.stream_ops.llseek,
      open: function () { open.set(url, (open.get(url) || 0) + 1); },
      close: function () { open.set(url, Math.max(0, (open.get(url) || 0) - 1)); },
      read: function (stream, buffer, offset, length, position) {
        if (position >= size) return 0;
        var s = packText(url, packSize);
        if (s === null) throw new FS.ErrnoError(29);   // EIO: KiCad reports a read error for the library, not a wrong file
        var n = Math.min(length, size - position), from = 1 + at + position;
        for (var i = 0; i < n; i++) buffer[offset + i] = s.charCodeAt(from + i) & 255;
        return n;
      },
      write: function () { throw new FS.ErrnoError(2); },   // EACCES
    };
    node.stream_ops = ops;
    node.contents = null;
  }

  Module.preRun = Module.preRun || [];
  if (!Array.isArray(Module.preRun)) Module.preRun = [Module.preRun];
  Module.preRun.push(function () {
    var t0 = performance.now(), files = 0;
    Object.keys(L.sets).forEach(function (k) {
      var set = L.sets[k];
      FS.mkdirTree(set.dir);
      Object.keys(set.libs).forEach(function (lib) {
        var list = set.libs[lib], dir = set.flat ? set.dir : set.dir + '/' + lib + set.ext, total = 0;
        list.forEach(function (f) { total += f[1]; });
        var url = new URL(L.base + k + '/' + encodeURIComponent(lib) + '.pack', location.href).href;
        FS.mkdirTree(dir);
        var at = 0;
        list.forEach(function (f) { libFile(FS, dir, f[0], f[1], url, total, at); at += f[1]; files++; });
      });
    });
    FS.mkdirTree('/kicad/share/kicad/template');
    FS.writeFile('/kicad/share/kicad/template/sym-lib-table', L.tables.sym);
    FS.writeFile('/kicad/share/kicad/template/fp-lib-table', L.tables.fp);
    console.log('kicad: libraries ' + L.tag + ' in the tab: ' + files + ' files (' + Math.round(performance.now() - t0) + ' ms)');
  });

  // After the home folder is back (home-sync's run dependency) and before KiCad starts: a global table that is missing or
  // lists no library gets the stock one, as KiCad's first start would have made it.
  var prev = Module.onRuntimeInitialized;
  Module.onRuntimeInitialized = function () {
    var cfg = '/home/web_user/.config/kicad/' + (L.settings || '10.0');
    [['sym-lib-table', L.tables.sym], ['fp-lib-table', L.tables.fp]].forEach(function (t) {
      var f = cfg + '/' + t[0], had = FS.analyzePath(f).exists ? FS.readFile(f, { encoding: 'utf8' }) : null;
      if (had !== null && /\(lib\s/.test(had)) return;
      if (had === null && !FS.analyzePath(cfg + '/kicad_common.json').exists) return;   // first start: the wizard copies the template
      FS.mkdirTree(cfg); FS.writeFile(f, t[1]);
      console.log('kicad: ' + f + (had === null ? ' was missing' : ' listed no library') + ': the stock table written');
    });
    if (prev) prev.apply(this, arguments);
    prefetch();
  };

  // KiCad loads every library in the background as it starts (as on the desktop), and each first read of a pack is a request
  // that holds the page until it is answered. So the packs are asked for here first, a few at a time and without holding
  // anything: the browser keeps them (they never change), and KiCad's reads are then answered from its cache. Nothing is
  // kept in the page. Symbols first: the schematic's symbol chooser wants them all.
  function prefetch() {
    var urls = [];
    Object.keys(L.sets).forEach(function (k) {
      Object.keys(L.sets[k].libs).forEach(function (lib) { urls.push(new URL(L.base + k + '/' + encodeURIComponent(lib) + '.pack', location.href).href); });
    });
    var next = 0, done = 0, got = 0, t0 = performance.now();
    function one() {
      if (next >= urls.length) return;
      var url = urls[next++];
      fetch(url).then(function (r) { return r.ok && r.arrayBuffer().then(function () { got++; }); }).catch(function () {}).then(function () {
        if (++done === urls.length) console.log('kicad: libraries fetched ahead: ' + got + ' of ' + urls.length + ' (' + Math.round(performance.now() - t0) + ' ms)');
        one();
      });
    }
    for (var i = 0; i < 6; i++) one();
  }
})();
