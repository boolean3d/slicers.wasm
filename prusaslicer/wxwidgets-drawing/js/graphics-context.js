// wxGraphicsContext on the 2D canvas (src/wasm/graphics.cpp), a --pre-js after wx.js: it draws on wx.js's canvas
// contexts (getContext, bitmapMap). A context keeps its own transform, clips, composition and layers here; every
// drawing call saves the canvas, applies them, draws and restores, so the wxDC's own state is never touched.

var wxgcMap = new Map();
var wxgcNextId = 1;
var wxgcStyles = new Map();
var wxgcNextStyleId = 1;

// a path as graphics.cpp writes it: [0 x y] move, [1 x y] line, [2 x1 y1 x2 y2 x y] curve, [3] close
var wxgcReadPath = function (ptr, n) {
  var f = Module.HEAPF64;
  var i = ptr >> 3;
  var end = i + n;
  var p = new Path2D();
  while (i < end) {
    var op = f[i++];
    if (op === 0) { p.moveTo(f[i], f[i + 1]); i += 2; }
    else if (op === 1) { p.lineTo(f[i], f[i + 1]); i += 2; }
    else if (op === 2) { p.bezierCurveTo(f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]); i += 6; }
    else { p.closePath(); }
  }
  return p;
};

var wxgcCreate = function (contextId) {
  var id = wxgcNextId++;
  wxgcMap.set(id, { contextId: contextId, m: [1, 0, 0, 1, 0, 0], clips: [], comp: 'source-over', smooth: 'low',
                    stack: [], layers: [] });
  return id;
};

var wxgcDestroy = function (id) {
  wxgcMap.delete(id);
};

var wxgcSetTransform = function (id, a, b, c, d, e, f) {
  wxgcMap.get(id).m = [a, b, c, d, e, f];
};

var wxgcPush = function (id) {
  var g = wxgcMap.get(id);
  g.stack.push({ clips: g.clips.slice(), comp: g.comp, smooth: g.smooth });
};

var wxgcPop = function (id) {
  var g = wxgcMap.get(id);
  var s = g.stack.pop();
  if (s) { g.clips = s.clips; g.comp = s.comp; g.smooth = s.smooth; }
};

// a clip is kept in the canvas' coordinates (the transform when it was set), as Cairo keeps it
var wxgcClip = function (id, ptr, n) {
  var g = wxgcMap.get(id);
  var p = new Path2D();
  p.addPath(wxgcReadPath(ptr, n), new DOMMatrix(g.m));
  g.clips.push(p);
};

var wxgcResetClip = function (id) {
  wxgcMap.get(id).clips = [];
};

var wxgcSetComposition = function (id, mode) {
  wxgcMap.get(id).comp = mode;
};

var wxgcSetSmoothing = function (id, quality) {
  wxgcMap.get(id).smooth = quality;
};

// the canvas this context draws on now: its open layer, else the wxDC's canvas; null for a measuring context
var wxgcTarget = function (g) {
  if (g.layers.length) return g.layers[g.layers.length - 1].ctx;
  return g.contextId >= 0 ? getContext(g.contextId) : null;
};

// save the canvas and apply the clips and composition; the caller applies the transform it needs
var wxgcBegin = function (g) {
  var ctx = wxgcTarget(g);
  if (!ctx || g.comp === 'dest') return null;
  ctx.save();
  for (var i = 0; i < g.clips.length; i++) ctx.clip(g.clips[i]);
  ctx.globalCompositeOperation = g.comp === 'clear' ? 'destination-out' : g.comp;
  return ctx;
};

var wxgcColour = function (c) {
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + c[3] + ')';
};

var wxgcBitmapSource = function (bitmap) {
  if (bitmap.imageBitmap) return bitmap.imageBitmap;
  if (bitmap.context) return bitmap.context.canvas;
  var canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').putImageData(bitmap.imageData, 0, 0);
  return canvas;
};

// a paint as the canvas takes it; the gradient's own matrix is returned for the caller to apply
var wxgcPaint = function (ctx, paint) {
  if (paint.colour) return { style: wxgcColour(paint.colour) };
  if (paint.pattern !== undefined) {
    var bitmap = bitmapMap.get(paint.pattern);
    if (!bitmap) return { style: 'rgba(0,0,0,0)' };
    var pattern = ctx.createPattern(wxgcBitmapSource(bitmap), 'repeat');
    if (bitmap.scaleFactor !== 1.0) pattern.setTransform(new DOMMatrix([1 / bitmap.scaleFactor, 0, 0, 1 / bitmap.scaleFactor, 0, 0]));
    return { style: pattern };
  }
  var gr = paint.gradient === 'radial'
    ? ctx.createRadialGradient(paint.x1, paint.y1, 0, paint.x2, paint.y2, paint.r)
    : ctx.createLinearGradient(paint.x1, paint.y1, paint.x2, paint.y2);
  for (var i = 0; i < paint.stops.length; i++) {
    gr.addColorStop(Math.min(1, Math.max(0, paint.stops[i][0])), wxgcColour(paint.stops[i][1]));
  }
  return { style: gr, m: paint.m };
};

var wxgcStyleCreate = function (json) {
  var id = wxgcNextStyleId++;
  wxgcStyles.set(id, JSON.parse(json));
  return id;
};

var wxgcStyleDestroy = function (id) {
  wxgcStyles.delete(id);
};

var wxgcStroke = function (id, ptr, n, penId, offset) {
  var g = wxgcMap.get(id);
  var ctx = wxgcBegin(g);
  if (!ctx) return;
  var pen = wxgcStyles.get(penId);
  ctx.transform(g.m[0], g.m[1], g.m[2], g.m[3], g.m[4], g.m[5]);
  if (offset) ctx.translate(0.5, 0.5);
  var path = wxgcReadPath(ptr, n);
  var paint = wxgcPaint(ctx, pen.paint);
  if (paint.m) ctx.transform(paint.m[0], paint.m[1], paint.m[2], paint.m[3], paint.m[4], paint.m[5]);
  ctx.lineWidth = pen.width;
  ctx.lineJoin = pen.join;
  ctx.lineCap = pen.cap;
  ctx.setLineDash(pen.dashes);
  ctx.strokeStyle = paint.style;
  if (paint.m) {
    var inv = new DOMMatrix(paint.m).inverse();
    var p2 = new Path2D();
    p2.addPath(path, inv);
    path = p2;
  }
  ctx.stroke(path);
  ctx.restore();
};

var wxgcFill = function (id, ptr, n, brushId, evenOdd) {
  var g = wxgcMap.get(id);
  var ctx = wxgcBegin(g);
  if (!ctx) return;
  var brush = wxgcStyles.get(brushId);
  ctx.transform(g.m[0], g.m[1], g.m[2], g.m[3], g.m[4], g.m[5]);
  var path = wxgcReadPath(ptr, n);
  var paint = wxgcPaint(ctx, brush.paint);
  if (paint.m) {
    // the gradient lives in its own space: draw the path there through the matrix's inverse
    ctx.transform(paint.m[0], paint.m[1], paint.m[2], paint.m[3], paint.m[4], paint.m[5]);
    var p2 = new Path2D();
    p2.addPath(path, new DOMMatrix(paint.m).inverse());
    path = p2;
  }
  ctx.fillStyle = paint.style;
  ctx.fill(path, evenOdd ? 'evenodd' : 'nonzero');
  ctx.restore();
};

var wxgcPathContains = function (ptr, n, x, y, evenOdd) {
  offscreenContext.setTransform(1, 0, 0, 1, 0, 0);
  return offscreenContext.isPointInPath(wxgcReadPath(ptr, n), x, y, evenOdd ? 'evenodd' : 'nonzero') ? 1 : 0;
};

// width, ascent, descent of one line in the font's own metrics
var wxgcTextMetrics = function (text, font) {
  offscreenContext.font = font;
  var m = offscreenContext.measureText(text);
  var ascent = m.fontBoundingBoxAscent !== undefined ? m.fontBoundingBoxAscent : m.actualBoundingBoxAscent;
  var descent = m.fontBoundingBoxDescent !== undefined ? m.fontBoundingBoxDescent : m.actualBoundingBoxDescent;
  return [m.width, ascent, descent];
};

var wxgcMeasure = function (text, font, out) {
  var r = wxgcTextMetrics(text, font);
  Module.HEAPF64.set(r, out >> 3);
};

// the width up to and including each character (wxString counts code points)
var wxgcPartialExtents = function (text, font, out, n) {
  offscreenContext.font = font;
  var chars = Array.from(text);
  var prefix = '';
  var widths = new Float64Array(n);
  for (var i = 0; i < n && i < chars.length; i++) {
    prefix += chars[i];
    widths[i] = offscreenContext.measureText(prefix).width;
  }
  Module.HEAPF64.set(widths, out >> 3);
};

// (x, y) is the text's top left, as in every wx port
var wxgcDrawText = function (id, text, x, y, font, colour, underlined, struckThrough) {
  var g = wxgcMap.get(id);
  var ctx = wxgcBegin(g);
  if (!ctx) return;
  ctx.transform(g.m[0], g.m[1], g.m[2], g.m[3], g.m[4], g.m[5]);
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  var style = makeColorString(colour);
  ctx.fillStyle = style;
  var r = wxgcTextMetrics(text, font);
  var base = y + r[1];
  ctx.fillText(text, x, base);
  if (underlined || struckThrough) {
    var t = Math.max(1, (r[1] + r[2]) / 16);
    if (underlined) ctx.fillRect(x, base + r[2] / 3, r[0], t);
    if (struckThrough) ctx.fillRect(x, base - r[1] / 3, r[0], t);
  }
  ctx.restore();
};

var wxgcDrawBitmap = function (id, bitmapId, x, y, w, h) {
  var g = wxgcMap.get(id);
  var bitmap = bitmapMap.get(bitmapId);
  if (!bitmap) return;
  var ctx = wxgcBegin(g);
  if (!ctx) return;
  ctx.transform(g.m[0], g.m[1], g.m[2], g.m[3], g.m[4], g.m[5]);
  ctx.imageSmoothingEnabled = g.smooth !== 'none';
  if (g.smooth !== 'none') ctx.imageSmoothingQuality = g.smooth;
  ctx.drawImage(wxgcBitmapSource(bitmap), 0, 0, bitmap.width, bitmap.height, x, y, w, h);
  ctx.restore();
};

// a layer: an offscreen canvas the size of the target, drawn back with the opacity when it ends
var wxgcBeginLayer = function (id, opacity) {
  var g = wxgcMap.get(id);
  var target = wxgcTarget(g);
  if (!target) return;
  var canvas = new OffscreenCanvas(target.canvas.width, target.canvas.height);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(target.getTransform());
  g.layers.push({ ctx: ctx, opacity: opacity, clips: g.clips.slice() });
};

var wxgcEndLayer = function (id) {
  var g = wxgcMap.get(id);
  var layer = g.layers.pop();
  if (!layer) return;
  var ctx = wxgcTarget(g);
  ctx.save();
  for (var i = 0; i < layer.clips.length; i++) ctx.clip(layer.clips[i]);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = layer.opacity;
  ctx.drawImage(layer.ctx.canvas, 0, 0);
  ctx.restore();
};
