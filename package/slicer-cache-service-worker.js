
// Appended by package.mjs to the web view's service worker (SLICER_VERSION_DIR = the version folder, relative to this
// worker's folder, the app folder). The program is installed in the browser (install-and-lazy-load.js puts every file of the version
// into the origin's private file system, b3d-slicer/<app>/); this worker answers every request of the app folder from
// that copy first, so a visit after the install reads nothing from the network, offline included:
//   - the pages (the app address and the version's index.html): the network first, the last copy when it fails
//     (kept beside the install, b3d-slicer/<app>/pages/, and in Cache Storage 'b3d-slicer-pages-<app>');
//   - every other file of the app folder: the installed copy first, else the network.
// The web view's own handler (above) fetches the slicer's web pages itself: the worker's fetch is wrapped, so those
// come from the copy too. Earlier versions are left to install-and-lazy-load.js (an update downloads only what changed).
(function () {
  var scope = new URL(self.SLICER_VERSION_DIR || './', self.location.href);
  var app = new URL('./', self.location.href);
  var parts = scope.pathname.split('/').filter(Boolean);   // [<app>, <version>]
  var NAME = 'b3d-slicer-files-' + parts.join('-');
  var PAGES = 'b3d-slicer-pages-' + parts[0];
  var PAGE = /\/(index\.html)?$/, NEVER = /\/wxwebview-sw\.js$|\/(relay|fetch)$/;
  var net = self.fetch.bind(self);
  function mine(r) {
    if (r.method !== 'GET' || r.headers.has('range')) return null;
    var url = new URL(r.url);
    if (url.origin !== app.origin || url.pathname.indexOf(app.pathname) !== 0 || NEVER.test(url.pathname)) return null;
    url.search = ''; url.hash = '';
    return url;
  }
  // The install (install-and-lazy-load.js): b3d-slicer/<app>/objects/<object> in the origin's private file system, and the version's
  // record <NAME>.json { complete, files: { address: object }, types: { object: content type }, headers: the host's
  // cross-origin-* headers }.
  var record = null;
  function dir(names) {
    return names.reduce(function (p, n) { return p.then(function (d) { return d.getDirectoryHandle(n); }); }, navigator.storage.getDirectory());
  }
  function installed() {
    if (record) return Promise.resolve(record);
    if (!navigator.storage || !navigator.storage.getDirectory) return Promise.resolve(null);
    return dir(['b3d-slicer', parts[0]]).then(function (d) { return d.getFileHandle(NAME + '.json'); })
      .then(function (h) { return h.getFile(); }).then(function (f) { return f.text(); }).then(function (t) {
        var j = JSON.parse(t);
        if (j && j.complete) record = j;   // until then asked again: the install is still running
        return j;
      }).catch(function () { return null; });
  }
  var TYPE = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', html: 'text/html', css: 'text/css',
    json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain' };
  function fromInstall(url) {
    return installed().then(function (j) {
      var n = j && j.files && j.files[url.href];
      if (!n) return null;
      return dir(['b3d-slicer', parts[0], 'objects']).then(function (d) { return d.getFileHandle(n); })
        .then(function (h) { return h.getFile(); }).then(function (file) {
          var ext = (/\.([a-z0-9]+)$/i.exec(url.pathname) || [])[1];
          var type = (j.types && j.types[n]) || TYPE[(ext || '').toLowerCase()] || 'application/octet-stream';
          var h = { 'content-type': type, 'content-length': String(file.size) };
          Object.keys(j.headers || {}).forEach(function (k) { h[k] = j.headers[k]; });   // isolation headers, as the host sends
          return new Response(file, { headers: h });
        }, function () { return null; });   // not there (an install from before): from the network
    });
  }
  // The pages: the last copy, in the same folder (pages/<name> + pages/<name>.json = status and headers: the page's
  // isolation headers must come back with it), and in Cache Storage as before.
  function djb(s) { var a = 5381, b = 52711; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a = (a * 33) ^ c; b = (b * 31) ^ c; } return (a >>> 0).toString(16) + (b >>> 0).toString(16); }
  function keepPage(href, res) {
    var n = 'p' + djb(href), head = { status: res.status, headers: [] };
    res.headers.forEach(function (v, k) { head.headers.push([k, v]); });
    return res.arrayBuffer().then(function (body) {
      return navigator.storage.getDirectory().then(function (root) { return root.getDirectoryHandle('b3d-slicer', { create: true }); })
        .then(function (d) { return d.getDirectoryHandle(parts[0], { create: true }); })
        .then(function (d) { return d.getDirectoryHandle('pages', { create: true }); })
        .then(function (d) {
          function put(name, data) {
            return d.getFileHandle(name, { create: true }).then(function (h) { return h.createWritable(); })
              .then(function (w) { return w.write(data).then(function () { return w.close(); }); });
          }
          return put(n, body).then(function () { return put(n + '.json', JSON.stringify(head)); });
        });
    });
  }
  function lastPage(href) {
    var n = 'p' + djb(href), d;
    return dir(['b3d-slicer', parts[0], 'pages']).then(function (pd) { d = pd; return d.getFileHandle(n + '.json'); })
      .then(function (h) { return h.getFile(); }).then(function (f) { return f.text(); }).then(function (t) {
        var head = JSON.parse(t);
        return d.getFileHandle(n).then(function (h) { return h.getFile(); })
          .then(function (file) { return new Response(file, { status: head.status, headers: head.headers }); });
      }).catch(function () {
        return caches.open(PAGES).then(function (c) { return c.match(href); });
      });
  }
  function answer(r, url) {
    if (PAGE.test(url.pathname)) {
      return net(r).then(function (res) {
        if (res.status === 200) {
          var copy = res.clone(), copy2 = res.clone();
          keepPage(url.href, copy).catch(function () {});
          caches.open(PAGES).then(function (c) { return c.put(url.href, copy2); }).catch(function () {});
        }
        return res;
      }, function (e) {
        return lastPage(url.href).then(function (hit) { if (hit) return hit; throw e; });
      });
    }
    return fromInstall(url).then(function (hit) { return hit || net(r); });
  }
  self.fetch = function (input, init) {
    var r = input instanceof Request && !init ? input : new Request(input, init);
    var url = mine(r);
    return url ? answer(r, url) : net(input, init);
  };
  self.addEventListener('fetch', function (e) {
    var r = e.request;
    if (r.destination === 'iframe') return;   // the web view's handler (above) answers those, through self.fetch
    var url = mine(r);
    if (url) e.respondWith(answer(r, url));
  });
})();
