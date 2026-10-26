// project-folder.js: the person's Boolean3d projects as folders inside the program (Bambu Studio, OrcaSlicer, PrusaSlicer,
// KiCad in a tab). The package puts this script after home-folder-sync.js, which links the tab to the account (the key
// after the # from the Boolean3d Slicers page) and lends its door (Module.b3dHome.ask).
//
// A project holds every tool's files; each save of a file is a new version that never changes (the slicer-home door's
// project calls, supabase/functions/_shared/slicerhome/projects.mjs in the app). Here:
//   - an open project is the folder /home/web_user/Projects/<project name>/: every file at its path, its newest version;
//   - a file the program writes (closed after writing, or renamed onto) in that folder, or onto a file opened from a
//     project (boolean3d-folder.js hands those to the program through its Open box, which copies them into Uploads/),
//     goes up a moment later as a new version, its parent the version it was opened at;
//   - a file opened from a CAD part (its 3MF) is not in a project yet: its first save makes <part>.3mf in the part's
//     project, linked "made from" the part's version it was opened at;
//   - the bytes of every version seen here are kept in the browser's private storage (OPFS), by SHA-256: a version is
//     fetched once, and the working copies of the project folders are put back before the program starts on a reload
//     (home-folder-sync.js leaves Projects/ to this file). A save that could not go up (offline) goes up on the next start.
// Which file each path is (and the version it was last level at) is kept in localStorage (b3d-projects-<app>).
//
// The address /<app>/?project=<id>[&open=<path in it>] opens that project before the program starts, and with open=
// gives that file to the program as its argument (KiCad opens a board's whole folder through its .kicad_pro).
//
// Module.b3dProjects: list(), open(project) -> {dir, project, files}, file(project, file) -> {bytes, name, entry},
//   track(path, entry), untrack(path), part(path, {part, version, project, projectName}, bytes), save(path), entries(), idle().
(function () {
  if (typeof Module === 'undefined') return;   // loaded by the tests, not by a program page
  var HOME = '/home/web_user', ROOT = HOME + '/Projects', DOWNLOADS = HOME + '/Downloads';
  var APP = (location.pathname.split('/')[1] || 'tool').replace(/[^\w-]/g, '');
  var TOOL = { bambu: 'bambu', orca: 'orca', prusa: 'prusa', kicad: 'kicad' }[APP] || null;
  var REG = 'b3d-projects-' + APP;
  // Not versions: the programs' own lock, backup, autosave, cache and temporary files (KiCad: *.lck, *-backups/,
  // _autosave-*, fp-info-cache, ~ files, *.kicad_prl = this computer's window settings; the slicers: .tmp).
  var SKIP = /(^|\/)(~[^/]*|_autosave-[^/]*|fp-info-cache|[^/]*\.(lck|tmp|bak|kicad_prl))$|(^|\/)[^/]*-backups(\/|$)|(^|\/)\.b3d/i;
  var QUIET = 1000;

  function linked() { return !!(Module.b3dHome && Module.b3dHome.linked && Module.b3dHome.linked()); }
  function ask(op, body) {
    return Module.b3dHome.ask(op, body || {}).then(function (r) { return r.json(); }).then(function (a) {
      if (!a || a.ok === false) throw new Error((a && a.error) || 'The project could not be reached.');
      return a;
    });
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function sha256(data) { return crypto.subtle.digest('SHA-256', data).then(hex); }
  function through(data, stream) { return new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function gzip(data) { return through(data, new CompressionStream('gzip')); }
  function gunzip(data) { return through(data, new DecompressionStream('gzip')); }
  function folderName(s) { return String(s || 'Project').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 120) || 'Project'; }

  // ── Which file each path is ──────────────────────────────────────
  // path (absolute) -> {project, projectName, file, path (inside the project), version, sha (the account's bytes of
  //   that version), here (sha of the bytes on this disk), part, partVersion (a CAD part's 3MF: what it was opened at)}
  var reg = {};
  try { reg = JSON.parse(localStorage.getItem(REG) || '{}') || {}; } catch (e) { reg = {}; }
  function keep() { try { localStorage.setItem(REG, JSON.stringify(reg)); } catch (e) { /* no storage: this tab only */ } }

  // ── Bytes by SHA-256 in the browser's private storage ────────────
  var blobsDir = null;
  function blobs() {
    if (!blobsDir) blobsDir = navigator.storage && navigator.storage.getDirectory
      ? navigator.storage.getDirectory().then(function (d) { return d.getDirectoryHandle('b3d-project-blobs', { create: true }); })
      : Promise.reject(new Error('no private storage'));
    return blobsDir;
  }
  function cached(sha) {
    return blobs().then(function (d) { return d.getFileHandle(sha); }).then(function (h) { return h.getFile(); })
      .then(function (f) { return f.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); }, function () { return null; });
  }
  function cache(sha, data) {
    return blobs().then(function (d) { return d.getFileHandle(sha, { create: true }); }).then(function (h) { return h.createWritable(); })
      .then(function (w) { return w.write(data).then(function () { return w.close(); }); })
      .catch(function (e) { console.warn('b3d projects: could not keep ' + sha.slice(0, 12) + ' here: ' + e.message); });
  }

  /** The bytes of a version (its sha known): from this browser when kept, else from the account (checked, then kept). */
  function versionBytes(version, sha) {
    return cached(sha).then(function (here) {
      if (here) return here;
      return ask('fetch', { versions: [version] }).then(function (a) {
        var url = a.urls && a.urls[version];
        if (!url) throw new Error('That version could not be fetched.');
        return fetch(Module.b3dHome.beside(url), { cache: 'no-store' });
      }).then(function (r) {
        if (!r.ok) throw new Error('That version could not be fetched (' + r.status + ').');
        return r.arrayBuffer();
      }).then(function (b) { return gunzip(new Uint8Array(b)); }).then(function (data) {
        return sha256(data).then(function (s) {
          if (s !== sha) throw new Error('That version came back changed.');
          cache(sha, data);
          return data;
        });
      });
    });
  }

  // ── The disk ─────────────────────────────────────────────────────
  var writing = 0;   // our own writes are not saves
  function put(abs, data) {
    var FS = Module.FS;
    FS.mkdirTree(abs.slice(0, abs.lastIndexOf('/')));
    writing++;
    try { FS.writeFile(abs, data); } finally { writing--; }
  }
  function read(abs) { try { return Module.FS.readFile(abs); } catch (e) { return null; } }

  /** The person's projects (folders). */
  function list() { return ask('projects', {}).then(function (a) { return a.projects; }); }

  /** The project as a folder under Projects/: every tool file at its newest version (a file changed here and not yet up stays). */
  function open(projectId) {
    return ask('project', { project: projectId }).then(function (a) {
      var dir = ROOT + '/' + folderName(a.project.name);
      var files = a.files.filter(function (f) { return f.kind === 'file' && f.path && f.version && f.sha256; });
      return files.reduce(function (p, f) {
        return p.then(function () {
          var abs = dir + '/' + f.path, e = reg[abs];
          if (e && e.file === f.id && e.version === f.version && read(abs)) return;
          if (e && e.file === f.id && e.here && e.here !== e.sha) {
            console.log('b3d projects: ' + f.path + ' changed here and in the project; this browser\'s goes up as the newer version');
            return;
          }
          return versionBytes(f.version, f.sha256).then(function (data) {
            put(abs, data);
            reg[abs] = { project: a.project.id, projectName: a.project.name, file: f.id, path: f.path, version: f.version, sha: f.sha256, here: f.sha256 };
            console.log('b3d projects: ' + f.path + ' version ' + f.number + ', ' + data.length + ' bytes');
          });
        }).catch(function (err) { console.error('b3d projects: ' + f.path + ': ' + err.message); });
      }, Promise.resolve()).then(function () {
        keep();
        console.log('b3d projects: ' + a.project.name + ' at ' + dir + ', ' + files.length + ' files');
        return { dir: dir, project: a.project, files: a.files };
      });
    });
  }

  /** One file of a project at its newest version, for a program to open (the Open box). The caller tracks where it lands. */
  function file(projectId, fileId) {
    return ask('project', { project: projectId }).then(function (a) {
      var f = a.files.filter(function (x) { return x.id === fileId; })[0];
      if (!f || !f.version) throw new Error('That file has no saved version.');
      return versionBytes(f.version, f.sha256).then(function (data) {
        return { bytes: data, name: f.path.split('/').pop(),
          entry: { project: a.project.id, projectName: a.project.name, file: f.id, path: f.path, version: f.version, sha: f.sha256, here: f.sha256 } };
      });
    });
  }
  /** abs is that project file from now on: a write to it is a new version. */
  function track(abs, entry) { reg[abs] = entry; keep(); }
  /** abs holds a CAD part's 3MF (made from version `version` of part `part`, in project `project`): its first save makes the project file. */
  function part(abs, p, data) {
    var name = abs.split('/').pop();
    var e = { project: p.project || null, projectName: p.projectName || null, file: null, path: name, version: null, sha: null, here: null,
      part: p.part, partVersion: p.version || null };
    if (!data) { track(abs, e); return Promise.resolve(e); }
    return sha256(data).then(function (s) { e.sha = s; e.here = s; track(abs, e); return e; });
  }

  // ── Saves ────────────────────────────────────────────────────────
  // Which entry a write is: the path itself; a new file in an open project folder; or a Save As into the browser's
  // downloads under the name of a file opened from a project (the slicers' save box always writes there).
  function entryOf(abs) {
    if (reg[abs]) return abs;
    if (abs.indexOf(DOWNLOADS + '/') === 0) {
      var name = abs.slice(DOWNLOADS.length + 1), best = null;
      Object.keys(reg).forEach(function (k) { if (k.split('/').pop() === name && (!best || (reg[k].at || 0) > (reg[best].at || 0))) best = k; });
      if (best) return best;
      return null;
    }
    if (abs.indexOf(ROOT + '/') !== 0) return null;
    var rest = abs.slice(ROOT.length + 1), cut = rest.indexOf('/');
    if (cut < 0) return null;
    var folder = rest.slice(0, cut), inside = rest.slice(cut + 1);
    var owner = Object.keys(reg).filter(function (k) { return k.indexOf(ROOT + '/' + folder + '/') === 0 && reg[k].project; })[0];
    if (!owner && !opened[folder]) return null;
    var o = owner ? reg[owner] : opened[folder];
    reg[abs] = { project: o.project, projectName: o.projectName, file: null, path: inside, version: null, sha: null, here: null };
    return abs;
  }
  var opened = {};   // folder name -> {project, projectName}: folders opened this tab (a project with no files yet)

  var timers = {}, line = Promise.resolve();
  function soon(abs) {
    if (writing || typeof abs !== 'string' || SKIP.test(abs)) return;
    var at = entryOf(abs);
    if (!at) return;
    clearTimeout(timers[abs]);
    timers[abs] = setTimeout(function () { delete timers[abs]; line = line.then(function () { return save(abs, at); }); }, QUIET);
  }

  /** The bytes at abs go up as a new version of the file `at` names (abs itself unless a Save As copy). */
  function save(abs, at) {
    at = at || abs;
    var e = reg[at], data = read(abs);
    if (!e || !data) return Promise.resolve(null);
    var s, z;
    return sha256(data).then(function (h) {
      s = h; e.here = s; e.at = Date.now(); keep();
      if (s === e.sha) return 'same';
      // The working copy is kept here first: offline, or the account refusing, it goes up on the next start.
      return cache(s, data).then(function () {
        if (!linked()) throw new Error('the tab is not linked to an account');
        if (!e.project) throw new Error('this file is in no project');
        return gzip(data);
      }).then(function (g) {
        z = g;
        return ask('put', { project: e.project, sha256: s, stored: z.length });
      }).then(function (p) {
        if (!p.upload) return;
        return fetch(Module.b3dHome.beside(p.upload), { method: 'PUT', headers: { 'Content-Type': 'application/gzip' }, body: z }).then(function (r) {
          if (!r.ok) throw new Error('the file could not go up (' + r.status + ')');
        });
      }).then(function () {
        var body = { project: e.project, sha256: s, bytes: data.length, stored: z.length, parent: e.version, tool: TOOL };
        if (e.file) body.file = e.file; else body.path = e.path;
        return ask('save', body);
      }).then(function (v) {
        e.file = v.file; e.version = v.version; e.sha = s; e.number = v.number; keep();
        console.log('b3d projects: ' + e.path + ' version ' + v.number + (v.same ? ' (same bytes)' : '') + (v.behind ? ' (the project had a newer one: both kept)' : ''));
        if (!e.part || e.linked) return;
        return ask('link', e.partVersion ? { from: v.version, to: e.partVersion } : { from: v.version, part: e.part }).then(function (l) {
          e.linked = l.link; keep();
          console.log('b3d projects: ' + e.path + ' made from the part\'s version ' + l.pinned);
        });
      });
    }).catch(function (err) { console.error('b3d projects: ' + (e.path || abs) + ' did not go up: ' + err.message + ' (it goes up on the next start)'); });
  }

  function watch() {
    var FS = Module.FS;
    function wrap(name, which) {
      var f = FS[name];
      FS[name] = function () { var a = arguments, r = f.apply(this, a); soon(which(a)); return r; };
    }
    wrap('close', function (a) { return (a[0].flags & 3) !== 0 ? a[0].path : null; });
    wrap('rename', function (a) { return a[1]; });
  }

  // ── Start ────────────────────────────────────────────────────────
  // Before the program starts: the project folders' working copies back from this browser's storage, then the project
  // in the address opened (its file as the program's argument). Saves that did not go up, go up after.
  var q = new URLSearchParams(location.search), wantProject = q.get('project'), wantOpen = q.get('open');
  Module.preRun = Module.preRun || [];
  Module.preRun.push(function () {
    Module.addRunDependency('b3d-projects');
    // Files elsewhere (Uploads/) are home-folder-sync.js's to put back; any of them changed and not up yet goes up too.
    var pending = Object.keys(reg).filter(function (k) { return k.indexOf(ROOT + '/') !== 0 && reg[k].here && reg[k].here !== reg[k].sha; });
    Object.keys(reg).filter(function (k) { return k.indexOf(ROOT + '/') === 0 && reg[k].here; }).reduce(function (p, k) {
      return p.then(function () { return cached(reg[k].here); }).then(function (data) {
        if (!data) { delete reg[k]; return; }
        put(k, data);
        if (reg[k].here !== reg[k].sha) pending.push(k);
      });
    }, Promise.resolve()).then(function () {
      if (!wantProject || !linked()) return;
      return open(wantProject).then(function (o) {
        opened[o.dir.slice(ROOT.length + 1)] = { project: o.project.id, projectName: o.project.name };
        if (wantOpen) {
          var abs = o.dir + '/' + wantOpen.replace(/^\/+/, '');
          if (read(abs)) { Module.arguments = [abs]; console.log('b3d projects: opening ' + abs); }
        }
      });
    }).catch(function (e) { console.error('b3d projects: ' + e.message); }).then(function () {
      keep();
      watch();
      Module.removeRunDependency('b3d-projects');
      // Once every start step is done (home-folder-sync.js's files back too: the program runs only then).
      var go = setInterval(function () {
        if (!Module.calledRun) return;
        clearInterval(go);
        pending.forEach(function (k) { line = line.then(function () { return save(k); }); });
      }, 200);
    });
  });

  Module.b3dProjects = {
    list: list, open: function (id) {
      return open(id).then(function (o) { opened[o.dir.slice(ROOT.length + 1)] = { project: o.project.id, projectName: o.project.name }; return o; });
    },
    file: file, track: track, part: part, untrack: function (abs) { if (reg[abs]) { delete reg[abs]; keep(); } }, save: function (abs) { line = line.then(function () { return save(abs); }); return line; },
    entries: function () { return reg; }, idle: function () { return line; }, root: ROOT,
  };
})();
