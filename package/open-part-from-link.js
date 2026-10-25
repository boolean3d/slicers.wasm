// open-part-from-link.js: /<app>/?url=<address of a .3mf>&name=<file name> opens that file at start, as if given on the
// command line: it is fetched while the slicer downloads, written into its file system and passed as the argument.
// The package puts this script before the program's script. (Used by the Boolean3d Print panel's "Open in Bambu Studio".)
(function () {
  var q = new URLSearchParams(location.search), url = q.get('url');
  if (!url) return;
  var name = (q.get('name') || 'part.3mf').replace(/[^\w .()-]+/g, '_');
  if (!/\.3mf$/i.test(name)) name += '.3mf';
  // Into the home folder (Boolean3d/), not /tmp: the recent projects list points at it and home-folder-sync.js keeps it.
  var dir = '/home/web_user/Boolean3d', dest = dir + '/' + name;
  Module.arguments = [dest];
  var got = fetch(url).then(function (r) { if (!r.ok) throw new Error('the part answered ' + r.status); return r.arrayBuffer(); });
  // The signed address lasts ten minutes: a reload must not ask for it again.
  q.delete('url'); q.delete('name');
  history.replaceState(null, '', location.pathname + (String(q) ? '?' + q : ''));
  Module.preRun.push(function () {
    Module.addRunDependency('b3d-part');
    got.then(function (b) {
      Module.FS.mkdirTree(dir);
      Module.FS.writeFile(dest, new Uint8Array(b));
      console.log('b3d part: ' + dest + ' ' + b.byteLength + ' bytes');
    }, function (e) {
      console.error('b3d part: could not fetch the part: ' + e.message);
      Module.arguments.length = 0;
    }).then(function () { Module.removeRunDependency('b3d-part'); });
  });
})();
