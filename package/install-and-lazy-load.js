// install-and-lazy-load.js: the slicer's resource files that are not in its start download (<program>.data) are fetched the first time the
// program reads them. files.js (made by package.mjs, before this script) lists them as window.SLICER_FILES:
//   { cache, start: [names], base: 'files', files: [[path, bytes, skip?], ...], fonts: [{ path, family, weight, range }, ...] }
// (skip: the stored object has that many extra bytes in front, so it does not start with a byte-order mark).
// Each listed file appears in the file system at its path with its real size; its first read (or mmap) fetches the
// whole file by synchronous XHR (the program reads files synchronously) and from then on it is an ordinary file.
// The fonts the program never opens itself (the Japanese, Korean and symbol faces the port hands to the browser) are
// FontFaces by address, with the unicode-range their own character map covers: the browser downloads one the first
// time text needs it. The face of the program's language is loaded before the program starts, as the port does.
// Installed in the browser, like a program on a computer: the first visit downloads EVERY file
// of the version (the start files, every file listed here, the fonts, the web pages' files) into the origin's private
// file system (OPFS, see the install below) behind an install screen ("Downloading Bambu Studio, 120 of 170 MB"), and only
// then loads the program's script (<program>.js, named by the page). Every later visit reads everything from there: no file ever waits on the network, offline
// included. A file read synchronously comes from its copy as a blob: address (a synchronous request never reaches a
// service worker, but a blob: address is read from the browser's own storage); the service worker (wxwebview-sw.js +
// slicer-cache-service-worker.js) answers every other request from the same copy. A new version downloads only the files whose
// content changed: the others are kept (files are stored by content), the rest of the previous version is dropped. The browser
// is asked to keep the storage (navigator.storage.persist()). Without OPFS (or when it is full) the program
// starts anyway and fetches a file the first time it is read, as before.
// Once the program is up, the files its screens show (pictures, HMS pictures and texts, its translations, the maker's
// own profiles) are put in place from the copy in the background, so their first read costs nothing at all.
(function () {
  var L = window.SLICER_FILES;
  if (!L) return;
  var P = window.SLICER_PAGE || {};
  var NAME = { bambu: 'Bambu Studio', orca: 'OrcaSlicer', prusa: 'PrusaSlicer' }[P.app] || 'the slicer';
  var stats = window.SLICER_LAZY = { files: 0, bytes: 0, ms: 0, failed: [], blobReads: 0 };
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (p) { return p || navigator.storage.persist(); }).catch(function () {});
  }
  Module.preRun = Module.preRun || [];
  if (!Array.isArray(Module.preRun)) Module.preRun = [Module.preRun];
  var abs = function (u) { return new URL(u, location.href).href; };
  var urlOf = function (path) { return L.base + path.split('/').map(encodeURIComponent).join('/'); };
  var blobs = {};   // address -> blob: address of the browser's copy
  var fill = {}, have = {};   // address -> put the bytes in place; address -> already in place
  // main() in a worker (the off-thread recipe): where a lazy file's bytes are, for a worker that fetches the file itself as
  // bytes (a worker may ask synchronously for bytes; the page may not, see fetchSync): the browser's copy as a blob: address
  // when there is one, else the network address, and the bytes to skip in front. Asked after the program's start (the copy's
  // addresses are made before the 'b3d-files' dependency clears).
  stats.blobOf = function (path) {
    for (var i = 0; i < L.files.length; i++) if (L.files[i][0] === path) {
      var u = abs(urlOf(path)); return { url: blobs[u] || u, skip: L.files[i][2] || 0, size: L.files[i][1] };
    }
    return null;
  };

  // One whole file, synchronously. A binary response type is refused for a synchronous request on the page, so the
  // bytes come as text in the x-user-defined charset (each byte one character, high bytes in U+F780..U+F7FF).
  function fetchSync(url, skip) {
    var t0 = performance.now(), x = new XMLHttpRequest(), b = blobs[abs(url)];
    x.open('GET', b || url, false);
    x.overrideMimeType('text/plain; charset=x-user-defined');
    try { x.send(null); } catch (e) { return null; }
    if (x.status !== 200 && !(b && x.status === 0 && x.responseText)) return null;
    var s = x.responseText, n = s.length - skip, out = new Uint8Array(Math.max(n, 0));
    for (var i = 0; i < n; i++) out[i] = s.charCodeAt(i + skip) & 255;
    stats.files++; stats.bytes += n; stats.ms += performance.now() - t0;
    if (b) stats.blobReads++;
    have[abs(url)] = 1;
    return out;
  }

  function lazyFile(FS, path, size, skip) {
    var cut = path.lastIndexOf('/');
    FS.mkdirTree(path.slice(0, cut));
    var node = FS.createFile(path.slice(0, cut), path.slice(cut + 1), {}, true, false);
    var ops = node.stream_ops, loaded = false;
    // Until loaded, the file's size is the listed size (stat, seek to end); a write or truncate first settles it.
    Object.defineProperty(node, 'usedBytes', { configurable: true, enumerable: true,
      get: function () { return size; },
      set: function (v) { settle(null); node.usedBytes = v; } });
    function settle(bytes) {
      if (loaded) return;
      loaded = true;
      delete node.usedBytes;
      node.contents = bytes;
      node.usedBytes = bytes ? bytes.length : 0;
      node.stream_ops = ops;
    }
    function load() {
      if (loaded) return;
      var b = fetchSync(urlOf(path), skip || 0);
      if (!b || b.length !== size) {
        stats.failed.push(path);
        console.error('slicer file ' + path + ': ' + (b ? b.length + ' bytes, listed ' + size : 'could not be read'));
        throw new FS.ErrnoError(29);   // EIO: the program sees a read error, not a wrong file
      }
      settle(b);
    }
    var wrapped = {};
    Object.keys(ops).forEach(function (k) {
      wrapped[k] = k === 'llseek' ? ops[k] : function () { load(); return ops[k].apply(this, arguments); };
    });
    node.stream_ops = wrapped;
    return function (bytes) { if (bytes.length === size) settle(bytes); };
  }

  // ── The install ──
  // Every file of this version: [address, unpacked bytes, content hash]. The page itself (index.html) is kept by the
  // service worker; files.js has no hash (it lists the hashes) and is always taken whole.
  function installList() {
    var up = new URL('../', location.href).href;
    var list = [[abs('files.js'), 0, '']];
    (L.startFiles || []).forEach(function (f) { list.push([abs(f[0]), f[1], f[2]]); });
    L.files.forEach(function (f) { list.push([abs(urlOf(f[0])), f[1] + (f[2] || 0), f[3]]); });
    (L.fonts || []).forEach(function (f) { list.push([abs(urlOf(f.path)), f.bytes || 0, f.hash]); });
    (L.top || []).forEach(function (f) { list.push([new URL(f[0].split('/').map(encodeURIComponent).join('/'), up).href, f[1], f[2]]); });
    return list;
  }
  // The copy lives in the origin's private file system (OPFS), like a program's folder on a computer:
  //   b3d-slicer/<app>/objects/<content hash>   every file, once, whatever version or address uses it
  //   b3d-slicer/<app>/<SLICER_FILES.cache>.json   { complete, version, files: { address: object }, types: { object:
  //   content type }, headers: the host's cross-origin-* headers }, written last
  // (Cache Storage lost most of its entries 30-60 s after a complete install, with nothing of ours deleting them:
  // a later visit then found no program script and stopped. Files in OPFS are ordinary files.) slicer-cache-service-worker.js reads the
  // same folder. A new version downloads only the objects it does not have yet; the objects no version uses are
  // removed after the install.
  var PREFIX = 'b3d-slicer-files-' + (P.app || '') + '-';
  function objectName(f) { return f[2] || ('u' + djb(f[0])); }   // files.js has no hash: named by its address
  function djb(s) { var a = 5381, b = 52711; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a = (a * 33) ^ c; b = (b * 31) ^ c; } return (a >>> 0).toString(16) + (b >>> 0).toString(16); }
  function store() {
    if (!navigator.storage || !navigator.storage.getDirectory || !L.cache || !L.startFiles) return Promise.resolve(null);
    return navigator.storage.getDirectory()
      .then(function (root) { return root.getDirectoryHandle('b3d-slicer', { create: true }); })
      .then(function (d) { return d.getDirectoryHandle(P.app || 'app', { create: true }); })
      .then(function (appDir) {
        return appDir.getDirectoryHandle('objects', { create: true }).then(function (objects) { return { app: appDir, objects: objects }; });
      });
  }
  function readJson(dir, name) {
    return dir.getFileHandle(name).then(function (h) { return h.getFile(); }).then(function (f) { return f.text(); })
      .then(function (t) { return JSON.parse(t); }, function () { return null; });
  }
  function writeFile(dir, name, body) {
    return dir.getFileHandle(name, { create: true }).then(function (h) { return h.createWritable(); }).then(function (w) {
      if (body && typeof body.pipeTo === 'function') return body.pipeTo(w);   // closes w when the stream ends
      return w.write(body).then(function () { return w.close(); });
    });
  }
  function names(dir) {
    var out = {}, it = dir.entries();
    function step() { return it.next().then(function (r) { if (r.done) return out; if (r.value[1].kind === 'file') out[r.value[0]] = 1; return step(); }); }
    return step();
  }
  function install() {
    var s, list = installList();
    return store().then(function (st) {
      if (!st) return null;
      s = st;
      return readJson(s.app, L.cache + '.json').then(function (done) {
        if (done && done.complete && done.files) { s.files = done.files; return s; }
        return fillStore(s, list).then(function () { return s; });
      });
    }).catch(function (e) {
      console.error('slicer install: ' + e);
      screen(null, NAME + ' could not be saved in this browser (' + (e && e.name || e) + '): it starts from the network.');
      return null;
    });
  }
  function fillStore(s, list) {
    var sentPerRaw = P.installRaw ? (P.installSent || P.installRaw) / P.installRaw : 1, total = 0, got = 0, reused = 0;
    var files = {}, types = {}, iso = {}, want = {}, update = false;
    list.forEach(function (f) { total += f[1]; files[f[0]] = objectName(f); });
    return names(s.app).then(function (versions) {
      var others = Object.keys(versions).filter(function (n) { return n.indexOf(PREFIX) === 0 && n !== L.cache + '.json'; });
      update = others.length > 0;
      return Promise.all(others.map(function (n) {   // the content types of the objects kept from earlier versions
        return readJson(s.app, n).then(function (j) {
          if (j && j.types) Object.keys(j.types).forEach(function (k) { types[k] = j.types[k]; });
          if (j && j.headers) Object.keys(j.headers).forEach(function (k) { iso[k] = j.headers[k]; });
        });
      }));
    }).then(function () { return names(s.objects); }).then(function (have) {
      var todo = list.filter(function (f) {
        var n = files[f[0]];
        if (have[n] || want[n]) { got += f[1]; if (!want[n]) reused += f[1]; return false; }
        want[n] = 1; return true;
      });
      var word = update ? 'Updating ' : 'Downloading ';
      var show = function () {
        var left = total - reused;
        screen((got - reused) / Math.max(left, 1), word + NAME + ', ' + Math.round((got - reused) * sentPerRaw / 1e6) + ' of '
          + Math.round(left * sentPerRaw / 1e6) + ' MB');
      };
      show();
      var timer = setInterval(show, 250);
      function download(f, tries) {
        tries = tries || 0;
        var counted = 0;
        return fetch(f[0]).then(function (r) {
          if (!r.ok) throw new Error(f[0] + ' ' + r.status);
          if (r.headers.get('content-type')) types[files[f[0]]] = r.headers.get('content-type');
          // the host's isolation headers: a page of the web view answered from the copy needs them (the slicer page is
          // cross-origin isolated, require-corp)
          r.headers.forEach(function (v, k) { if (/^cross-origin-/.test(k)) iso[k] = v; });
          // counted as it arrives, for the install screen
          var count = new TransformStream({ transform: function (chunk, ctl) { counted += chunk.length; got += chunk.length; ctl.enqueue(chunk); } });
          return writeFile(s.objects, files[f[0]], r.body.pipeThrough(count)).then(function () {
            if (f[1] && counted !== f[1]) console.error('slicer install: ' + f[0] + ': ' + counted + ' bytes, listed ' + f[1]);
          });
        }).catch(function (e) {
          got -= counted;
          if (e && e.name === 'QuotaExceededError') throw e;
          if (tries >= 4) {   // no network: keep trying, the screen says so
            screen(null, 'Waiting for the network to finish downloading ' + NAME + '…');
            return new Promise(function (res) { setTimeout(res, 5000); }).then(function () { return download(f, 0); });
          }
          return new Promise(function (res) { setTimeout(res, 1000 * (tries + 1)); }).then(function () { return download(f, tries + 1); });
        });
      }
      var queue = todo.slice();
      function worker() { var f = queue.shift(); return f ? download(f).then(worker) : null; }
      var jobs = [];
      for (var i = 0; i < 6; i++) jobs.push(worker());
      return Promise.all(jobs).then(function () {
        clearInterval(timer);
        s.files = files;
        // Complete: written last, so a visit that stopped half way carries on where it was on the next one.
        return writeFile(s.app, L.cache + '.json', JSON.stringify({ complete: true, version: P.version, files: files, types: types, headers: iso }));
      }).then(function () { return dropOld(s); })
        .then(function () { console.log('slicer installed: ' + Math.round(total / 1e6) + ' MB, ' + Math.round(reused / 1e6) + ' MB kept from the last version'); });
    });
  }
  // Earlier versions (their records, and the objects only they used); also the Cache Storage copies of the loader
  // before this one.
  function dropOld(s) {
    var keep = {};
    Object.keys(s.files).forEach(function (u) { keep[s.files[u]] = 1; });
    return names(s.app).then(function (versions) {
      return Promise.all(Object.keys(versions).filter(function (n) { return n.indexOf(PREFIX) === 0 && n !== L.cache + '.json'; })
        .map(function (n) { return s.app.removeEntry(n); }));
    }).then(function () { return names(s.objects); }).then(function (have) {
      return Promise.all(Object.keys(have).filter(function (n) { return !keep[n]; }).map(function (n) { return s.objects.removeEntry(n).catch(function () {}); }));
    }).then(function () {
      if (typeof caches === 'undefined') return;
      return caches.keys().then(function (ns) {
        return Promise.all(ns.filter(function (n) { return n.indexOf(PREFIX) === 0; }).map(function (n) { return caches.delete(n); }));
      });
    }).catch(function (e) { console.error('slicer install: old versions not removed: ' + e); });
  }
  function screen(share, text) { if (window.SLICER_CREDIT) window.SLICER_CREDIT.show(share, text); }

  // ── The program's files, from the copy ──
  Module.preRun.push(function () {
    var FS = Module.FS;
    L.files.forEach(function (f) { fill[abs(urlOf(f[0]))] = lazyFile(FS, f[0], f[1], f[2]); });
    Module.addRunDependency('b3d-files');
    var t0 = performance.now();
    (copy || Promise.resolve(null)).then(function (s) {
      if (!s) return;
      return Promise.all(Object.keys(fill).map(function (u) {
        var n = s.files[u];
        if (!n) return null;
        return s.objects.getFileHandle(n).then(function (h) { return h.getFile(); })
          .then(function (file) { blobs[u] = URL.createObjectURL(file); }, function () { /* read from the network */ });
      }));
    }).then(function () { stats.copies = Object.keys(blobs).length; stats.copyMs = Math.round(performance.now() - t0); })
      .catch(function (e) { console.error('slicer files from browser storage: ' + e); })
      .then(function () { Module.removeRunDependency('b3d-files'); });
  });
  // After the program has started (not in postRun: the program's main loop never returns).
  Module.preRun.push(function () {
    var monitor = Module.monitorRunDependencies, once = false;
    Module.monitorRunDependencies = function (left) {
      if (monitor) monitor.apply(this, arguments);
      if (left || once) return;
      once = true;
      setTimeout(ahead, 3000);
    };
  });

  // The files the program's screens show, put in place in the background (see the top): pictures first, then the
  // fonts (PrusaSlicer's ImGui loads a 12 MB CJK font at the first notice with a glyph NotoSans lacks), the HMS
  // pictures, the HMS texts and translations of its language (and English, which it falls back to), the maker's
  // profiles. From the browser's copy; without one, from the network.
  function ahead() {
    var lang = (settingsLanguage() || (navigator.language || '').slice(0, 2) || 'en').toLowerCase();
    var tests = [/\/resources\/(images|icons)\//, /\/resources\/fonts\//, /\/resources\/hms\/local_image\//,
      new RegExp('/resources/hms/hms_(en|' + lang + ')_'), new RegExp('/resources/i18n/' + lang + '(_|/)'),
      /\/resources\/profiles\/(BBL|PrusaResearch)(\.|\/)/];
    var queue = [];
    tests.forEach(function (t) { L.files.forEach(function (f) { if (t.test(f[0]) && queue.indexOf(f) < 0) queue.push(f); }); });
    var t0 = performance.now(), got = 0, bytes = 0;
    function next() {
      var f = queue.shift();
      while (f && have[abs(urlOf(f[0]))]) f = queue.shift();
      if (!f) return null;
      var u = abs(urlOf(f[0]));
      return fetch(blobs[u] || u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(function (b) {
          if (have[u]) return;   // read meanwhile
          var bytesIn = new Uint8Array(b).subarray(f[2] || 0);
          if (bytesIn.length !== f[1]) return;
          fill[u](bytesIn); have[u] = 1; got++; bytes += bytesIn.length;
        }).catch(function () { /* read when first needed instead */ }).then(next);
    }
    Promise.all([next(), next(), next()]).then(function () {
      stats.ahead = { files: got, bytes: bytes, ms: Math.round(performance.now() - t0) };
      console.log('slicer files put in place ahead: ' + got + ' (' + (bytes / 1e6).toFixed(1) + ' MB) in ' + stats.ahead.ms + ' ms');
    });
  }
  function settingsLanguage() {
    var prusa = P.app === 'prusa';
    try {
      var c = new TextDecoder().decode(Module.FS.readFile(prusa ? '/home/web_user/.config/PrusaSlicer/PrusaSlicer.ini'
        : '/home/web_user/.BambuStudio/BambuStudio.conf'));
      var m = (prusa ? /^translation_language\s*=\s*([a-z]+)/m : /"language"\s*:\s*"([a-z]+)/).exec(c);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  // Install, then start the program (its script, which the page does not load itself).
  var copy = install();
  copy.then(function (c) {
    window.SLICER_INSTALLED = !!c;
    screen(1, 'Starting ' + NAME + '…');
    var s = document.createElement('script');
    var page = window.SLICER_PAGE || {};
    s.src = (page.program || 'index') + '.js'; s.async = true;
    (document.body || document.documentElement).appendChild(s);
  });

  if (typeof FontFace === 'undefined' || !L.fonts || !L.fonts.length) return;
  // Label::sysFont (slic3r/GUI/Widgets/Label.cpp): Japanese draws in Source Han Sans JP, Korean in NanumGothic.
  var LANG = { 'Source Han Sans JP Normal': 'ja', 'NanumGothic': 'ko' };
  var faces = L.fonts.map(function (f) {
    var face = new FontFace(f.family, 'url("' + L.base + f.path.split('/').map(encodeURIComponent).join('/') + '")',
      { weight: f.weight, style: 'normal', unicodeRange: f.range });
    document.fonts.add(face);
    return face;
  });
  // main() in a worker (the off-thread recipe): the worker draws the text with its own font set; app-fonts.js posts
  // this list to it and it makes the same faces by address (.load = wanted before the first paint, set in start())
  Module.wxLazyFonts = L.fonts.map(function (f) {
    return { family: f.family, weight: f.weight, style: 'normal', range: f.range,
             url: new URL(L.base + f.path.split('/').map(encodeURIComponent).join('/'), location.href).href };
  });
  // A face that arrives after the program measured text with a stand-in: have the program lay out and draw again.
  document.fonts.addEventListener('loadingdone', function (e) {
    if (e.fontfaces.some(function (f) { return faces.indexOf(f) >= 0; })) window.dispatchEvent(new Event('resize'));
  });
  // The program's language: its settings file once the other start steps are done (the settings are restored from
  // browser storage before then), else the browser's language, as the program picks it on a first start.
  function language() {
    // PrusaSlicer: an INI file, translation_language = de_DE; Bambu Studio: JSON, "language": "de_DE"
    var prusa = (window.SLICER_PAGE || {}).app === 'prusa';
    try {
      var c = new TextDecoder().decode(Module.FS.readFile(prusa ? '/home/web_user/.config/PrusaSlicer/PrusaSlicer.ini'
        : '/home/web_user/.BambuStudio/BambuStudio.conf'));
      var m = (prusa ? /^translation_language\s*=\s*([a-z]+)/m : /"language"\s*:\s*"([a-z]+)/).exec(c);
      if (m) return m[1];
    } catch (e) { /* first start: no settings yet */ }
    return (navigator.language || '').slice(0, 2);
  }
  Module.preRun.push(function () {
    Module.addRunDependency('b3d-fonts');
    var done = false, last = Infinity, monitor = Module.monitorRunDependencies;
    // Wait until only this step and the port's own font step (app-fonts, which waits for everything else) remain.
    function start() {
      if (done) return;
      done = true;
      var lang = language();
      Module.wxLazyFonts.forEach(function (e) { e.load = LANG[e.family] === lang; });
      var jobs = faces.filter(function (f) { return LANG[f.family] === lang; }).map(function (f) {
        return f.load().catch(function (e) { console.error('font ' + f.family + ': ' + e); });
      });
      Promise.all(jobs).then(function () { Module.removeRunDependency('b3d-fonts'); });
    }
    Module.monitorRunDependencies = function (left) {
      if (monitor) monitor.apply(this, arguments);
      if (left <= 2 && left < last) setTimeout(start, 0);
      last = left;
    };
  });
})();
