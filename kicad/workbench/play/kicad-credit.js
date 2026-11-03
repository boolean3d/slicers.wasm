// The loading screen of a KiCad program served in a browser tab (ported from the slicers' credit.js): who made the
// program, its licence, that this browser copy is not theirs, the demo files' licence, and how far the download has got.
// Plain text on a neutral background, no logo. kicad-package.mjs puts this script after the page's Module set-up and
// before index.js; it goes away when the program's first window (the first-run wizard or the main window) is up.
(function () {
  var NAMES = { kicad: 'KiCad', eeschema: 'KiCad Schematic Editor', pcbnew: 'KiCad PCB Editor' };
  var cfg = window.KICAD_PAGE || {};
  var name = NAMES[cfg.prog];
  if (!name) return;
  document.title = name;
  var lines = ['Made by the KiCad developers. Version ' + (cfg.kicad || '') + '.',
    'Open source under the GNU GPL-3.0. Running in your browser.',
    'Unofficial: not made or endorsed by the KiCad team.',
    'Demo projects from KiCad, under CC BY-SA 4.0.',
    'Part models from the KiCad libraries (kicad-packages3D 10.0.0), under CC BY-SA 4.0.'];

  var css = '#credit{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;'
    + 'background:#26282b;color:#e8e8e8;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transition:opacity .3s}'
    + '#credit.gone{opacity:0;pointer-events:none}'
    + '#credit .box{max-width:560px;padding:32px}'
    + '#credit h1{font-size:28px;font-weight:600;margin:0 0 16px}'
    + '#credit p{margin:0 0 6px;color:#c4c4c4}'
    + '#credit .bar{height:4px;background:#3a3d41;border-radius:2px;margin:24px 0 8px;overflow:hidden}'
    + '#credit .fill{height:100%;width:0;background:#9aa0a6;transition:width .2s}'
    + '#credit .state{font-size:13px;color:#9aa0a6;min-height:20px}'
    + '#credit .links{margin-top:20px;font-size:13px}'
    + '#credit a{color:#c4c4c4;margin-right:18px}'
    + '#progress-container{display:none}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var root = document.createElement('div');
  root.id = 'credit';
  var box = document.createElement('div');
  box.className = 'box';
  var h = document.createElement('h1');
  h.textContent = name;
  box.appendChild(h);
  lines.forEach(function (s) { var p = document.createElement('p'); p.textContent = s; box.appendChild(p); });
  var bar = document.createElement('div'); bar.className = 'bar';
  var fill = document.createElement('div'); fill.className = 'fill'; bar.appendChild(fill);
  var state = document.createElement('div'); state.className = 'state'; state.textContent = 'Downloading…';
  box.appendChild(bar); box.appendChild(state);
  var links = document.createElement('div'); links.className = 'links';
  [['Licence', '../LICENSE.txt'], ['Source of this browser copy', '../SOURCE.txt']].forEach(function (l) {
    var a = document.createElement('a'); a.href = l[1]; a.textContent = l[0]; a.target = '_blank'; a.rel = 'noopener';
    links.appendChild(a);
  });
  box.appendChild(links);
  root.appendChild(box);
  (document.body || document.documentElement).appendChild(root);

  if (!self.crossOriginIsolated) {
    state.textContent = 'This address cannot run KiCad: the browser only gives it the memory it needs on a secure https address.';
    return;
  }

  // Emscripten reports the data download as "Downloading data... (got/total)"; the program itself is fetched by the
  // browser beside it, so the bar shows the data and the wasm together as one count once both are known.
  var mb = function (n) { return Math.round(n / 1e6); };
  var setStatus = Module.setStatus;
  Module.setStatus = function (s) {
    var m = /\((\d+(?:\.\d+)?)\/(\d+)\)/.exec(s || '');
    if (m && /download/i.test(s)) {
      var done = Math.min(1, m[1] / (cfg.dataRaw || m[2]));
      var sent = cfg.dataSent || m[2];
      fill.style.width = (100 * done) + '%';
      state.textContent = 'Downloading ' + mb(done * sent) + ' of ' + mb(sent) + ' MB';
    } else if (s === '' || /complete|preparing|running/i.test(s || '')) {
      fill.style.width = '100%';
      state.textContent = 'Starting ' + name + '…';
    }
    if (setStatus) return setStatus.apply(this, arguments);
  };
  var onAbort = Module.onAbort;
  Module.onAbort = function (what) {
    state.textContent = name + ' stopped while starting. Reload the page to try again.';
    if (onAbort) return onAbort.apply(this, arguments);
  };
  addEventListener('error', function (e) { if (root.isConnected) state.textContent = name + ' stopped while starting: ' + String(e.message).slice(0, 200); });

  // Up when the program shows any window of its own (its main window, or before it a dialog: the first-start setup
  // wizard, a notice): the screen must never hide a window that waits for an answer.
  var timer = setInterval(function () {
    var w = document.querySelectorAll('#window-container .window');
    for (var i = 0; i < w.length; i++) {
      var r = w[i].getBoundingClientRect();
      if (r.width >= 150 && r.height >= 80) {
        clearInterval(timer);
        root.className = 'gone';
        setTimeout(function () { root.remove(); }, 400);
        return;
      }
    }
  }, 250);
})();
