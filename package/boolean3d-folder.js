// boolean3d-folder.js: the person's Boolean3d parts as a folder in the slicer's Open box. The package puts this script after
// home-folder-sync.js, which links the tab to the account (the key after the # from the Boolean3d Slicers page).
//
// The browser build's Open box is the browser's own file picker (wxFileDialog, wxwidgets-web/src/wasm/filedlg.cpp: a hidden
// <input type=file>, clicked; the picked files are copied into /home/web_user/Uploads and handed to the program). The
// browser's picker can only show the computer's disk, so when the tab is linked, the click on that input opens this
// box first: "Boolean3d" lists the person's folders and parts (read only), "This computer" opens the browser's picker
// as before. A part picked here is fetched from the account as a 3MF (the slicer-home door's "part": the 3MF the
// part's last save stored, with its picture, as Open in slicer makes it) and given to the input as the picked file,
// so the program opens it exactly as a file from the disk: on the plate, in Recent, kept with the home folder.
// Nothing is uploaded or downloaded by the person, and nothing in the account changes.
//
// A folder is also a project (project-folder.js): opened here, it lists the project's own 3MF files (each at its newest
// version) beside the parts. Either one picked is handed to project-folder.js with the path it lands at (Uploads/<name>),
// so the program's next save of it goes up as a new version (a part's 3MF: as a new project file made from that part).
(function () {
  if (typeof Module === 'undefined' || typeof HTMLInputElement === 'undefined') return;
  var APP = (location.pathname.split('/')[1] || 'slicer').replace(/[^\w-]/g, '');
  var ACCENT = { bambu: '#00ae42', orca: '#009688' }[APP] || '#2f6fde';
  var click = HTMLInputElement.prototype.click;
  var bypass = false;

  function linked() { return !!(Module.b3dHome && Module.b3dHome.linked && Module.b3dHome.linked()); }
  // The box is only for a picker that takes a 3MF (open project, import): any other (a G-code, a picture) goes straight on.
  function takes3mf(input) {
    var a = (input.accept || '').toLowerCase();
    return !a || a.split(',').some(function (x) { return x.trim() === '.3mf' || x.trim() === '*' || x.trim() === '*.*'; });
  }

  HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file' || bypass || !linked() || !takes3mf(this)) return click.apply(this, arguments);
    choose(this);
  };

  function ask(op, body) { return Module.b3dHome.ask(op, body); }
  var UPLOADS = '/home/web_user/Uploads';   // wxWASM_UPLOAD_DIR: where the program's picker puts what was picked
  function projects() { return Module.b3dProjects || null; }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'style') e.style.cssText = attrs[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var CSS = '.b3dd{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;'
    + 'font:13px/1.35 "Segoe UI",system-ui,-apple-system,sans-serif;color:#262e30}'
    + '.b3dd-box{width:min(900px,92vw);height:min(600px,86vh);background:#fff;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden}'
    + '.b3dd-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e3e5e6;font-size:14px;font-weight:600}'
    + '.b3dd-head span{flex:1}.b3dd-x{border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:#6b7375;padding:2px 6px}'
    + '.b3dd-body{flex:1;display:flex;min-height:0}'
    + '.b3dd-side{width:190px;border-right:1px solid #e3e5e6;padding:8px 0;overflow:auto;background:#f7f8f8}'
    + '.b3dd-place{display:flex;align-items:center;gap:8px;padding:7px 14px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.b3dd-place:hover{background:#eceeee}.b3dd-place.on{background:#e3f4e9;font-weight:600}'
    + '.b3dd-place.sub{padding-left:30px}.b3dd-sep{height:1px;background:#e3e5e6;margin:8px 0}'
    + '.b3dd-main{flex:1;display:flex;flex-direction:column;min-width:0}'
    + '.b3dd-path{padding:8px 14px;color:#6b7375;border-bottom:1px solid #f0f1f1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.b3dd-path a{color:inherit;cursor:pointer;text-decoration:none}.b3dd-path a:hover{text-decoration:underline}'
    + '.b3dd-grid{flex:1;overflow:auto;padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;align-content:start}'
    + '.b3dd-item{border:1px solid #e3e5e6;border-radius:5px;cursor:pointer;overflow:hidden;background:#fff;user-select:none}'
    + '.b3dd-item:hover{border-color:#b9c0c2}.b3dd-item.on{outline:2px solid var(--b3dd-accent);border-color:transparent}'
    + '.b3dd-pic{height:112px;background:#eef0f0;display:flex;align-items:center;justify-content:center}'
    + '.b3dd-pic img{max-width:100%;max-height:100%;object-fit:contain}'
    + '.b3dd-name{padding:6px 8px 0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.b3dd-when{padding:0 8px 7px;color:#8a9294;font-size:11px}'
    + '.b3dd-note{grid-column:1/-1;color:#6b7375;padding:30px 4px;text-align:center}'
    + '.b3dd-foot{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid #e3e5e6}'
    + '.b3dd-foot span{flex:1;color:#6b7375;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.b3dd-btn{border:1px solid #c9cfd1;background:#fff;border-radius:4px;padding:6px 16px;cursor:pointer;font:inherit}'
    + '.b3dd-btn.go{background:var(--b3dd-accent);border-color:var(--b3dd-accent);color:#fff}.b3dd-btn:disabled{opacity:.5;cursor:default}';
  var FOLDER = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" fill="#e8b84a" stroke="#c49a35"/></svg>';
  var DISK = '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="#dfe3e4" stroke="#8a9294"/><circle cx="12" cy="10" r="1" fill="#3a4244"/></svg>';
  function icon(svg) { var s = el('span', { style: 'display:inline-flex' }); s.innerHTML = svg; return s; }

  function choose(input) {
    if (!document.getElementById('b3dd-css')) document.head.appendChild(el('style', { id: 'b3dd-css' }, [CSS]));
    var folders = {}, parts = [], at = null, picked = null, busy = false, done = false;
    var projectFiles = {};   // folder id -> its project's 3MF files ([] while asked), from project-folder.js
    var root = el('div', { class: 'b3dd', style: '--b3dd-accent:' + ACCENT, role: 'dialog', 'aria-label': 'Open' });
    var side = el('div', { class: 'b3dd-side' }), path = el('div', { class: 'b3dd-path' }), grid = el('div', { class: 'b3dd-grid' });
    var say = el('span', {}, ['']);
    var open = el('button', { class: 'b3dd-btn go', disabled: '', onclick: function () { if (picked) take(picked); } }, ['Open']);
    root.appendChild(el('div', { class: 'b3dd-box' }, [
      el('div', { class: 'b3dd-head' }, [el('span', {}, ['Open']), el('button', { class: 'b3dd-x', title: 'Close', onclick: function () { finish(null); } }, ['×'])]),
      el('div', { class: 'b3dd-body' }, [side, el('div', { class: 'b3dd-main' }, [path, grid])]),
      el('div', { class: 'b3dd-foot' }, [say, el('button', { class: 'b3dd-btn', onclick: function () { finish(null); } }, ['Cancel']), open]),
    ]));
    // The program under the box must not see the keys or the mouse meant for it.
    ['keydown', 'keyup', 'keypress', 'wheel', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu'].forEach(function (t) {
      root.addEventListener(t, function (e) {
        e.stopPropagation();
        if (t === 'keydown' && e.key === 'Escape') finish(null);
        if (t === 'keydown' && e.key === 'Enter' && picked) take(picked);
      });
    });
    root.addEventListener('mousedown', function (e) { if (e.target === root) finish(null); });
    document.body.appendChild(root);
    root.tabIndex = -1; root.focus();

    function finish(file) {
      if (done) return; done = true;
      root.remove();
      if (file) {
        var dt = new DataTransfer(); dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
      } else input.dispatchEvent(new Event('cancel'));
    }
    function computer() {
      if (done) return; done = true;
      root.remove();
      bypass = true;
      // A file from the computer is no project file, even under the name of one opened before.
      if (projects()) input.addEventListener('change', function () {
        Array.prototype.forEach.call(input.files || [], function (f) { projects().untrack(UPLOADS + '/' + f.name); });
      }, { once: true });
      try { click.call(input); } finally { bypass = false; }
    }
    function fileName(p) { return (p.name || 'Part').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 120) + '.3mf'; }
    function take(p) {
      if (busy) return; busy = true; open.disabled = true;
      say.textContent = 'Opening ' + p.name + '…';
      var made = null;   // the part's version this 3MF is of (the door's x-b3d-version)
      (p.projectFile ? projects().file(p.folder, p.id).then(function (got) {
        projects().track(UPLOADS + '/' + got.name, got.entry);
        console.log('b3d disk: ' + got.entry.path + ' version ' + p.number + ' ' + got.bytes.length + ' bytes');
        return new File([got.bytes], got.name, { type: 'model/3mf', lastModified: Date.parse(p.updated) || Date.now() });
      }) : ask('part', { id: p.id }).then(function (r) {
        if ((r.headers.get('content-type') || '').indexOf('json') >= 0) return r.json().then(function (a) { throw new Error(a.error || 'The part could not be opened.'); });
        if (!r.ok) throw new Error('The part could not be opened.');
        made = r.headers.get('x-b3d-version');
        return r.arrayBuffer();
      }).then(function (b) {
        console.log('b3d disk: ' + p.name + ' ' + b.byteLength + ' bytes');
        var f = new File([b], fileName(p), { type: 'model/3mf', lastModified: Date.parse(p.updated) || Date.now() });
        if (!projects()) return f;
        return projects().part(UPLOADS + '/' + f.name, { part: p.id, version: made, project: p.folder,
          projectName: (folders[p.folder] || {}).name }, new Uint8Array(b)).then(function () { return f; });
      })).then(finish, function (e) {
        busy = false; open.disabled = !picked;
        say.textContent = e.message || 'The part could not be opened.';
      });
    }

    function kidsOf(id) { return Object.keys(folders).map(function (k) { return folders[k]; }).filter(function (f) { return f.parent === id; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); }); }
    function trail(id) { var out = []; for (var f = folders[id]; f; f = folders[f.parent]) { out.unshift(f); if (out.length > 20) break; } return out; }
    function drawSide() {
      side.textContent = '';
      var top = el('div', { class: 'b3dd-place' + (at === null ? ' on' : ''), onclick: function () { go(null); } }, [icon(DISK), 'Boolean3d']);
      side.appendChild(top);
      kidsOf(null).forEach(function (f) {
        side.appendChild(el('div', { class: 'b3dd-place sub' + (at === f.id || trail(at).some(function (t) { return t.id === f.id; }) ? ' on' : ''), title: f.name,
          onclick: function () { go(f.id); } }, [icon(FOLDER), f.name]));
      });
      side.appendChild(el('div', { class: 'b3dd-sep' }));
      side.appendChild(el('div', { class: 'b3dd-place', onclick: computer }, [icon(DISK), 'This computer…']));
    }
    function go(id) {
      at = id; picked = null; open.disabled = true; say.textContent = '';
      drawSide();
      path.textContent = '';
      path.appendChild(el('a', { onclick: function () { go(null); } }, ['Boolean3d']));
      trail(id).forEach(function (f) { path.appendChild(document.createTextNode(' › ')); path.appendChild(el('a', { onclick: function () { go(f.id); } }, [f.name])); });
      grid.textContent = '';
      var subs = kidsOf(id), here = parts.filter(function (p) { return (p.folder || null) === id; });
      if (id && projects() && !projectFiles[id]) {
        projectFiles[id] = [];
        Module.b3dHome.ask('project', { project: id }).then(function (r) { return r.json(); }).then(function (a) {
          if (!a || !a.ok) return;
          projectFiles[id] = a.files.filter(function (f) { return f.kind === 'file' && f.version && /\.3mf$/i.test(f.path || ''); })
            .map(function (f) { return { id: f.id, name: f.path, folder: id, updated: f.at, number: f.number, projectFile: true }; });
          if (at === id && !done && projectFiles[id].length) go(id);
        }).catch(function (e) { console.warn('b3d disk: project files: ' + e.message); });
      }
      here = (projectFiles[id] || []).concat(here);
      subs.forEach(function (f) {
        grid.appendChild(el('div', { class: 'b3dd-item', title: f.name, ondblclick: function () { go(f.id); }, onclick: function () { go(f.id); } }, [
          el('div', { class: 'b3dd-pic' }, [(function () { var s = icon(FOLDER.replace(/16/g, '56')); return s; })()]),
          el('div', { class: 'b3dd-name' }, [f.name]), el('div', { class: 'b3dd-when' }, ['Folder'])]));
      });
      here.forEach(function (p) {
        var card = el('div', { class: 'b3dd-item', title: p.name, onclick: function () {
          Array.prototype.forEach.call(grid.querySelectorAll('.b3dd-item.on'), function (c) { c.classList.remove('on'); });
          card.classList.add('on'); picked = p; open.disabled = busy; say.textContent = p.projectFile ? p.name : fileName(p);
        }, ondblclick: function () { take(p); } }, [
          el('div', { class: 'b3dd-pic' }, [p.picture ? el('img', { crossorigin: 'anonymous', alt: '', loading: 'lazy', src: Module.b3dHome.beside(p.picture) }) : null]),
          el('div', { class: 'b3dd-name' }, [p.name]),
          el('div', { class: 'b3dd-when' }, [(p.projectFile ? 'Version ' + p.number + ' · ' : '')
            + (p.updated ? new Date(p.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')])]);
        grid.appendChild(card);
      });
      if (!subs.length && !here.length) grid.appendChild(el('div', { class: 'b3dd-note' }, ['Nothing to open in this folder.']));
    }

    drawSide();
    grid.appendChild(el('div', { class: 'b3dd-note' }, ['Loading your Boolean3d parts…']));
    ask('disk', {}).then(function (r) { return r.json(); }).then(function (a) {
      if (done) return;
      if (!a || !a.ok) throw new Error((a && a.error) || 'Your Boolean3d parts could not be listed.');
      a.folders.forEach(function (f) { folders[f.id] = f; });
      // A folder whose parent is not listed (deleted) is shown at the top.
      Object.keys(folders).forEach(function (k) { if (folders[k].parent && !folders[folders[k].parent]) folders[k].parent = null; });
      parts = a.parts;
      // One folder at the top (My files): open in it.
      var tops = kidsOf(null);
      go(tops.length === 1 && !parts.some(function (p) { return !p.folder; }) ? tops[0].id : null);
    }).catch(function (e) {
      if (done) return;
      grid.textContent = '';
      grid.appendChild(el('div', { class: 'b3dd-note' }, [e.message || 'Your Boolean3d parts could not be listed.']));
    });
  }
})();
