// home-bar.js: the few buttons of ours over every program in a tab (Bambu Studio, OrcaSlicer, PrusaSlicer, the brand
// slicers, KiCad). Since 11-25 (slicer-feel-1125) there is no row of ours above the program: the program gets the whole
// height, and our buttons sit in the empty right end of the program's own top bar (no program draws anything there in a
// tab: its window buttons are gone), in a small dark corner: Install as an app (only when the browser offers it), Full
// screen (one press; again to leave), and the house back to Boolean3d's Home. Our presses never reach the program.
// It also shows the program's end: if the program ever ends (a crash, an abort), the tab shows "<program> closed" and one
// button, Reopen, which loads the same address again (the same file), never a blank page.
//
// Before 11-25 it was a row of its own: a small house at the top left that goes back to Boolean3d's Home, and nothing else. It replaces
// workspace-bar.js (Boolean3d > the project, Design / Electronics / Make): 11-03, the top bar is gone
// everywhere; the file decides the program, so a program needs no switcher, only the way home. A new file name, not
// a new workspace-bar.js: a version folder's files are cached for a year, its index.html never, so a visitor's page
// loads this file at its next visit.
//
// The program inside is untouched: the corner floats over the right end of its top bar, where nothing is drawn (at the
// top left it would cover the program's File menu).
//
// Home opens in this tab, as every move inside the site does (no new tab for each part of the site; the
// site opens a program in the tab it was pressed in, js/files/openInProgram.js). ?hub=<Boolean3d's address> (the app adds it to every link it makes) is kept, so a program
// opened later from a bookmark still knows where Home is.
//
// When this tab came here FROM the site, the house goes BACK to the page it left (the editor with the part still
// open), not to a fresh Home: the browser keeps that page in its back/forward cache, so it is on screen again in a
// tenth of a second instead of loading the site, landing on Home and opening the part again (measured 11-09: 0.1 s
// against 1-5 s). The app folder's index.html (package.mjs, never cached) writes down where the tab came from and how
// long its history was on arrival (sessionStorage, this tab only); every entry the program added since (its web
// views) is stepped over too. Came from anywhere else, or opened from a bookmark: the link to Home, as before. If the
// page to go back to is gone from the browser's memory, Back loads the editor's own address, still the open part.
//
// In a slicer, when the open file is made from a CAD part saved since (project-folder.js, its 'b3d-part-update'
// event), the corner says so: "<part> has a newer version (vN) · Update"; after Update, how to take it in
// (the program's own Reload from disk, which keeps the plate and every setting).
(function () {
  if (typeof document === 'undefined' || window.B3D_BAR) return;
  window.B3D_BAR = true;
  var HUB_KEY = 'b3d-hub', HEIGHT = 28;
  var q = new URLSearchParams(location.search);
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* this tab only */ } }

  var hubParam = q.get('hub');
  if (hubParam && /^https?:\/\/[^/]+\/?$/.test(hubParam)) set(HUB_KEY, hubParam.replace(/\/*$/, '/'));
  var HUB = get(HUB_KEY) || 'https://boolean3d.com/';

  // The corner: as tall as the programs' top bar, dark like it (Bambu Studio, Orca), and its own dark piece over a
  // light menu bar (PrusaSlicer, KiCad), so it reads on both.
  var css = '#b3d-bar{position:fixed;top:0;right:0;z-index:2147483646;height:' + HEIGHT + 'px;box-sizing:border-box;display:flex;align-items:center;'
    + 'gap:2px;padding:0 4px 0 8px;background:#26282b;color:#c4c4c4;border-bottom-left-radius:6px;'
    + 'font:13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;user-select:none;white-space:nowrap;overflow:hidden;max-width:70vw}'
    + '#b3d-bar .home,#b3d-bar .tool{display:flex;align-items:center;justify-content:center;width:28px;height:22px;border-radius:4px;color:#c4c4c4;flex:none;'
    + 'background:none;border:0;padding:0;margin:0;cursor:pointer;font:inherit}'
    + '#b3d-bar .home svg,#b3d-bar .tool svg{width:16px;height:16px;display:block}'
    + '#b3d-bar .home:hover,#b3d-bar .tool:hover{color:#ffffff;background:#3a3d41}'
    + '#b3d-bar .home:focus-visible,#b3d-bar button:focus-visible{outline:2px solid #9aa0a6;outline-offset:-2px}'
    + '#b3d-bar .update{display:none;margin-right:6px;align-items:center;gap:8px;color:#e8e8e8;min-width:0;overflow:hidden}'
    + '#b3d-bar .update span{overflow:hidden;text-overflow:ellipsis}'
    + '#b3d-bar .update button{font:inherit;color:#26282b;background:#e8e8e8;border:0;border-radius:3px;padding:3px 10px;cursor:pointer}'
    + '#b3d-bar .update button:hover{background:#ffffff}'
    + '#b3d-closed{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;'
    + 'background:#1f2124;color:#e8e8e8;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
    + '#b3d-closed h1{font-size:22px;font-weight:600;margin:0}'
    + '#b3d-closed button{font:inherit;font-weight:600;color:#1f2124;background:#e8e8e8;border:0;border-radius:6px;padding:9px 22px;cursor:pointer}'
    + '#b3d-closed button:hover{background:#ffffff}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.id = 'b3d-bar';
  bar.setAttribute('role', 'toolbar');
  ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'wheel', 'touchstart', 'touchend', 'touchmove', 'contextmenu'].forEach(function (t) {
    bar.addEventListener(t, function (e) { e.stopPropagation(); });
  });
  var home = document.createElement('a');
  home.className = 'home'; home.href = HUB;
  home.title = 'Home'; home.setAttribute('aria-label', 'Home'); home.setAttribute('data-testid', 'b3d-bar-home');
  // Back to the site's page this tab left, when it came from the site (see the top).
  var FROM_KEY = 'b3d-from', ARRIVED_KEY = 'b3d-arrived';
  function session(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function origin(u) { try { return new URL(u).origin; } catch (e) { return null; } }
  function stepsBack() {
    var from = origin(session(FROM_KEY) || ''), arrived = parseInt(session(ARRIVED_KEY) || '', 10);
    if (!from || from !== origin(HUB) || !(arrived > 0)) return 0;
    var len = (window.history && history.length) || 0;
    if (len < arrived) return 0;
    return len - arrived + 1;   // what the program added to the history since arriving, and one more to leave
  }
  home.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var n = stepsBack();
    if (!n) return;   // the link: Home
    e.preventDefault();
    // Going back did not leave this page (the entry is gone): Home, as the link would.
    var gone = false;
    window.addEventListener('pagehide', function () { gone = true; }, { once: true });
    setTimeout(function () { if (!gone) location.href = HUB; }, 1500);
    history.go(-n);
  });
  // The house: the same outline the site draws for Home (stroke, round joins).
  home.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg>';

  // Install as an app (an app window of its own, no browser bar: more height): only while the browser offers it.
  var ICONS = {
    install: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    full: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
    unfull: '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>',
  };
  function svg(d) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }
  function tool(name, label, icon) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'tool'; b.title = label;
    b.setAttribute('aria-label', label); b.setAttribute('data-testid', 'b3d-bar-' + name);
    b.innerHTML = svg(icon);
    return b;
  }
  var install = tool('install', 'Install as an app', ICONS.install);
  install.style.display = 'none';
  var offered = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); offered = e; install.style.display = ''; });
  window.addEventListener('appinstalled', function () { offered = null; install.style.display = 'none'; });
  install.addEventListener('click', function () {
    if (!offered) return;
    var o = offered; offered = null; install.style.display = 'none';
    o.prompt();
  });
  // Full screen: the whole screen for the program, one press; the same button (or Esc) leaves it.
  var full = tool('fullscreen', 'Full screen', ICONS.full);
  function fullShown() {
    var on = !!document.fullscreenElement;
    full.innerHTML = svg(on ? ICONS.unfull : ICONS.full);
    full.title = on ? 'Leave full screen' : 'Full screen';
    full.setAttribute('aria-label', full.title);
  }
  full.addEventListener('click', function () {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
    } catch (e) { /* the browser refused */ }
  });
  document.addEventListener('fullscreenchange', fullShown);
  if (!document.documentElement || !document.documentElement.requestFullscreen) full.style.display = 'none';
  bar.appendChild(install);
  bar.appendChild(full);
  bar.appendChild(home);

  // The open file's part saved since (project-folder.js): what it is, and the Update button.
  var upd = document.createElement('div'); upd.className = 'update'; upd.setAttribute('data-testid', 'b3d-bar-update'); upd.setAttribute('role', 'status');
  var updWords = document.createElement('span');
  var updGo = document.createElement('button'); updGo.type = 'button'; updGo.textContent = 'Update';
  upd.appendChild(updWords); upd.appendChild(updGo); bar.insertBefore(upd, bar.firstChild);
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
    updGo.style.display = o.step === 'offer' ? '' : 'none';
    upd.title = o.step === 'offer' ? 'Puts version ' + o.number + ' of ' + o.name + ' on the plate, keeping your settings' : '';
    upd.style.display = 'flex';
  }
  window.addEventListener('b3d-part-update', function (e) { showUpdate(e.detail); });
  if (window.Module && Module.b3dProjects && Module.b3dProjects.offer) showUpdate(Module.b3dProjects.offer());

  // The program's end, shown (not a blank page): Reopen loads the same address, so the same file comes back.
  var NAMES = { bambu: 'Bambu Studio', orca: 'OrcaSlicer', prusa: 'PrusaSlicer', snapmaker: 'Snapmaker Orca', elegoo: 'ElegooSlicer',
    anycubic: 'Anycubic Slicer Next', creality: 'Creality Print', kicad: 'KiCad' };
  var closedShown = false;
  function showClosed() {
    if (closedShown || !document.body) return;
    closedShown = true;
    var page = window.SLICER_PAGE || {};
    var name = NAMES[page.app] || (document.title || 'The program');
    var c = document.createElement('div');
    c.id = 'b3d-closed'; c.setAttribute('role', 'alertdialog'); c.setAttribute('data-testid', 'b3d-closed');
    var h = document.createElement('h1'); h.textContent = name + ' closed';
    var again = document.createElement('button'); again.type = 'button'; again.textContent = 'Reopen';
    again.addEventListener('click', function () { location.reload(); });
    ['mousedown', 'mouseup', 'mousemove', 'click', 'wheel', 'keydown', 'touchstart', 'touchend'].forEach(function (t) {
      c.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    c.appendChild(h); c.appendChild(again);
    document.body.appendChild(c);
    if (window.Module) window.Module.wxDirty = false;   // nothing left to lose: no "Leave site?" on Reopen
    try { again.focus(); } catch (e) {}
  }
  window.B3D_SHOW_CLOSED = showClosed;
  var up = false;
  if (window.Module) {
    var onExit = Module.onExit, onAbort = Module.onAbort;
    Module.onExit = function () { showClosed(); if (onExit) return onExit.apply(this, arguments); };
    // An abort before the window is up is the loading screen's to tell (credit.js); after it, this screen.
    Module.onAbort = function () { if (up) showClosed(); if (onAbort) return onAbort.apply(this, arguments); };
  }
  // The program's main window, once up, never goes away while it runs: gone for 3 s = the program ended.
  var goneSince = 0;
  var watch = setInterval(function () {
    var w = document.querySelectorAll ? document.querySelectorAll('#window-container .window') : [];
    var main = false;
    for (var i = 0; i < w.length; i++) {
      var r = w[i].getBoundingClientRect();
      if (r.width >= 0.8 * innerWidth && r.height >= 0.8 * innerHeight && getComputedStyle(w[i]).display !== 'none') { main = true; break; }
    }
    if (main) { up = true; goneSince = 0; return; }
    if (!up) return;
    if (!goneSince) goneSince = Date.now();
    else if (Date.now() - goneSince > 3000) { clearInterval(watch); showClosed(); }
  }, 500);

  function mount() {
    document.body.appendChild(bar);
  }

  // Chrome's Memory Saver puts away tabs nobody looked at for a while and loads them again when they come back
  // (document.wasDiscarded): the program starts again. The first time that happens in a browser, one line says why and
  // how to keep the site running (Chrome's own list of sites it never puts away). Once per browser, ever; Chrome only
  // (Edge has its own "sleeping tabs"). The same words and key as the site's (js/ui/discardNote.js).
  var DISCARD_KEY = 'b3d.discardNote';
  var DISCARD_NOTE = 'Chrome paused this tab to save memory. To keep Boolean3d running, add it to Chrome\'s '
    + '"Always keep these sites active": Settings > Performance > Memory Saver > Always keep these sites active > '
    + 'Add: boolean3d.com and slicers.boolean3d.com';
  function isChrome() {
    var brands = navigator.userAgentData && navigator.userAgentData.brands;
    if (Array.isArray(brands)) return brands.some(function (b) { return b.brand === 'Google Chrome'; });
    return /Chrome\//.test(navigator.userAgent) && !/Edg\/|OPR\/|SamsungBrowser|Brave/.test(navigator.userAgent);
  }
  try {
    if (document.wasDiscarded && isChrome() && !localStorage.getItem(DISCARD_KEY) && window.Module && Module.b3dNotice) {
      Module.b3dNotice(DISCARD_NOTE, 'note', { label: 'Got it' });
      localStorage.setItem(DISCARD_KEY, String(Date.now()));
    }
  } catch (e) { /* no storage: nothing said */ }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
