// The loading screen of a slicer served in a browser tab: who made the program, its licence, that this browser
// copy is not theirs, where its source is, and how far the download (the install, install-and-lazy-load.js) has got. Plain text on a neutral background,
// no logo (neither the slicer maker's nor the host's). The package puts this script after the page's Module set-up
// and before the program's script; it stays until the slicer's main window fills the page.
(function () {
  var TEXT = {
    bambu: {
      name: 'Bambu Studio',
      lines: ['Made by Bambu Lab. Based on PrusaSlicer by Prusa Research.',
        'Open source under the GNU AGPL-3.0. Running in your browser.',
        'This browser copy is not made or endorsed by Bambu Lab.'],
    },
    orca: {
      name: 'OrcaSlicer',
      lines: ['Made by SoftFever and the OrcaSlicer contributors. Based on Bambu Studio by Bambu Lab and PrusaSlicer by Prusa Research.',
        'Open source under the GNU AGPL-3.0. Running in your browser.',
        'This browser copy is not made or endorsed by the OrcaSlicer team.'],
    },
    prusa: {
      name: 'PrusaSlicer',
      lines: ['Made by Prusa Research. Based on Slic3r by Alessandro Ranellucci and the RepRap community.',
        'Open source under the GNU AGPL-3.0. Running in your browser.',
        'This browser copy is not made or endorsed by Prusa Research.'],
    },
  };
  var cfg = window.SLICER_PAGE || {};
  var t = TEXT[cfg.app];
  if (!t) return;
  document.title = t.name;

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
  h.textContent = t.name;
  box.appendChild(h);
  t.lines.forEach(function (s) { var p = document.createElement('p'); p.textContent = s; box.appendChild(p); });
  var bar = document.createElement('div'); bar.className = 'bar';
  var fill = document.createElement('div'); fill.className = 'fill'; bar.appendChild(fill);
  var state = document.createElement('div'); state.className = 'state'; state.textContent = 'Downloading…';
  box.appendChild(bar); box.appendChild(state);
  var links = document.createElement('div'); links.className = 'links';
  [['Source code of this browser copy', cfg.source], ['Licence', 'LICENSE.txt']].forEach(function (l) {
    if (!l[1]) return;
    var a = document.createElement('a'); a.href = l[1]; a.textContent = l[0]; a.target = '_blank'; a.rel = 'noopener';
    links.appendChild(a);
  });
  box.appendChild(links);
  root.appendChild(box);
  (document.body || document.documentElement).appendChild(root);

  // Emscripten reports the data download as "Downloading data... (got/total)": got counts unpacked bytes, total is
  // the packed size the browser was sent. The package gives both sizes of the program's data file, so the share done is
  // got / unpacked, shown against the size actually downloaded.
  var mb = function (n) { return Math.round(n / 1e6); };
  // The install (install-and-lazy-load.js): share done (0..1, or null to keep the bar) and what it is doing, in its words.
  window.SLICER_CREDIT = { show: function (share, text) {
    if (share !== null && share !== undefined) fill.style.width = (100 * Math.min(1, share)) + '%';
    state.textContent = text;
  } };
  var setStatus = Module.setStatus;
  Module.setStatus = function (s) {
    var m = /\((\d+(?:\.\d+)?)\/(\d+)\)/.exec(s || '');
    // Installed: the program's data file comes from the browser's copy, no download to show.
    if (window.SLICER_INSTALLED && m) return setStatus && setStatus.apply(this, arguments);
    if (m && /download/i.test(s)) {
      var done = Math.min(1, m[1] / (cfg.dataRaw || m[2]));
      var sent = cfg.dataSent || m[2];
      fill.style.width = (100 * done) + '%';
      state.textContent = 'Downloading ' + mb(done * sent) + ' of ' + mb(sent) + ' MB';
    } else if (s === '' || /complete|preparing|running/i.test(s || '')) {
      fill.style.width = '100%';
      state.textContent = 'Starting ' + t.name + '…';
    }
    if (setStatus) return setStatus.apply(this, arguments);
  };
  var onAbort = Module.onAbort;
  Module.onAbort = function (what) {
    state.textContent = t.name + ' stopped while starting. Reload the page to try again.';
    if (onAbort) return onAbort.apply(this, arguments);
  };

  // The main window is up when a window element covers most of the page.
  var timer = setInterval(function () {
    var w = document.querySelectorAll('#window-container .window');
    for (var i = 0; i < w.length; i++) {
      var r = w[i].getBoundingClientRect();
      if (r.width >= 0.8 * innerWidth && r.height >= 0.8 * innerHeight) {
        clearInterval(timer);
        root.className = 'gone';
        setTimeout(function () { root.remove(); }, 400);
        return;
      }
    }
  }, 250);
})();
