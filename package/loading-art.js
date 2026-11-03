/* The loading screens' picture, one for every program of the site: the CAD editor (index.html #editor-coming), the
 * site's "opening the slicer" screen (slicerOpening.js), the slicers (the slicer package's credit.js) and KiCad
 * (kicad-credit.js) all draw this same part. A machined part, a plate with two holes and a bored boss, drawn as lines in
 * code (no image, font or file fetched), turning slowly. Its edges are the progress: they trace in the accent colour as
 * the download goes (`progress(share)`), or a short trace runs round them while nothing is counted (`progress(null)`).
 *
 * It must not slow the load it decorates, so the page's own thread does not draw it: the canvas is handed to a worker
 * (OffscreenCanvas, the worker made from this file's own `paint` below, nothing fetched) that draws it at most 20 times
 * a second, and stops once the canvas has left the page or the tab is hidden. A browser without OffscreenCanvas draws
 * it on the page instead; reduced motion gets one still picture.
 * A plain script (no module) so a slicer's or KiCad's page can load it as it is: `window.B3dLoadingArt.mount(el)`.
 */
(function () {
  // Read by node too (the site's unit tests import its users): there is no page to draw on there.
  if (typeof window === 'undefined' || window.B3dLoadingArt) return;

  /** The painter: self-contained (it runs as a worker's whole code), `scope` gets its messages. */
  function paint(scope) {
    var TAU = Math.PI * 2;
    // The part, in mm: x across, z deep, y up. Plate 80 x 50 x 10 with 8 mm corners, two 9 mm holes,
    // a 30 mm boss rising to 32 mm with a 16 mm bore through everything.
    var W = 40, D = 25, T = 10, RC = 8, HX = 27, RH = 4.5, RB = 15, RBORE = 8, TOP = 32, CY = TOP / 2;
    function circle(cx, cz, r, y, a0, a1, n) {
      var pts = [];
      for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), y - CY, cz + r * Math.sin(a)]); }
      return pts;
    }
    function plate(y) {
      var pts = [], q = Math.PI / 2;
      var c = [[W - RC, D - RC, 0], [-W + RC, D - RC, q], [-W + RC, -D + RC, 2 * q], [W - RC, -D + RC, 3 * q]];
      for (var k = 0; k < 4; k++) pts = pts.concat(circle(c[k][0], c[k][1], RC, y, c[k][2], c[k][2] + q, 5));
      pts.push(pts[0]);
      return pts;
    }
    // The fixed edges, in the order the trace draws them: the plate's bottom and top, the holes, the boss, the bore.
    var EDGES = [plate(0), plate(T),
      circle(-HX, 0, RH, T, 0, TAU, 20), circle(HX, 0, RH, T, 0, TAU, 20),
      circle(-HX, 0, RH, 0, 0, TAU, 20), circle(HX, 0, RH, 0, 0, TAU, 20),
      circle(0, 0, RB, T, 0, TAU, 32), circle(0, 0, RB, TOP, 0, TAU, 32),
      circle(0, 0, RBORE, TOP, 0, TAU, 24), circle(0, 0, RBORE, 0, 0, TAU, 24)];
    var SEG = [], TOTAL = 0;
    EDGES.forEach(function (p) {
      for (var i = 1; i < p.length; i++) {
        var a = p[i - 1], b = p[i], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        SEG.push([a, b, TOTAL, l]);
        TOTAL += l;
      }
    });
    // The round faces' outlines seen side on (each frame, from where the eye is): [centre x, centre z, radius,
    // from y, to y, arc start, arc end in quarter turns] for the plate's corners, the holes, the boss and the bore.
    var ROUND = [[W - RC, D - RC, RC, 0, T, 0, 1], [-W + RC, D - RC, RC, 0, T, 1, 2], [-W + RC, -D + RC, RC, 0, T, 2, 3],
      [W - RC, -D + RC, RC, 0, T, 3, 4], [-HX, 0, RH, 0, T, 0, 4], [HX, 0, RH, 0, T, 0, 4],
      [0, 0, RB, T, TOP, 0, 4], [0, 0, RBORE, 0, TOP, 0, 4]];
    var TILT = 0.55, ct = Math.cos(TILT), st = Math.sin(TILT);

    var canvas, g, o, share = null, t0 = 0, timer = 0, on = true;
    function draw(now) {
      var turn = o.still ? 0.6 : (now - t0) / 16000 * TAU;   // one turn in 16 s
      var cr = Math.cos(turn), sr = Math.sin(turn), scale = canvas.width / 100, mid = canvas.width / 2;
      // World -> screen: turn about y, tip towards the eye about x, flat (orthographic) projection.
      var P = function (p) {
        var x = p[0] * cr - p[2] * sr, z = p[0] * sr + p[2] * cr;
        return [mid + x * scale, mid - (p[1] * ct - z * st) * scale, p[1] * st + z * ct];
      };
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.lineCap = 'round';
      g.lineWidth = Math.max(1, o.dpr);
      // Nearer lines brighter: three shades by depth, one stroke each.
      var paths = [new Path2D(), new Path2D(), new Path2D()], lit = new Path2D();
      var shade = function (d) { return d > 12 ? 2 : d > -12 ? 1 : 0; };
      // The trace: a share of the edges' length from the first edge, or a short run going round.
      var from = 0, to = 0;
      if (share === null) { from = ((now - t0) / 6000 % 1) * TOTAL; to = from + TOTAL * 0.18; } else to = share * TOTAL;
      for (var i = 0; i < SEG.length; i++) {
        var s = SEG[i], a = P(s[0]), b = P(s[1]), p = paths[shade((a[2] + b[2]) / 2)];
        p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]);
        for (var k = 0; k < 2; k++) {   // the trace may wrap past the end once
          var f0 = from - k * TOTAL - s[2], f1 = to - k * TOTAL - s[2];
          if (f1 <= 0 || f0 >= s[3]) continue;
          var u0 = Math.max(0, f0 / s[3]), u1 = Math.min(1, f1 / s[3]);
          lit.moveTo(a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0);
          lit.lineTo(a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1);
        }
      }
      // A round face's outline is where its surface turns away from the eye's direction across the floor.
      var ang = Math.atan2(cr, sr) + Math.PI / 2;
      for (var j = 0; j < ROUND.length; j++) {
        var r = ROUND[j];
        for (var side = 0; side < 2; side++) {
          var th = ((ang + side * Math.PI) % TAU + TAU) % TAU;
          if (th < r[5] * Math.PI / 2 - 1e-9 || th > r[6] * Math.PI / 2 + 1e-9) continue;
          var x = r[0] + r[2] * Math.cos(th), z = r[1] + r[2] * Math.sin(th);
          var a2 = P([x, r[3] - CY, z]), b2 = P([x, r[4] - CY, z]), p2 = paths[shade((a2[2] + b2[2]) / 2)];
          p2.moveTo(a2[0], a2[1]); p2.lineTo(b2[0], b2[1]);
        }
      }
      var alpha = [0.32, 0.6, 1];
      g.strokeStyle = o.line;
      for (var n = 0; n < 3; n++) { g.globalAlpha = alpha[n]; g.stroke(paths[n]); }
      g.globalAlpha = 1;
      g.strokeStyle = o.trace;
      g.lineWidth = Math.max(1.5, 1.6 * o.dpr);
      g.stroke(lit);
    }
    function tick() {
      timer = 0;
      if (!on) return;
      draw(performance.now());
      if (!o.still) timer = setTimeout(tick, 50);
    }
    scope.onmessage = function (e) {
      var m = e.data;
      if (m.canvas) { canvas = m.canvas; o = m; g = canvas.getContext('2d'); t0 = performance.now(); tick(); return; }
      if (!g) return;
      if ('share' in m) { share = m.share; if (o.still) draw(performance.now()); }
      if ('on' in m) { on = m.on; if (on && !timer) tick(); else if (!on && timer) { clearTimeout(timer); timer = 0; } }
    };
  }

  function mount(host, opts) {
    opts = opts || {};
    var size = opts.size || 160, dpr = Math.min(2, window.devicePixelRatio || 1);
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'b3d-loading-art';
    canvas.style.width = canvas.style.height = size + 'px';
    canvas.style.display = 'block';
    canvas.width = canvas.height = Math.round(size * dpr);
    host.appendChild(canvas);
    var o = { dpr: dpr, line: opts.line || '#9aa0a6', trace: opts.trace || '#3a9bfd',
      still: !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) };
    var send, end;
    try {
      // Off the page's thread: the worker is this file's painter, made from its own text.
      if (!canvas.transferControlToOffscreen) throw 0;
      var url = URL.createObjectURL(new Blob(['(' + paint + ')(self)'], { type: 'text/javascript' }));
      var worker = new Worker(url);   // first: a page that refuses it still has its canvas to draw on itself
      URL.revokeObjectURL(url);
      var off = canvas.transferControlToOffscreen();
      o.canvas = off;
      worker.postMessage(o, [off]);
      send = function (m) { worker.postMessage(m); };
      end = function () { worker.terminate(); };
    } catch (e) {
      // No OffscreenCanvas (or no worker allowed): the same painter on the page.
      var here = {};
      paint(here);
      o.canvas = canvas;
      here.onmessage({ data: o });
      send = function (m) { here.onmessage({ data: m }); };
      end = function () { send({ on: false }); };
    }
    var done = false;
    var stop = function () {
      if (done) return;
      done = true; end(); clearInterval(watch);
      document.removeEventListener('visibilitychange', seen);
    };
    // A hidden tab: no drawing; the canvas gone from the page: the painter ends.
    var seen = function () { send({ on: !document.hidden }); };
    document.addEventListener('visibilitychange', seen);
    var watch = setInterval(function () { if (!canvas.isConnected) stop(); }, 1000);
    return {
      canvas: canvas,
      // share 0..1 of the download, or null while nothing is counted
      progress: function (v) { if (!done) send({ share: v === null || v === undefined ? null : Math.max(0, Math.min(1, v)) }); },
      stop: stop,
    };
  }
  window.B3dLoadingArt = { mount: mount };
})();
