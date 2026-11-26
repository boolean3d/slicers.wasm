// hand-over.js: one program tab per slicer, as the desktop keeps one window. A file opened while this tab runs is sent
// INTO it, as a second copy of the desktop program sends a double-clicked file to the running one, instead of starting
// the program again in a new tab.
// The tab is named b3d-slicer-<app>: Boolean3d's Open in slicer (js/share/slicerOpening.js) finds it with
// window.open('', name), which also brings it to the front, and posts {b3d: 'open', link} (the slicer address it would
// have opened: ?url=&name= or ?project=&open=). This tab opens that file through the door's open_files (the program's
// own EVT_LOAD_MODEL_OTHER_INSTANCE: one 3MF opens as the project, asking about the open one first; anything else is
// added to the plate) and answers {b3d: 'taking'} at once and {b3d: 'opened', ok} when done. ok false: the sender opens the address in this tab instead
// (a reload), as before. The finding only works where the page keeps its opener (Chromium's Document-Isolation-Policy;
// with COOP the browser cuts every link to the tab and Open in slicer starts a new one, as before).
// Any page may post here: the address is only ever one that page could have opened in a tab itself, of this program.
(function () {
  if (typeof Module === 'undefined') return;   // loaded by the tests, not by a program page
  var APP = (location.pathname.split('/')[1] || 'tool').replace(/[^\w-]/g, '');
  try { window.name = 'b3d-slicer-' + APP; } catch (e) { /* never */ }
  var DIR = '/home/web_user/Boolean3d';
  var wait = function (ms) { return new Promise(function (go) { setTimeout(go, ms); }); };

  // The program answering its door (still starting: asked again, for up to 90 s).
  function ready() {
    var t0 = Date.now();
    function once() {
      var running = !!(Module.wxRunning && Module.wxRunning());
      if (running && typeof B3DDoor === 'undefined') return Promise.resolve(false);   // a program with no door here
      var up = running && typeof B3DDoor !== 'undefined';
      return (up ? B3DDoor.act('status') : Promise.resolve({ ok: false })).then(function (a) {
        if (a && a.ok) return true;
        if (Date.now() - t0 > 90000) return false;
        return wait(500).then(once);
      });
    }
    return once();
  }

  // The file the address names, in this tab's file system: its path, or null when only a new start can open it.
  function place(q) {
    var url = q.get('url');
    if (url) {
      var name = (q.get('name') || 'part.3mf').replace(/[^\w .()-]+/g, '_');
      if (!/\.3mf$/i.test(name)) name += '.3mf';
      return fetch(url).then(function (r) { if (!r.ok) throw new Error('the part answered ' + r.status); return r.arrayBuffer(); })
        .then(function (b) {
          Module.FS.mkdirTree(DIR);
          Module.FS.writeFile(DIR + '/' + name, new Uint8Array(b));
          return DIR + '/' + name;
        });
    }
    var project = q.get('project'), open = q.get('open'), P = Module.b3dProjects;
    var linked = Module.b3dHome && Module.b3dHome.linked && Module.b3dHome.linked();
    if (project && open && P && linked) {
      return P.open(project).then(function (o) {
        var abs = o.dir + '/' + open.replace(/^\/+/, '');
        try { Module.FS.stat(abs); return abs; } catch (e) { return null; }
      });
    }
    return Promise.resolve(null);   // a part not made yet (&part=), a project link (&link=): a new start does those
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.b3d !== 'open' || typeof d.link !== 'string' || !e.source) return;
    var tell = function (m) { try { e.source.postMessage(Object.assign({ link: d.link }, m), e.origin); } catch (x) { /* gone */ } };
    var answer = function (ok, why) { tell({ b3d: 'opened', ok: ok, why: why || '' }); };
    var at;
    try { at = new URL(d.link); } catch (x) { return answer(false, 'not an address'); }
    if (at.origin !== location.origin || (at.pathname.split('/')[1] || '') !== APP) return answer(false, 'another program');
    var q = at.searchParams;
    // The program alone (the Slicers page's tile): it is here, brought to the front; nothing to open.
    if (!['url', 'project', 'open', 'part', 'link'].some(function (k) { return q.has(k); })) return answer(true);
    tell({ b3d: 'taking' });   // this tab is here and on it (a program still starting may take a while to answer)
    ready().then(function (up) {
      if (!up) throw new Error('the program is not running');
      return place(q);
    }).then(function (path) {
      if (!path) return answer(false, 'needs a new start');
      return B3DDoor.act('open_files', { paths: [path] }).then(function (a) {
        console.log('b3d hand-over: ' + path + (a.ok ? ' opened' : ' refused: ' + a.error));
        answer(!!a.ok, a.ok ? '' : a.error);
      });
    }).catch(function (x) { console.error('b3d hand-over: ' + x.message); answer(false, x.message); });
    try { window.focus(); } catch (x) { /* the browser decides */ }
  });
})();
