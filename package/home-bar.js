// home-bar.js: the thin row over every program in a tab (Bambu Studio, OrcaSlicer, PrusaSlicer, the brand slicers,
// KiCad): a small house at the top left that goes back to Boolean3d's Home, and nothing else. It replaces
// workspace-bar.js (Boolean3d > the project, Design / Electronics / Make): 11-03, the top bar is gone
// everywhere; the file decides the program, so a program needs no switcher, only the way home. A new file name, not
// a new workspace-bar.js: a version folder's files are cached for a year, its index.html never, so a visitor's page
// loads this file at its next visit.
//
// The program inside is untouched: the row sits above the page's #main-window, and the browser port already gives the
// program the window's height less that offset (page-bridge.js wxpage_screen_height) and moves its windows down by it.
// A button floating over the program would cover its own File menu at the top left, so the house has a row of its own.
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
// event), the row says so on the right: "<part> has a newer version (vN) · Update"; after Update, how to take it in
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

  var css = '#b3d-bar{position:relative;z-index:2147483646;height:' + HEIGHT + 'px;box-sizing:border-box;display:flex;align-items:center;'
    + 'gap:12px;padding:0 6px;background:#26282b;color:#c4c4c4;border-bottom:1px solid #3a3d41;'
    + 'font:13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;user-select:none;white-space:nowrap;overflow:hidden}'
    + '#b3d-bar .home{display:flex;align-items:center;justify-content:center;width:28px;height:22px;border-radius:4px;color:#c4c4c4;flex:none}'
    + '#b3d-bar .home svg{width:16px;height:16px;display:block}'
    + '#b3d-bar .home:hover{color:#ffffff;background:#3a3d41}'
    + '#b3d-bar .home:focus-visible,#b3d-bar button:focus-visible{outline:2px solid #9aa0a6;outline-offset:-2px}'
    + '#b3d-bar .update{display:none;margin-left:auto;align-items:center;gap:8px;color:#e8e8e8;min-width:0;overflow:hidden}'
    + '#b3d-bar .update span{overflow:hidden;text-overflow:ellipsis}'
    + '#b3d-bar .update button{font:inherit;color:#26282b;background:#e8e8e8;border:0;border-radius:3px;padding:3px 10px;cursor:pointer}'
    + '#b3d-bar .update button:hover{background:#ffffff}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.id = 'b3d-bar';
  bar.setAttribute('role', 'banner');
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
  bar.appendChild(home);

  // The open file's part saved since (project-folder.js): what it is, and the Update button.
  var upd = document.createElement('div'); upd.className = 'update'; upd.setAttribute('data-testid', 'b3d-bar-update'); upd.setAttribute('role', 'status');
  var updWords = document.createElement('span');
  var updGo = document.createElement('button'); updGo.type = 'button'; updGo.textContent = 'Update';
  upd.appendChild(updWords); upd.appendChild(updGo); bar.appendChild(upd);
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

  function mount() {
    var mw = document.getElementById('main-window');
    if (mw && mw.parentNode) mw.parentNode.insertBefore(bar, mw); else document.body.insertBefore(bar, document.body.firstChild);
    // The page's full-height parts start under the row: the loading screen's layer, and the program's window layer.
    var lift = document.createElement('style');
    lift.textContent = '#credit,#kicad-credit{top:' + HEIGHT + 'px!important}';
    document.head.appendChild(lift);
    // The port's page header: the port places every program window (and the text box under the caret) its height
    // lower (page-bridge.js wxpage_set_window_rect, the first element of class "header"), and tells the program the
    // page's top (#main-window's offsetTop) at each resize, which it takes off the window's size and off every mouse
    // and finger position (wasm/app.cpp FillMouse, shared wx edit z55). The first window's arrival is such a resize,
    // so the program learns the row's height before anyone points at it. Programs built before z55 (Bambu b53, Orca
    // oto27, Prusa b26, KiCad k27 and older) take clicks the row's height too low: never serve this row with them.
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
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
