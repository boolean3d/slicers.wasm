# Thin lines land on whole pixels, as on the desktop. wxGTK 3 draws every wxDC through Cairo (wxGCDC), which moves
# a stroke by half a pixel when the pen is 1 px or an odd width at scale 1 (graphicc.cpp wxCairoContext::ShouldOffset +
# wxCairoOffsetHelper), and draws an outlined (rounded) rectangle 1 px smaller (dcgraph.cpp DoDrawRectangle: "outline
# is one pixel larger than what raster-based wxDC implementations draw"). The wasm wxDC stroked at whole coordinates:
# every 1 px line (menu separators, box edges, panel borders) came out as a blurred 2 px grey line, and outlined
# boxes were 1 px too big. Fills stay where they were.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

W = 'build/wasm/wx.js'

sub(W, '''  var drawRect = function (id, x, y, width, height, fill, stroke) {
    var ctx = getContext(id);

    if (fill) {
      ctx.fillRect(x, y, width, height);
    }

    if (stroke) {
      ctx.strokeRect(x, y, width, height);
    }
  };''', '''  // Cairo's half-pixel move for strokes (wxCairoContext::ShouldOffset): 1 px or odd pens, at scale 1 only
  var penOffset = function (ctx) {
    var sf = ctx.scaleFactor || 1.0;
    var lw = ctx.lineWidth;
    if (lw <= 1) return 0.5 / sf;
    if (sf != 1.0) return 0;
    return (lw % 2) == 1 ? 0.5 : 0;
  };

  var strokeOffset = function (ctx) {
    var o = penOffset(ctx);
    if (o) ctx.translate(o, o);
    ctx.stroke();
    if (o) ctx.translate(-o, -o);
  };

  var drawRect = function (id, x, y, width, height, fill, stroke) {
    var ctx = getContext(id);

    // wxGCDC: an outlined rectangle is one pixel smaller
    if (stroke) {
      width -= 1;
      height -= 1;
    }

    if (fill) {
      ctx.fillRect(x, y, width, height);
    }

    if (stroke) {
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      strokeOffset(ctx);
    }
  };''')

sub(W, '''  var drawRoundedRect = function (id, x, y, width, height, radius, fill, stroke) {
    var ctx = getContext(id);

    ctx.beginPath();''', '''  var drawRoundedRect = function (id, x, y, width, height, radius, fill, stroke) {
    var ctx = getContext(id);

    // wxGCDC: an outlined rectangle is one pixel smaller
    if (stroke) {
      width -= 1;
      height -= 1;
    }

    ctx.beginPath();''')

sub(W, '''    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();

    if (fill) {
      ctx.fill();
    }

    if (stroke) {
      ctx.stroke();
    }
  };''', '''    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();

    if (fill) {
      ctx.fill();
    }

    if (stroke) {
      strokeOffset(ctx);
    }
  };''')

sub(W, '''    ctx.ellipse(cx, cy, radiusX, radiusY, 0.0, 0.0, 2 * Math.PI);

    if (fill) {
      ctx.fill();
    }

    if (stroke) {
      ctx.stroke();
    }''', '''    ctx.ellipse(cx, cy, radiusX, radiusY, 0.0, 0.0, 2 * Math.PI);

    if (fill) {
      ctx.fill();
    }

    if (stroke) {
      strokeOffset(ctx);
    }''')

sub(W, '''    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);

    ctx.stroke();''', '''    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);

    strokeOffset(ctx);''')

sub(W, '''        ctx.lineTo(x, y);
      }

      ctx.stroke();
    } 
  };''', '''        ctx.lineTo(x, y);
      }

      strokeOffset(ctx);
    } 
  };''')

sub(W, '''      ctx.closePath();

      if (fill) {
        ctx.fill(fillEvenOdd ? 'evenodd' : 'nonzero');
      }

      if (stroke) {
        ctx.stroke();
      }''', '''      ctx.closePath();

      if (fill) {
        ctx.fill(fillEvenOdd ? 'evenodd' : 'nonzero');
      }

      if (stroke) {
        strokeOffset(ctx);
      }''')
