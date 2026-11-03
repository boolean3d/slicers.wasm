/* The loading screens' picture, one for every program of the site: the CAD editor (index.html #editor-coming), the
 * slicers (the slicer package's credit.js) and KiCad (kicad-credit.js) all draw this same part. A machined part,
 * a plate with two holes and a bored boss, drawn as lines in code (no image, font or file fetched), turning slowly.
 * Its edges are the progress: they trace in the accent colour as the download goes (`progress(share)`), or a short
 * trace runs round them while nothing is counted (`progress(null)`).
 *
 * It must not slow the load it decorates: about 150 short lines drawn into a small canvas at most 20 times a second,
 * nothing at all while the tab is hidden or once the canvas has left the page, one still frame for reduced motion.
 * A plain script (no module) so a slicer's or KiCad's page can load it as it is: `window.B3dLoadingArt.mount(el)`.
 */
(function () {
  // Read by node too (the site's unit tests import its users): there is no page to draw on there.
  if (typeof window === 'undefined' || window.B3dLoadingArt) return;
  var TAU = Math.PI * 2;

  // The part, in mm: x across, z deep, y up. Plate 80 x 50 x 10 with 8 mm corners, two 9 mm holes,
  // a 30 mm boss 18 mm tall with a 16 mm bore through everything.
  var W = 40, D = 25, T = 10, RC = 8, HX = 27, RH = 4.5, RB = 15, RBORE = 8, TOP = 32;
  var CY = TOP / 2;

  function circle(cx, cz, r, y, a0, a1, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var a = a0 + (a1 - a0) * i / n;
      pts.push([cx + r * Math.cos(a), y - CY, cz + r * Math.sin(a)]);
    }
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
  // from y, to y, arc start, arc end] for the plate's corners, the holes, the boss and the bore.
  var ROUND = [[W - RC, D - RC, RC, 0, T, 0, 1], [-W + RC, D - RC, RC, 0, T, 1, 2], [-W + RC, -D + RC, RC, 0, T, 2, 3],
    [W - RC, -D + RC, RC, 0, T, 3, 4], [-HX, 0, RH, 0, T, 0, 4], [HX, 0, RH, 0, T, 0, 4],
    [0, 0, RB, T, TOP, 0, 4], [0, 0, RBORE, 0, TOP, 0, 4]];

  function mount(host, opts) {
    opts = opts || {};
    var size = opts.size || 160;
    var line = opts.line || '#9aa0a6', trace = opts.trace || '#3a9bfd';
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'b3d-loading-art';
    canvas.style.width = canvas.style.height = size + 'px';
    canvas.style.display = 'block';
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(size * dpr);
    host.appendChild(canvas);
    var g = canvas.getContext('2d');
    if (!g) return { progress: function () {}, stop: function () {} };
    var share = null, t0 = performance.now(), last = -1e9, raf = 0, stopped = false;
    var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var scale = canvas.width / 100, mid = canvas.width / 2;
    var TILT = 0.55, ct = Math.cos(TILT), st = Math.sin(TILT);

    function draw(now) {
      var turn = still ? 0.6 : (now - t0) / 16000 * TAU;   // one turn in 16 s
      var cr = Math.cos(turn), sr = Math.sin(turn);
      // World -> screen: turn about y, tip towards the eye about x, flat (orthographic) projection.
      var P = function (p) {
        var x = p[0] * cr - p[2] * sr, z = p[0] * sr + p[2] * cr;
        var y = p[1] * ct - z * st, d = p[1] * st + z * ct;
        return [mid + x * scale, mid - y * scale, d];
      };
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.lineCap = 'round';
      g.lineWidth = Math.max(1, dpr);
      // Nearer lines brighter: three shades by depth, one stroke each.
      var paths = [new Path2D(), new Path2D(), new Path2D()], lit = new Path2D();
      var shade = function (d) { return d > 12 ? 2 : d > -12 ? 1 : 0; };
      // The trace: a share of the edges' length from the first edge, or a short run going round.
      var from = 0, to = 0;
      if (share === null) { from = ((now - t0) / 6000 % 1) * TOTAL; to = from + TOTAL * 0.18; }
      else to = share * TOTAL;
      for (var i = 0; i < SEG.length; i++) {
        var s = SEG[i], a = P(s[0]), b = P(s[1]);
        var p = paths[shade((a[2] + b[2]) / 2)];
        p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]);
        var s0 = s[2], s1 = s[2] + s[3];
        for (var k = 0; k < 2; k++) {   // the trace may wrap past the end once
          var f0 = from - k * TOTAL, f1 = to - k * TOTAL;
          if (f1 <= s0 || f0 >= s1) continue;
          var u0 = Math.max(0, (f0 - s0) / s[3]), u1 = Math.min(1, (f1 - s0) / s[3]);
          lit.moveTo(a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0);
          lit.lineTo(a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1);
        }
      }
      // The eye's direction across the floor: a round face's outline is where its surface turns away from it.
      var ex = sr, ez = cr, ang = Math.atan2(ez, ex) + Math.PI / 2;
      for (var j = 0; j < ROUND.length; j++) {
        var r = ROUND[j];
        for (var side = 0; side < 2; side++) {
          var th = ((ang + side * Math.PI) % TAU + TAU) % TAU;
          if (th < r[5] * Math.PI / 2 - 1e-9 || th > r[6] * Math.PI / 2 + 1e-9) continue;
          var x = r[0] + r[2] * Math.cos(th), z = r[1] + r[2] * Math.sin(th);
          var a2 = P([x, r[3] - CY, z]), b2 = P([x, r[4] - CY, z]);
          var p2 = paths[shade((a2[2] + b2[2]) / 2)];
          p2.moveTo(a2[0], a2[1]); p2.lineTo(b2[0], b2[1]);
        }
      }
      var alpha = [0.32, 0.6, 1];
      g.strokeStyle = line;
      for (var n = 0; n < 3; n++) { g.globalAlpha = alpha[n]; g.stroke(paths[n]); }
      g.globalAlpha = 1;
      g.strokeStyle = trace;
      g.lineWidth = Math.max(1.5, 1.6 * dpr);
      g.stroke(lit);
    }
    function frame(now) {
      raf = 0;
      if (stopped || !canvas.isConnected) return;
      if (now - last >= 50) { last = now; draw(now); }
      if (!still) raf = requestAnimationFrame(frame);
    }
    draw(t0);
    if (!still) raf = requestAnimationFrame(frame);
    // A hidden tab gets no frames from the browser; coming back starts them again.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !raf && !stopped && !still && canvas.isConnected) raf = requestAnimationFrame(frame);
    });
    return {
      canvas: canvas,
      // share 0..1 of the download, or null while nothing is counted
      progress: function (v) { share = v === null || v === undefined ? null : Math.max(0, Math.min(1, v)); if (still) draw(performance.now()); },
      stop: function () { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; },
    };
  }
  window.B3dLoadingArt = { mount: mount };
})();
