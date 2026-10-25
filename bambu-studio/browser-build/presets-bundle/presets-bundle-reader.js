// presets-bundle-reader.js (off-thread phase 2g + 2h): a pre-js, so it runs on the page and in every pthread worker. In a pthread every
// file call is a round trip to the page's file system (~165 us each on a Windows desktop). The vendor preset files (Bambu:
// 2,500 JSON files read one by one at start-up, 12,900 calls; Orca: every vendor, 10,700 files, 115,000 calls) come instead
// from ONE bundle file read ONCE into the wasm heap, which every thread shares (phase 2h; before, each of the 8 pool threads
// read its own copy): open, read, seek, stat and close of a path under a bundled folder never leave the worker. Directory
// listings, writes and every other path still go to the page. The bundle is written by write-presets-bundle.py from the same files, so
// the bytes a reader gets are the files' own. The page thread serves the real files. The threads find the shared copy
// through b3d_bundle_slots (web_console_log.cpp): per bundle [state, address, size, 0], state 0 none, 1 loading, 2 ready,
// 3 failed, [3] = address of "url\nskip" written by the page (phase 2i, below); slot 60 counts chdir calls (the getcwd cache
// below). WXFS_BUNDLES and WXFS_LINKS are filled in by write-presets-bundle.py.
(function () {
  var BUNDLES = WXFS_BUNDLES_PLACEHOLDER;
  var LINKS = WXFS_LINKS_PLACEHOLDER;
  var pt = function () { return typeof ENVIRONMENT_IS_PTHREAD !== 'undefined' && ENVIRONMENT_IS_PTHREAD; };
  var H = function () { if (typeof growMemViews === 'function') growMemViews(); };
  var slots = function () { var f = typeof wasmExports !== 'undefined' && wasmExports['b3d_bundle_slots_addr']; return f ? f() >>> 0 : 0; };
  // Orca copies the enabled vendors' preset files from resources/profiles into its data folder's system/ on EVERY load (the
  // tab's file system starts empty; home-folder-sync never keeps system/): links instead, made on the page before main() runs,
  // for the vendors the restored config enables plus the two Orca always installs. The updater then finds the same
  // version in both places and copies nothing (PresetUpdater::priv::check_installed_vendor_profiles). Bambu has the same
  // for BBL in start-up.js (phase 2d).
  if (!pt() && (LINKS || (BUNDLES && BUNDLES.length))) {
    var prev = Module['onRuntimeInitialized'];
    Module['onRuntimeInitialized'] = function () {
      if (LINKS) try {
        var names = LINKS.always.slice();
        try { var conf = JSON.parse(FS.readFile(LINKS.data + '/' + LINKS.conf, { encoding: 'utf8' })); (conf.models || []).forEach(function (m) { if (m.vendor && names.indexOf(m.vendor) < 0) names.push(m.vendor); }); } catch (e) {}
        FS.mkdirTree(LINKS.data + '/system'); var made = [];
        names.forEach(function (v) {
          [v, v + '.json'].forEach(function (n) {
            var at = LINKS.data + '/system/' + n;
            try { FS.lstat(at); return; } catch (e) {}
            try { FS.stat(LINKS.res + '/' + n); } catch (e) { return; }   // no such vendor in this build
            try { FS.symlink(LINKS.res + '/' + n, at); made.push(n); } catch (e) { console.warn('wxfs: system link', n, e); }
          });
        });
        console.log('wxfs: system links for ' + names.join(' ') + ' (' + made.length + ' made)');
      } catch (e) { console.warn('wxfs: system links', e); }
      // Phase 2i: where each bundle file's bytes are, for the worker that loads it. A bundle that is not in the start download is
      // a lazy file of the package: read through the page it costs a synchronous request for TEXT plus a loop over every byte
      // (Orca's 44 MB: ~0.7 s with the page frozen). The worker fetches it itself instead (load() below), as bytes, from the
      // browser's copy (a blob: address of the installed file) or the network; install-and-lazy-load.js tells where (SLICER_LAZY.blobOf). A
      // bundle inside index.data has no address here and is read through the page as before (a copy out of its memory).
      try {
        var sb = slots(), lz = typeof window !== 'undefined' && window.SLICER_LAZY;
        if (sb && lz && lz.blobOf) (BUNDLES || []).forEach(function (b, i) {
          var at = lz.blobOf(b.file); if (!at) return;
          H(); HEAP32[(sb >>> 2) + i * 4 + 3] = stringToNewUTF8(at.url + '\n' + (at.skip || 0));
        });
      } catch (e) { console.warn('wxfs: bundle addresses', e); }
      if (prev) return prev.apply(this, arguments);
    };
  }
  if (!BUNDLES || !BUNDLES.length) return;
  var orig = { openat: ___syscall_openat, read: _fd_read, seek: _fd_seek, close: _fd_close, fstat: ___syscall_fstat64,
    newfstatat: ___syscall_newfstatat, stat: ___syscall_stat64, fdstat: _fd_fdstat_get, fcntl: ___syscall_fcntl64,
    ioctl: ___syscall_ioctl, fadvise: ___syscall_fadvise64, getcwd: ___syscall_getcwd, chdir: ___syscall_chdir,
    readlinkat: typeof ___syscall_readlinkat === 'function' ? ___syscall_readlinkat : null, unlinkat: typeof ___syscall_unlinkat === 'function' ? ___syscall_unlinkat : null,
    renameat: typeof ___syscall_renameat === 'function' ? ___syscall_renameat : null, mkdirat: typeof ___syscall_mkdirat === 'function' ? ___syscall_mkdirat : null,
    symlinkat: typeof ___syscall_symlinkat === 'function' ? ___syscall_symlinkat : null, rmdir: typeof ___syscall_rmdir === 'function' ? ___syscall_rmdir : null };
  var nextFd = 1 << 20, open = {}, loaded = {}, served = 0;
  var norm = function (p) { return (typeof PATH !== 'undefined' && PATH.normalize) ? PATH.normalize(p) : p; };
  // the bundle entry a path names: { b, rel } or null
  var lookup = function (p) {
    p = norm(p);
    for (var i = 0; i < BUNDLES.length; i++) {
      var roots = BUNDLES[i].roots, sys = BUNDLES[i].sys || {};
      for (var r in roots) {
        if (r.slice(-1) === '/') { if (p.indexOf(r) === 0) return { b: BUNDLES[i], i: i, rel: roots[r] + p.slice(r.length) }; }
        else if (p === r) return { b: BUNDLES[i], i: i, rel: roots[r] };
      }
      // the data folder's system/<vendor>: the same bytes only while it is a link into resources/ (the slicer installs a
      // vendor by copying it there, and decides whether to by whether the files exist: never answer for files it has not made)
      for (var q in sys) {
        var v = sys[q], hit = q.slice(-1) === '/' ? p.indexOf(q) === 0 : p === q;
        if (hit && linked(v.at, v.to)) return { b: BUNDLES[i], i: i, rel: q.slice(-1) === '/' ? v.rel + p.slice(q.length) : v.rel };
      }
    }
    return null;
  };
  // is <at> (a path in the data folder's system/) a link to <to> (under resources/)? One readlink per vendor per thread, kept
  // until any thread changes something under system/ (slot 61 counts those changes: unlink, rename, mkdir, symlink, rmdir)
  var links = {}, linkGen = -1;
  var sysGen = function () { var sb = slots(); if (!sb) return -1; H(); return Atomics.load(HEAP32, (sb >>> 2) + 61); };
  var linked = function (at, to) {
    var g = sysGen(); if (g !== linkGen) { links = {}; linkGen = g; }
    if (at in links) return links[at];
    if (!orig.readlinkat) return links[at] = false;   // no readlink in this build: system/ stays the page's
    var pp = stringToNewUTF8(at), buf = _malloc(1024), n = orig.readlinkat(-100, pp, buf, 1023), r = false;
    if (n > 0) { H(); r = UTF8ToString(buf, n) === to; }
    _free(buf); _free(pp);
    return links[at] = r;
  };
  var SYS = BUNDLES.map(function (b) { return Object.keys(b.sys || {}).map(function (q) { return q.replace(/[^/]*\/?$/, ''); }); }).reduce(function (a, b) { return a.concat(b); }, []).filter(function (x, i, a) { return a.indexOf(x) === i; });
  var underSys = function (ptr) { var p = norm(UTF8ToString(ptr >>> 0)); return SYS.some(function (d) { return p.indexOf(d) === 0; }); };
  var bump = function () { var sb = slots(); if (sb) { H(); Atomics.add(HEAP32, (sb >>> 2) + 61, 1); } links = {}; };
  // the bundle file's bytes in the heap, read whole through the page by the first thread that needs them, then shared:
  // { ptr, base, size, index } or false. The index (one JSON line) is parsed once per thread.
  var load = function (b, i) {
    if (b.file in loaded) return loaded[b.file];
    loaded[b.file] = false;
    var sb = slots(); if (!sb) { console.log('wxfs: no bundle slots in this build'); return false; }
    H(); var s = (sb >>> 2) + i * 4;
    var st = Atomics.compareExchange(HEAP32, s, 0, 1), how = 'shared with';
    if (st === 0) {
      var size = -1, buf = 0, got = 0, fd = -1, ap = HEAP32[s + 3];
      // phase 2i: fetched here, in this worker, as bytes (a worker may ask for a file synchronously; the page may not): one
      // request, one copy into the heap. The page wrote the address (see the top). Anything wrong: the proxied read below.
      if (ap) try {
        var parts = UTF8ToString(ap >>> 0).split('\n'), x = new XMLHttpRequest(), t0 = performance.now();
        x.open('GET', parts[0], false); x.responseType = 'arraybuffer'; x.send(null);
        if (x.response && (x.status === 200 || (x.status === 0 && parts[0].indexOf('blob:') === 0))) {
          var a = new Uint8Array(x.response, Number(parts[1]) || 0);
          size = a.length; buf = size > 0 ? _malloc(size) : 0;
          if (buf) { H(); HEAPU8.set(a, buf); got = size; how = 'fetched in ' + Math.round(performance.now() - t0) + ' ms by'; }
        } else console.log('wxfs: bundle ' + b.file + ': fetch answered ' + x.status + ', reading it through the page instead');
      } catch (e) { console.log('wxfs: bundle ' + b.file + ': fetch failed (' + e + '), reading it through the page instead'); if (buf) _free(buf); buf = 0; got = 0; size = -1; }
      var tmp = _malloc(16);
      if (!(buf && got === size)) { var p = stringToNewUTF8(b.file); fd = orig.openat(-100, p, 0, 0); _free(p); how = 'read into the heap by'; }
      if (fd >= 0) {
        if (orig.seek(fd, 0n, 2, tmp) === 0) { H(); size = Number(HEAP64[tmp >>> 3]); orig.seek(fd, 0n, 0, tmp); }
        buf = size > 0 ? _malloc(size) : 0;
        while (buf && got < size) {
          H(); HEAPU32[tmp >>> 2] = buf + got; HEAPU32[(tmp + 4) >>> 2] = size - got;
          var rc = orig.read(fd, tmp, 1, tmp + 8); H(); var n = HEAPU32[(tmp + 8) >>> 2];
          if (rc !== 0 || !n) break;
          got += n;
        }
        orig.close(fd);
      }
      _free(tmp); H();
      if (buf && got === size) { HEAP32[s + 1] = buf; HEAP32[s + 2] = size; Atomics.store(HEAP32, s, 2); }
      else { if (buf) _free(buf); Atomics.store(HEAP32, s, 3); console.log('wxfs: bundle ' + b.file + (fd < 0 ? ' missing (' + fd + ')' : ' read ' + got + ' of ' + size + ' bytes') + ': not used'); }
      Atomics.notify(HEAP32, s);
      st = Atomics.load(HEAP32, s);
    } else {
      while (st === 1) { if (pt()) Atomics.wait(HEAP32, s, 1, 1000); H(); st = Atomics.load(HEAP32, s); }
    }
    if (st !== 2) return false;
    H(); var ptr = HEAP32[s + 1] >>> 0, size2 = HEAP32[s + 2] >>> 0;
    var nl = HEAPU8.subarray(ptr, ptr + Math.min(size2, 1 << 26)).indexOf(10), index;
    if (nl < 0) { console.log('wxfs: bundle ' + b.file + ': no index line'); return false; }
    try { index = JSON.parse(new TextDecoder().decode(HEAPU8.slice(ptr, ptr + nl))); } catch (e) { console.log('wxfs: bundle ' + b.file + ' index: ' + e); return false; }
    var ino = 1; for (var k in index) index[k].push(ino++);   // [off, len, mtime, ino]
    var r = loaded[b.file] = { ptr: ptr, base: ptr + nl + 1, size: size2, index: index };
    console.log('wxfs: bundle ' + b.file + ': ' + (ino - 1) + ' files, ' + (size2 / 1048576).toFixed(1) + ' MB, ' + how + ' this thread');
    return r;
  };
  var entry = function (p) { var h = lookup(p); if (!h) return null; var b = load(h.b, h.i); if (!b) return null; var e = b.index[h.rel]; return e ? { off: b.base + e[0], len: e[1], mtime: e[2], ino: e[3] } : null; };
  var statOf = function (e) { var t = new Date(e.mtime * 1000); return { dev: 1, mode: 33188, nlink: 1, uid: 0, gid: 0, rdev: 0, size: e.len, blocks: Math.ceil(e.len / 512), atime: t, mtime: t, ctime: t, ino: e.ino }; };
  var O_WRITE = 1 | 2 | 64 | 512 | 1024 | 65536;   // WRONLY, RDWR, CREAT, TRUNC, APPEND, DIRECTORY: the page's job
  ___syscall_openat = function (dirfd, path, flags, varargs) {
    if (pt() && !(flags & O_WRITE)) {
      var p = UTF8ToString(path >>> 0);
      if (dirfd === -100 || p[0] === '/') { var e = entry(p); if (e) { var fd = nextFd++; open[fd] = { e: e, pos: 0 }; served++; return fd; } }
    }
    return orig.openat.apply(this, arguments);
  };
  _fd_read = function (fd, iov, iovcnt, pnum) {
    var o = open[fd]; if (!o) return orig.read.apply(this, arguments);
    iov >>>= 0; pnum >>>= 0; H(); var total = 0;
    for (var i = 0; i < iovcnt; i++) {
      var ptr = HEAPU32[(iov + i * 8) >>> 2], len = HEAPU32[(iov + i * 8 + 4) >>> 2], n = Math.min(len, o.e.len - o.pos);
      if (n > 0) { HEAPU8.copyWithin(ptr, o.e.off + o.pos, o.e.off + o.pos + n); o.pos += n; total += n; }
      if (n < len) break;
    }
    HEAPU32[pnum >>> 2] = total; return 0;
  };
  _fd_seek = function (fd, offset, whence, newOffset) {
    var o = open[fd]; if (!o) return orig.seek.apply(this, arguments);
    var off = Number(offset), pos = whence === 0 ? off : whence === 1 ? o.pos + off : whence === 2 ? o.e.len + off : -1;
    if (!(pos >= 0)) return 28;   // EINVAL
    o.pos = pos; H(); HEAP64[(newOffset >>> 0) >>> 3] = BigInt(pos); return 0;
  };
  _fd_close = function (fd) {
    if (open[fd]) { delete open[fd]; return 0; }
    return orig.close.apply(this, arguments);
  };
  ___syscall_fstat64 = function (fd, buf) { var o = open[fd]; if (!o) return orig.fstat.apply(this, arguments); H(); return SYSCALLS.writeStat(buf >>> 0, statOf(o.e)); };
  var statPath = function (dirfd, path, buf, flags, fall, args) {
    if (pt() && !(flags & 4096)) {   // AT_EMPTY_PATH: about the fd, the page's job
      var p = UTF8ToString(path >>> 0);
      if (dirfd === -100 || p[0] === '/') { var e = entry(p); if (e) { H(); return SYSCALLS.writeStat(buf >>> 0, statOf(e)); } }
    }
    return fall.apply(this, args);
  };
  ___syscall_newfstatat = function (dirfd, path, buf, flags) { return statPath(dirfd, path, buf, flags, orig.newfstatat, arguments); };
  ___syscall_stat64 = function (path, buf) { return statPath(-100, path, buf, 0, orig.stat, arguments); };
  _fd_fdstat_get = function (fd, pbuf) {
    if (!open[fd]) return orig.fdstat.apply(this, arguments);
    pbuf >>>= 0; H(); HEAP8[pbuf] = 4; HEAP16[(pbuf + 2) >>> 1] = 0; HEAP64[(pbuf + 8) >>> 3] = 0n; HEAP64[(pbuf + 16) >>> 3] = 0n; return 0;
  };
  ___syscall_fcntl64 = function (fd, cmd, varargs) { if (!open[fd]) return orig.fcntl.apply(this, arguments); return (cmd >= 1 && cmd <= 7) ? 0 : -28; };
  ___syscall_ioctl = function (fd, op, varargs) { if (!open[fd]) return orig.ioctl.apply(this, arguments); return -59; };   // ENOTTY
  ___syscall_fadvise64 = function (fd, offset, len, advice) { if (!open[fd]) return orig.fadvise.apply(this, arguments); return 0; };
  // the working directory, asked for 10,000 times at Orca's start (boost::filesystem making relative paths absolute): one
  // round trip per thread, then from a copy, dropped when any thread changes directory (slot 60 counts the changes)
  var cwd = null, cwdGen = -1;
  var gen = function () { var sb = slots(); if (!sb) return -1; H(); return Atomics.load(HEAP32, (sb >>> 2) + 60); };
  ___syscall_getcwd = function (buf, size) {
    if (!pt()) return orig.getcwd.apply(this, arguments);
    var g = gen();
    if (cwd === null || g !== cwdGen) {
      var r = orig.getcwd.apply(this, arguments);
      if (r > 0 && g >= 0) { H(); cwd = HEAPU8.slice(buf >>> 0, (buf >>> 0) + r); cwdGen = g; }
      return r;
    }
    if (size < cwd.length) return -68;   // ERANGE
    H(); HEAPU8.set(cwd, buf >>> 0); return cwd.length;
  };
  ___syscall_chdir = function (path) { var r = orig.chdir.apply(this, arguments); var sb = slots(); if (sb) { H(); Atomics.add(HEAP32, (sb >>> 2) + 60, 1); } cwd = null; return r; };
  // only the syscalls this build has (Emscripten links the ones the program uses)
  if (orig.unlinkat) ___syscall_unlinkat = function (dirfd, path, flags) { if (underSys(path)) bump(); return orig.unlinkat.apply(this, arguments); };
  if (orig.renameat) ___syscall_renameat = function (olddirfd, oldpath, newdirfd, newpath) { if (underSys(oldpath) || underSys(newpath)) bump(); return orig.renameat.apply(this, arguments); };
  if (orig.mkdirat) ___syscall_mkdirat = function (dirfd, path, mode) { if (underSys(path)) bump(); return orig.mkdirat.apply(this, arguments); };
  if (orig.symlinkat) ___syscall_symlinkat = function (target, newdirfd, linkpath) { if (underSys(linkpath)) bump(); return orig.symlinkat.apply(this, arguments); };
  if (orig.rmdir) ___syscall_rmdir = function (path) { if (underSys(path)) bump(); return orig.rmdir.apply(this, arguments); };
  globalThis.wxfsBundleServed = function () { return served; };
})();
