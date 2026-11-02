// workspace-bar.js: the thin bar over every program in a tab (Bambu Studio, OrcaSlicer, PrusaSlicer, KiCad), the same
// bar Boolean3d's editor wears (js/ui/WorkspaceBar.js in the app): where you are (Boolean3d > the project) and the
// three workspaces of a project, Design (Boolean3d's CAD), Electronics (KiCad) and Make (a slicer). The program inside
// is untouched: the bar sits above the page's #main-window, and the browser port already gives the program the
// window's height less that offset (page-bridge.js wxpage_screen_height) and moves its windows down by it.
//
// The bar's colours are the loading screen's (credit.js / kicad-credit.js): the same dark grey, plain text.
// A workspace opens in its own tab, named per project, so going back to one finds the tab already there when the
// browser allows it (a program page is cross-origin isolated, so a tab it opens is often a new one).
//
// The address may carry ?hub=<Boolean3d's address> (the app adds it to every link it makes); it is kept, so a program
// opened later from a bookmark still knows where the project page is. ?project=<id> names the project.
//
// In a slicer, when the open file is made from a CAD part saved since (project-folder.js, its 'b3d-part-update'
// event), the bar says so: "<part> has a newer version (vN) · Update"; after Update, how to take it in (the program's
// own Reload from disk, which keeps the plate and every setting).
(function () {
  if (typeof document === 'undefined' || window.B3D_BAR) return;
  window.B3D_BAR = true;
  var HUB_KEY = 'b3d-hub', MAKE_KEY = 'b3d-make-slicer', HEIGHT = 32;
  var q = new URLSearchParams(location.search);
  var APP = (location.pathname.split('/')[1] || '').replace(/[^\w-]/g, '');
  var SLICERS = { bambu: 'Bambu Studio', orca: 'OrcaSlicer', prusa: 'PrusaSlicer', snapmaker: 'Snapmaker Orca', elegoo: 'ElegooSlicer' };
  var HERE = SLICERS[APP] ? 'make' : APP === 'kicad' ? 'electronics' : null;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* this tab only */ } }

  var hubParam = q.get('hub');
  if (hubParam && /^https?:\/\/[^/]+\/?$/.test(hubParam)) set(HUB_KEY, hubParam.replace(/\/*$/, '/'));
  var HUB = get(HUB_KEY) || 'https://boolean3d.com/';
  if (SLICERS[APP]) set(MAKE_KEY, APP);
  // ?desktop=1: opened from Boolean3d's desktop (its switch desktopHome): the bar shows a Home button back to it (Home's address is still #/desktop).
  var DESKTOP_KEY = 'b3d-desktop';
  if (q.get('desktop') === '1') set(DESKTOP_KEY, '1');
  var project = q.get('project') || null;
  var projectName = null, files = null;

  var css = '#b3d-bar{position:relative;z-index:2147483646;height:' + HEIGHT + 'px;box-sizing:border-box;display:flex;align-items:center;'
    + 'gap:16px;padding:0 12px;background:#26282b;color:#c4c4c4;border-bottom:1px solid #3a3d41;'
    + 'font:13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;user-select:none;white-space:nowrap;overflow:hidden}'
    + '#b3d-bar a{color:inherit;text-decoration:none}'
    + '#b3d-bar .where{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 0;overflow:hidden}'
    + '#b3d-bar .home{color:#e8e8e8;font-weight:600}'
    + '#b3d-bar .sep{color:#6f757c}'
    + '#b3d-bar .project{overflow:hidden;text-overflow:ellipsis}'
    + '#b3d-bar .project:hover,#b3d-bar .home:hover{text-decoration:underline}'
    + '#b3d-bar nav{display:flex;height:100%;flex:0 0 auto}'
    + '#b3d-bar nav a{display:flex;align-items:center;padding:0 14px;height:100%;box-sizing:border-box;border-bottom:2px solid transparent}'
    + '#b3d-bar nav a:hover{color:#e8e8e8;background:#2f3236}'
    + '#b3d-bar nav a[aria-current]{color:#e8e8e8;border-bottom-color:#9aa0a6}'
    + '#b3d-bar .end{flex:1 1 0}'
    + '#b3d-bar a:focus-visible,#b3d-bar button:focus-visible{outline:2px solid #9aa0a6;outline-offset:-2px}'
    + '#b3d-bar .update{display:none;align-items:center;gap:8px;color:#e8e8e8;overflow:hidden;text-overflow:ellipsis}'
    + '#b3d-bar .update button{font:inherit;color:#26282b;background:#e8e8e8;border:0;border-radius:3px;padding:3px 10px;cursor:pointer}'
    + '#b3d-bar .update button:hover{background:#ffffff}'
    + '#b3d-bar .update button[disabled]{display:none}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.id = 'b3d-bar';
  bar.setAttribute('role', 'banner');
  var where = document.createElement('div'); where.className = 'where';
  var home = document.createElement('a'); home.className = 'home'; home.textContent = 'Boolean3d'; home.target = '_blank'; home.rel = 'opener';
  var sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '›'; sep.setAttribute('aria-hidden', 'true');
  var name = document.createElement('a'); name.className = 'project'; name.target = '_blank'; name.rel = 'opener';
  where.appendChild(home);
  var nav = document.createElement('nav'); nav.setAttribute('aria-label', 'Workspaces');
  var TABS = [['design', 'Design'], ['electronics', 'Electronics'], ['make', 'Make']];
  var links = {};
  TABS.forEach(function (t) {
    var a = document.createElement('a'); a.textContent = t[1]; a.dataset.workspace = t[0];
    if (t[0] === HERE) a.setAttribute('aria-current', 'page');
    a.addEventListener('click', function (e) { e.preventDefault(); if (t[0] !== HERE) go(t[0]); });
    links[t[0]] = a; nav.appendChild(a);
  });
  var end = document.createElement('div'); end.className = 'end';
  end.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:16px;min-width:0';
  // The open file's part saved since (project-folder.js): what it is, and the Update button.
  var upd = document.createElement('div'); upd.className = 'update'; upd.setAttribute('data-testid', 'b3d-bar-update'); upd.setAttribute('role', 'status');
  var updWords = document.createElement('span'); updWords.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
  var updGo = document.createElement('button'); updGo.type = 'button'; updGo.textContent = 'Update';
  upd.appendChild(updWords); upd.appendChild(updGo); end.appendChild(upd);
  var offer = null;
  updGo.addEventListener('click', function () { if (offer && offer.update) offer.update(); });
  function showUpdate(o) {
    offer = o;
    if (!o) { upd.style.display = 'none'; return; }
    updWords.textContent = o.step === 'making' ? o.name + ' v' + o.number + ' is being made…'
      : o.step === 'not_made' ? o.name + ' v' + o.number + ' could not be made: open it in Boolean3d and save it again'
      : o.step === 'fetching' ? 'Fetching ' + o.name + ' version ' + o.number + '…'
      : o.step === 'reload' ? o.name + ' version ' + o.number + ' is ready: right-click the part, Reload from disk'
      : o.name + ' has a newer version (v' + o.number + ')';
    updGo.disabled = o.step !== 'offer';
    updGo.style.display = o.step === 'making' || o.step === 'not_made' ? 'none' : '';
    upd.title = o.step === 'offer' ? 'Puts version ' + o.number + ' of ' + o.name + ' on the plate, keeping your settings' : '';
    upd.style.display = 'flex';
  }
  window.addEventListener('b3d-part-update', function (e) { showUpdate(e.detail); });
  if (window.Module && Module.b3dProjects && Module.b3dProjects.offer) showUpdate(Module.b3dProjects.offer());
  if (get(DESKTOP_KEY) === '1') {
    var desk = document.createElement('a'); desk.className = 'desktop'; desk.textContent = 'Home';
    desk.setAttribute('data-testid', 'b3d-bar-desktop'); desk.target = 'b3d-desktop'; desk.rel = 'opener';
    desk.href = HUB + '#/desktop';
    end.appendChild(desk);
  }
  bar.appendChild(where); bar.appendChild(nav); bar.appendChild(end);

  function hubPage() { return HUB + (project ? '#/files/' + encodeURIComponent(project) : '#/files'); }
  function newest(test) {
    var hit = null;
    (files || []).forEach(function (f) { if (f.path && test(f.path) && (!hit || String(f.at) > String(hit.at))) hit = f; });
    return hit;
  }
  /** Where a workspace opens for this project. */
  function address(ws) {
    if (ws === 'design') return hubPage();
    var p = new URLSearchParams();
    if (project) p.set('project', project);
    p.set('hub', HUB);
    if (ws === 'electronics') {
      // The host's /kicad/ opens the program a file belongs to (?open= a .kicad_pro: the project manager).
      var pro = newest(function (x) { return /\.kicad_pro$/i.test(x); }) || newest(function (x) { return /\.kicad_(pcb|sch)$/i.test(x); });
      if (pro) p.set('open', pro.path);
      return location.origin + '/kicad/?' + p;
    }
    var mf = newest(function (x) { return /\.3mf$/i.test(x); });
    if (mf) p.set('open', mf.path);
    return location.origin + '/' + (get(MAKE_KEY) || 'bambu') + '/?' + p;
  }
  function go(ws) {
    var to = address(ws), tab = 'b3d-' + ws + '-' + (project || 'none');
    // An open tab of that workspace is brought forward, not started again; else a new one.
    var w = null;
    try { w = window.open('', tab); } catch (e) { w = null; }
    var fresh = true;
    try { fresh = !w || w.location.href === 'about:blank'; } catch (e) { fresh = false; }
    if (w && !fresh) { w.focus(); return; }
    if (w) w.location.href = to; else window.open(to, '_blank');
  }
  function draw() {
    home.href = HUB + '#/files';
    if (project) {
      name.href = hubPage();
      name.textContent = projectName || 'Project';
      name.title = projectName ? 'Open ' + projectName + ' on Boolean3d' : '';
      if (!name.parentNode) { where.appendChild(sep); where.appendChild(name); }
    }
    TABS.forEach(function (t) { links[t[0]].href = address(t[0]); });
  }

  // The project's name and files, through the account door once the tab is linked (home-folder-sync.js).
  function learn(tries) {
    var h = window.Module && Module.b3dHome;
    if (!project) return;
    if (!h || !h.linked || !h.linked()) { if (tries < 60) setTimeout(function () { learn(tries + 1); }, 1000); return; }
    h.ask('project', { project: project }).then(function (r) { return r.json(); }).then(function (a) {
      if (!a || a.ok === false) return;
      projectName = a.project && a.project.name;
      files = a.files || [];
      draw();
    }).catch(function () { /* the bar keeps "Project" */ });
  }

  function mount() {
    var mw = document.getElementById('main-window');
    if (mw && mw.parentNode) mw.parentNode.insertBefore(bar, mw); else document.body.insertBefore(bar, document.body.firstChild);
    // The page's full-height parts start under the bar: the loading screen's layer, and the program's window layer.
    var lift = document.createElement('style');
    lift.textContent = '#credit,#kicad-credit{top:' + HEIGHT + 'px!important}';
    document.head.appendChild(lift);
    // The port's page header: the port places every program window (and the text box under the caret) its height
    // lower (page-bridge.js wxpage_set_window_rect, the first element of class "header"), and tells the program the
    // page's top (#main-window's offsetTop) at each resize, which it takes off the window's size and off every mouse
    // and finger position (wasm/app.cpp FillMouse, shared wx edit z55). The first window's arrival is such a resize,
    // so the program learns the bar's height before anyone points at it. Programs built before z55 (Bambu b53, Orca
    // oto27, Prusa b26, KiCad k27 and older) take clicks the bar's height too low: never serve this bar with them.
    bar.classList.add('header');
    var wc = document.getElementById('window-container');
    if (wc && window.MutationObserver) {
      var told = new MutationObserver(function () {
        if (!wc.firstChild) return;
        told.disconnect();
        setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 0);
      });
      told.observe(wc, { childList: true });
    }
    draw();
    learn(0);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
