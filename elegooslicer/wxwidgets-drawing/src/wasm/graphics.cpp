/////////////////////////////////////////////////////////////////////////////
// Name:        src/wasm/graphics.cpp
// Purpose:     wxGraphicsContext for the wasm port, drawn with the browser's 2D canvas
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

// The desktop ports draw wxGraphicsContext with a native 2D library (GDI+/Direct2D, Core Graphics, Cairo, Qt).
// The browser has one too: the 2D canvas the port's wxDC already draws on (build/wasm/wx.js). This renderer
// gives wxGraphicsContext/wxGCDC the same canvases, with Cairo's (src/generic/graphicc.cpp) behaviour where
// the two libraries differ: arcs, pen dashes, the 0.5 pixel offset, the DC's transform taken over.
// The canvas keeps no state between calls here: each drawing call saves the canvas, sets this context's clip,
// transform and paint, draws and restores, so the wxDC drawing on the same canvas is never disturbed.
// JavaScript side: graphics-context.js (a --pre-js beside wx.js).

#include "wx/wxprec.h"

#if wxUSE_GRAPHICS_CONTEXT

#include "wx/graphics.h"
#include "wx/private/graphics.h"
#include "wx/dcclient.h"
#include "wx/dcmemory.h"
#include "wx/dcprint.h"
#include "wx/window.h"
#include "wx/image.h"
#include "wx/icon.h"
#include "wx/region.h"
#include "wx/wasm/dc.h"
#include "wx/wasm/private/display.h"

#include <emscripten.h>
#include <math.h>
#include <vector>

namespace
{

// ----------------------------------------------------------------------------
// affine matrix, Cairo's layout: x' = a x + c y + tx, y' = b x + d y + ty
// ----------------------------------------------------------------------------

struct Affine
{
    double a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0;

    // this(t(p)): t applies first (cairo_matrix_multiply(r, t, this))
    Affine Then(const Affine& t) const
    {
        Affine r;
        r.a = a * t.a + c * t.b;
        r.b = b * t.a + d * t.b;
        r.c = a * t.c + c * t.d;
        r.d = b * t.c + d * t.d;
        r.tx = a * t.tx + c * t.ty + tx;
        r.ty = b * t.tx + d * t.ty + ty;
        return r;
    }
    void Apply(double* x, double* y) const
    {
        const double nx = a * *x + c * *y + tx;
        *y = b * *x + d * *y + ty;
        *x = nx;
    }
    bool Invert()
    {
        const double det = a * d - b * c;
        if ( det == 0 )
            return false;
        Affine r;
        r.a = d / det;
        r.b = -b / det;
        r.c = -c / det;
        r.d = a / det;
        r.tx = -(r.a * tx + r.c * ty);
        r.ty = -(r.b * tx + r.d * ty);
        *this = r;
        return true;
    }
    static Affine Translation(double x, double y) { Affine m; m.tx = x; m.ty = y; return m; }
    static Affine Scaling(double x, double y) { Affine m; m.a = x; m.d = y; return m; }
    static Affine Rotation(double angle)
    {
        Affine m;
        m.a = cos(angle); m.b = sin(angle); m.c = -m.b; m.d = m.a;
        return m;
    }
};

class wxWasmMatrixData : public wxGraphicsMatrixData
{
public:
    wxWasmMatrixData(wxGraphicsRenderer* renderer, const Affine& m = Affine())
        : wxGraphicsMatrixData(renderer), m_m(m) {}

    virtual wxGraphicsObjectRefData* Clone() const wxOVERRIDE { return new wxWasmMatrixData(GetRenderer(), m_m); }

    virtual void Concat(const wxGraphicsMatrixData* t) wxOVERRIDE
        { m_m = m_m.Then(static_cast<const wxWasmMatrixData*>(t)->m_m); }
    virtual void Set(wxDouble a, wxDouble b, wxDouble c, wxDouble d, wxDouble tx, wxDouble ty) wxOVERRIDE
        { m_m.a = a; m_m.b = b; m_m.c = c; m_m.d = d; m_m.tx = tx; m_m.ty = ty; }
    virtual void Get(wxDouble* a, wxDouble* b, wxDouble* c, wxDouble* d, wxDouble* tx, wxDouble* ty) const wxOVERRIDE
    {
        if ( a ) *a = m_m.a;
        if ( b ) *b = m_m.b;
        if ( c ) *c = m_m.c;
        if ( d ) *d = m_m.d;
        if ( tx ) *tx = m_m.tx;
        if ( ty ) *ty = m_m.ty;
    }
    virtual void Invert() wxOVERRIDE { m_m.Invert(); }
    virtual bool IsEqual(const wxGraphicsMatrixData* t) const wxOVERRIDE
    {
        const Affine& o = static_cast<const wxWasmMatrixData*>(t)->m_m;
        return m_m.a == o.a && m_m.b == o.b && m_m.c == o.c && m_m.d == o.d && m_m.tx == o.tx && m_m.ty == o.ty;
    }
    virtual bool IsIdentity() const wxOVERRIDE
        { return m_m.a == 1 && m_m.b == 0 && m_m.c == 0 && m_m.d == 1 && m_m.tx == 0 && m_m.ty == 0; }
    virtual void Translate(wxDouble dx, wxDouble dy) wxOVERRIDE { m_m = m_m.Then(Affine::Translation(dx, dy)); }
    virtual void Scale(wxDouble xScale, wxDouble yScale) wxOVERRIDE { m_m = m_m.Then(Affine::Scaling(xScale, yScale)); }
    virtual void Rotate(wxDouble angle) wxOVERRIDE { m_m = m_m.Then(Affine::Rotation(angle)); }
    virtual void TransformPoint(wxDouble* x, wxDouble* y) const wxOVERRIDE { m_m.Apply(x, y); }
    virtual void TransformDistance(wxDouble* dx, wxDouble* dy) const wxOVERRIDE
    {
        const double nx = m_m.a * *dx + m_m.c * *dy;
        *dy = m_m.b * *dx + m_m.d * *dy;
        *dx = nx;
    }
    virtual void* GetNativeMatrix() const wxOVERRIDE { return const_cast<Affine*>(&m_m); }

    Affine m_m;
};

const Affine& AffineOf(const wxGraphicsMatrix& m)
{
    return static_cast<const wxWasmMatrixData*>(m.GetRefData())->m_m;
}

// ----------------------------------------------------------------------------
// path: flat list of moveTo/lineTo/curveTo/close, read by graphics-context.js
// ----------------------------------------------------------------------------

enum { OP_MOVE = 0, OP_LINE = 1, OP_CURVE = 2, OP_CLOSE = 3 };

class wxWasmPathData : public wxGraphicsPathData
{
public:
    wxWasmPathData(wxGraphicsRenderer* renderer) : wxGraphicsPathData(renderer) {}

    virtual wxGraphicsObjectRefData* Clone() const wxOVERRIDE
    {
        wxWasmPathData* p = new wxWasmPathData(GetRenderer());
        p->m_ops = m_ops;
        p->m_hasCurrent = m_hasCurrent;
        p->m_cx = m_cx; p->m_cy = m_cy; p->m_sx = m_sx; p->m_sy = m_sy;
        return p;
    }

    virtual void MoveToPoint(wxDouble x, wxDouble y) wxOVERRIDE
    {
        m_ops.insert(m_ops.end(), { double(OP_MOVE), x, y });
        m_cx = m_sx = x; m_cy = m_sy = y; m_hasCurrent = true;
    }
    virtual void AddLineToPoint(wxDouble x, wxDouble y) wxOVERRIDE
    {
        if ( !m_hasCurrent )
        {
            MoveToPoint(x, y);
            return;
        }
        m_ops.insert(m_ops.end(), { double(OP_LINE), x, y });
        m_cx = x; m_cy = y;
    }
    virtual void AddCurveToPoint(wxDouble cx1, wxDouble cy1, wxDouble cx2, wxDouble cy2, wxDouble x, wxDouble y) wxOVERRIDE
    {
        if ( !m_hasCurrent )
            MoveToPoint(cx1, cy1);
        m_ops.insert(m_ops.end(), { double(OP_CURVE), cx1, cy1, cx2, cy2, x, y });
        m_cx = x; m_cy = y;
    }
    virtual void AddPath(const wxGraphicsPathData* path) wxOVERRIDE
    {
        const wxWasmPathData* p = static_cast<const wxWasmPathData*>(path);
        m_ops.insert(m_ops.end(), p->m_ops.begin(), p->m_ops.end());
        if ( p->m_hasCurrent )
        {
            m_hasCurrent = true;
            m_cx = p->m_cx; m_cy = p->m_cy; m_sx = p->m_sx; m_sy = p->m_sy;
        }
    }
    virtual void CloseSubpath() wxOVERRIDE
    {
        if ( !m_hasCurrent )
            return;
        m_ops.push_back(OP_CLOSE);
        m_cx = m_sx; m_cy = m_sy;
    }
    virtual void GetCurrentPoint(wxDouble* x, wxDouble* y) const wxOVERRIDE
    {
        *x = m_hasCurrent ? m_cx : 0;
        *y = m_hasCurrent ? m_cy : 0;
    }

    // cairo_arc / cairo_arc_negative as wxCairoPathData::AddArc calls them: a line from the current point to
    // the arc's start, then the arc as Bezier segments of at most a quarter turn
    virtual void AddArc(wxDouble x, wxDouble y, wxDouble r, wxDouble startAngle, wxDouble endAngle, bool clockwise) wxOVERRIDE
    {
        if ( clockwise || (endAngle - startAngle) >= 2 * M_PI )
        {
            if ( endAngle < startAngle )
            {
                endAngle = fmod(endAngle - startAngle, 2 * M_PI);
                if ( endAngle < 0 )
                    endAngle += 2 * M_PI;
                endAngle += startAngle;
            }
        }
        else if ( endAngle > startAngle )
        {
            endAngle = fmod(endAngle - startAngle, 2 * M_PI);
            if ( endAngle > 0 )
                endAngle -= 2 * M_PI;
            endAngle += startAngle;
        }

        const double x0 = x + r * cos(startAngle), y0 = y + r * sin(startAngle);
        if ( m_hasCurrent )
            AddLineToPoint(x0, y0);
        else
            MoveToPoint(x0, y0);

        const double sweep = endAngle - startAngle;
        const int segments = int(ceil(fabs(sweep) / (M_PI / 2) - 1e-9));
        if ( segments <= 0 || r <= 0 )
            return;
        const double step = sweep / segments;
        const double k = 4.0 / 3.0 * tan(step / 4);
        double a0 = startAngle;
        for ( int i = 0; i < segments; ++i )
        {
            const double a1 = a0 + step;
            const double c0 = cos(a0), s0 = sin(a0), c1 = cos(a1), s1 = sin(a1);
            AddCurveToPoint(x + r * (c0 - k * s0), y + r * (s0 + k * c0),
                            x + r * (c1 + k * s1), y + r * (s1 - k * c1),
                            x + r * c1, y + r * s1);
            a0 = a1;
        }
    }

    virtual void* GetNativePath() const wxOVERRIDE { return const_cast<std::vector<double>*>(&m_ops); }
    virtual void UnGetNativePath(void*) const wxOVERRIDE {}

    virtual void Transform(const wxGraphicsMatrixData* matrix) wxOVERRIDE
    {
        const Affine& m = static_cast<const wxWasmMatrixData*>(matrix)->m_m;
        ForEachPoint([&m](double* x, double* y) { m.Apply(x, y); });
        if ( m_hasCurrent )
        {
            m.Apply(&m_cx, &m_cy);
            m.Apply(&m_sx, &m_sy);
        }
    }

    virtual void GetBox(wxDouble* x, wxDouble* y, wxDouble* w, wxDouble* h) const wxOVERRIDE
    {
        double x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        bool first = true;
        const_cast<wxWasmPathData*>(this)->ForEachPoint([&](double* px, double* py)
        {
            if ( first ) { x1 = x2 = *px; y1 = y2 = *py; first = false; return; }
            x1 = wxMin(x1, *px); x2 = wxMax(x2, *px);
            y1 = wxMin(y1, *py); y2 = wxMax(y2, *py);
        });
        if ( x ) *x = x1;
        if ( y ) *y = y1;
        if ( w ) *w = x2 - x1;
        if ( h ) *h = y2 - y1;
    }

    virtual bool Contains(wxDouble x, wxDouble y, wxPolygonFillMode fillStyle = wxODDEVEN_RULE) const wxOVERRIDE
    {
        return EM_ASM_INT({
            return wxgcPathContains($0, $1, $2, $3, $4);
        }, m_ops.data(), int(m_ops.size()), x, y, fillStyle == wxODDEVEN_RULE);
    }

    const double* Ops() const { return m_ops.data(); }
    int OpCount() const { return int(m_ops.size()); }

private:
    template <typename F> void ForEachPoint(F f)
    {
        for ( size_t i = 0; i < m_ops.size(); )
        {
            const int op = int(m_ops[i++]);
            const int points = op == OP_CURVE ? 3 : op == OP_CLOSE ? 0 : 1;
            for ( int p = 0; p < points; ++p, i += 2 )
                f(&m_ops[i], &m_ops[i + 1]);
        }
    }

    std::vector<double> m_ops;
    bool m_hasCurrent = false;
    double m_cx = 0, m_cy = 0, m_sx = 0, m_sy = 0;
};

// ----------------------------------------------------------------------------
// paints: a JavaScript description made once (graphics-context.js keeps it by id)
// ----------------------------------------------------------------------------

wxString ColourJson(const wxColour& c)
{
    return wxString::Format("[%d,%d,%d,%g]", c.Red(), c.Green(), c.Blue(), c.Alpha() / 255.0);
}

wxString GradientJson(wxGradientType type, double x1, double y1, double x2, double y2, double radius,
                      const wxGraphicsGradientStops& stops, const wxGraphicsMatrix& matrix)
{
    wxString s = wxString::Format("{\"gradient\":\"%s\",\"x1\":%.17g,\"y1\":%.17g,\"x2\":%.17g,\"y2\":%.17g,\"r\":%.17g,\"stops\":[",
                                  type == wxGRADIENT_RADIAL ? "radial" : "linear", x1, y1, x2, y2, radius);
    for ( size_t i = 0; i < stops.GetCount(); ++i )
    {
        if ( i )
            s += ",";
        s += wxString::Format("[%g,", stops.Item(i).GetPosition()) + ColourJson(stops.Item(i).GetColour()) + "]";
    }
    s += "]";
    if ( !matrix.IsNull() )
    {
        const Affine& m = AffineOf(matrix);
        s += wxString::Format(",\"m\":[%.17g,%.17g,%.17g,%.17g,%.17g,%.17g]", m.a, m.b, m.c, m.d, m.tx, m.ty);
    }
    return s + "}";
}

// A stipple bitmap as a repeating pattern: the bitmap is kept so its JavaScript copy lives as long as the paint.
wxString PatternJson(const wxBitmap& bitmap)
{
    bitmap.SyncToJs();
    return wxString::Format("{\"pattern\":%d}", bitmap.GetJavascriptId());
}

int MakeStyle(const wxString& json)
{
    return EM_ASM_INT({ return wxgcStyleCreate(UTF8ToString($0)); }, static_cast<const char*>(json.utf8_str()));
}

class wxWasmPenData : public wxGraphicsObjectRefData
{
public:
    wxWasmPenData(wxGraphicsRenderer* renderer, const wxGraphicsPenInfo& info)
        : wxGraphicsObjectRefData(renderer)
    {
        m_width = info.GetWidth();
        // wxCairoPenData: width 0 = one pixel; the dash lengths are Cairo's
        const double width = m_width <= 0 ? 1.0 : m_width;
        const double dashUnit = width < 1.0 ? 1.0 : width;
        std::vector<double> dashes;
        switch ( info.GetStyle() )
        {
            case wxPENSTYLE_DOT: dashes = { dashUnit, dashUnit + 2.0 }; break;
            case wxPENSTYLE_LONG_DASH: dashes = { 19.0, 9.0 }; break;
            case wxPENSTYLE_SHORT_DASH: dashes = { 9.0, 6.0 }; break;
            case wxPENSTYLE_DOT_DASH: dashes = { 9.0, 6.0, 3.0, 3.0 }; break;
            case wxPENSTYLE_USER_DASH:
            {
                wxDash* d;
                const int n = info.GetDashes(&d);
                for ( int i = 0; d && i < n; ++i )
                {
                    double l = d[i] * dashUnit;
                    if ( i % 2 == 1 && l < dashUnit + 2.0 )
                        l = dashUnit + 2.0;
                    else if ( i % 2 == 0 && l < dashUnit )
                        l = dashUnit;
                    dashes.push_back(l);
                }
                break;
            }
            default: break;
        }
        const char* join = info.GetJoin() == wxJOIN_BEVEL ? "bevel" : info.GetJoin() == wxJOIN_MITER ? "miter" : "round";
        const char* cap = info.GetCap() == wxCAP_BUTT ? "butt" : info.GetCap() == wxCAP_PROJECTING ? "square" : "round";

        wxString paint;
        if ( info.GetGradientType() != wxGRADIENT_NONE )
            paint = GradientJson(info.GetGradientType(), info.GetX1(), info.GetY1(), info.GetX2(), info.GetY2(),
                                 info.GetRadius(), info.GetStops(), info.GetMatrix());
        else if ( (info.GetStyle() == wxPENSTYLE_STIPPLE || info.GetStyle() == wxPENSTYLE_STIPPLE_MASK ||
                   info.GetStyle() == wxPENSTYLE_STIPPLE_MASK_OPAQUE) && info.GetStipple().IsOk() )
        {
            m_stipple = info.GetStipple();
            paint = PatternJson(m_stipple);
        }
        else
            paint = "{\"colour\":" + ColourJson(info.GetColour()) + "}";

        wxString d = "[";
        for ( size_t i = 0; i < dashes.size(); ++i )
            d += wxString::Format(i ? ",%g" : "%g", dashes[i]);
        d += "]";
        m_id = MakeStyle(wxString::Format("{\"width\":%.17g,\"join\":\"%s\",\"cap\":\"%s\",\"dashes\":%s,\"paint\":%s}",
                                          width, join, cap, d, paint));
    }
    virtual ~wxWasmPenData() { EM_ASM({ wxgcStyleDestroy($0); }, m_id); }

    double m_width;
    int m_id;
    wxBitmap m_stipple;
};

class wxWasmBrushData : public wxGraphicsObjectRefData
{
public:
    wxWasmBrushData(wxGraphicsRenderer* renderer, const wxString& paint, const wxBitmap& stipple = wxNullBitmap)
        : wxGraphicsObjectRefData(renderer), m_stipple(stipple)
    {
        m_id = MakeStyle("{\"paint\":" + paint + "}");
    }
    virtual ~wxWasmBrushData() { EM_ASM({ wxgcStyleDestroy($0); }, m_id); }

    int m_id;
    wxBitmap m_stipple;
};

class wxWasmFontData : public wxGraphicsObjectRefData
{
public:
    wxWasmFontData(wxGraphicsRenderer* renderer, const wxString& css, const wxColour& col, bool underlined, bool struckThrough)
        : wxGraphicsObjectRefData(renderer), m_css(css.utf8_str()), m_underlined(underlined), m_struckThrough(struckThrough)
    {
        m_colour = col.GetRGBA();
    }

    wxCharBuffer m_css;
    unsigned int m_colour;
    bool m_underlined, m_struckThrough;
};

class wxWasmBitmapData : public wxGraphicsBitmapData
{
public:
    wxWasmBitmapData(wxGraphicsRenderer* renderer, const wxBitmap& bitmap)
        : wxGraphicsBitmapData(renderer), m_bitmap(bitmap) {}

    virtual void* GetNativeBitmap() const wxOVERRIDE { return const_cast<wxBitmap*>(&m_bitmap); }

    wxBitmap m_bitmap;
};

// ----------------------------------------------------------------------------
// context
// ----------------------------------------------------------------------------

class wxWasmGraphicsContext : public wxGraphicsContext
{
public:
    // jsContext: the canvas context drawn on (a wxDC's), -1 for measuring only
    wxWasmGraphicsContext(wxGraphicsRenderer* renderer, int jsContext, double width, double height,
                          wxWindow* window = NULL)
        : wxGraphicsContext(renderer, window)
    {
        m_width = width;
        m_height = height;
        m_jsContext = jsContext;
        m_id = EM_ASM_INT({ return wxgcCreate($0); }, jsContext);
        SyncTransform();
    }

    virtual ~wxWasmGraphicsContext()
    {
        EM_ASM({ wxgcDestroy($0); }, m_id);
        delete m_ownedDC;
        if ( m_image )
        {
            EM_ASM({ destroyMemoryContext($0); }, m_jsContext);
            const bool hadAlpha = m_image->HasAlpha();
            *m_image = m_imageBitmap.ConvertToImage();
            if ( !hadAlpha && m_image->HasAlpha() )
                m_image->ClearAlpha();
        }
    }

    // the wxDC's own mapping (device origin, user and logical scale, logical origin), as Cairo's
    // ApplyTransformFromDC: an internal transform under the one the context's user sees
    void ApplyTransformFromDC(const wxDC& dc)
    {
        double sx, sy, lsx, lsy;
        dc.GetUserScale(&sx, &sy);
        dc.GetLogicalScale(&lsx, &lsy);
        sx *= lsx;
        sy *= lsy;
        const wxPoint org = dc.GetDeviceOrigin();
        const wxPoint lorg = dc.GetLogicalOrigin();
        m_internal = Affine::Translation(org.x, org.y).Then(Affine::Scaling(sx, sy)).Then(Affine::Translation(-lorg.x, -lorg.y));
        SyncTransform();
    }

    // a context on a window (wxGraphicsContext::Create(wxWindow*)) draws through a wxClientDC that lives as long
    void OwnDC(wxDC* dc) { m_ownedDC = dc; }
    void DrawToImage(wxImage* image, const wxBitmap& bitmap) { m_image = image; m_imageBitmap = bitmap; }

    virtual void PushState() wxOVERRIDE
    {
        m_states.push_back({ m_user, m_clipBoxes });
        EM_ASM({ wxgcPush($0); }, m_id);
    }
    virtual void PopState() wxOVERRIDE
    {
        if ( m_states.empty() )
            return;
        m_user = m_states.back().user;
        m_clipBoxes = m_states.back().clipBoxes;
        m_states.pop_back();
        EM_ASM({ wxgcPop($0); }, m_id);
        SyncTransform();
    }

    virtual void Clip(const wxRegion& region) wxOVERRIDE
    {
        wxGraphicsPath path = GetRenderer()->CreatePath();
        for ( wxRegionIterator ri(region); ri; ++ri )
            path.AddRectangle(ri.GetX(), ri.GetY(), ri.GetW(), ri.GetH());
        ClipPath(path);
    }
    virtual void Clip(wxDouble x, wxDouble y, wxDouble w, wxDouble h) wxOVERRIDE
    {
        wxGraphicsPath path = GetRenderer()->CreatePath();
        path.AddRectangle(x, y, w, h);
        ClipPath(path);
    }
    virtual void ResetClip() wxOVERRIDE
    {
        m_clipBoxes.clear();
        EM_ASM({ wxgcResetClip($0); }, m_id);
    }
    virtual void GetClipBox(wxDouble* x, wxDouble* y, wxDouble* w, wxDouble* h) wxOVERRIDE
    {
        // in the canvas' coordinates: the context's area, cut by every clip's box
        double x1 = 0, y1 = 0, x2 = m_width, y2 = m_height;
        for ( const ClipBox& b : m_clipBoxes )
        {
            x1 = wxMax(x1, b.x1); y1 = wxMax(y1, b.y1);
            x2 = wxMin(x2, b.x2); y2 = wxMin(y2, b.y2);
        }
        if ( x2 < x1 ) x2 = x1;
        if ( y2 < y1 ) y2 = y1;
        // back to the user's coordinates
        Affine inv = Effective();
        double bx1 = 0, by1 = 0, bx2 = 0, by2 = 0;
        if ( inv.Invert() )
        {
            const double cx[4] = { x1, x2, x1, x2 }, cy[4] = { y1, y1, y2, y2 };
            for ( int i = 0; i < 4; ++i )
            {
                double px = cx[i], py = cy[i];
                inv.Apply(&px, &py);
                if ( i == 0 ) { bx1 = bx2 = px; by1 = by2 = py; continue; }
                bx1 = wxMin(bx1, px); bx2 = wxMax(bx2, px);
                by1 = wxMin(by1, py); by2 = wxMax(by2, py);
            }
        }
        if ( x ) *x = bx1;
        if ( y ) *y = by1;
        if ( w ) *w = bx2 - bx1;
        if ( h ) *h = by2 - by1;
    }

    virtual void* GetNativeContext() wxOVERRIDE { return reinterpret_cast<void*>(intptr_t(m_jsContext)); }

    // the canvas antialiases every path; it cannot be switched off
    virtual bool SetAntialiasMode(wxAntialiasMode antialias) wxOVERRIDE
    {
        if ( antialias == wxANTIALIAS_NONE )
            return false;
        m_antialias = antialias;
        return true;
    }
    virtual bool SetInterpolationQuality(wxInterpolationQuality interpolation) wxOVERRIDE
    {
        static const char* const quality[] = { "", "low", "low", "medium", "high" };
        const int q = interpolation == wxINTERPOLATION_DEFAULT ? 2 : int(interpolation);
        if ( q < 1 || q > 4 )
            return false;
        m_interpolation = interpolation;
        EM_ASM({ wxgcSetSmoothing($0, UTF8ToString($1)); }, m_id, interpolation == wxINTERPOLATION_NONE ? "none" : quality[q]);
        return true;
    }
    virtual bool SetCompositionMode(wxCompositionMode op) wxOVERRIDE
    {
        const char* mode;
        switch ( op )
        {
            case wxCOMPOSITION_CLEAR: mode = "clear"; break;
            case wxCOMPOSITION_SOURCE: mode = "copy"; break;
            case wxCOMPOSITION_OVER: mode = "source-over"; break;
            case wxCOMPOSITION_IN: mode = "source-in"; break;
            case wxCOMPOSITION_OUT: mode = "source-out"; break;
            case wxCOMPOSITION_ATOP: mode = "source-atop"; break;
            case wxCOMPOSITION_DEST: mode = "dest"; break;
            case wxCOMPOSITION_DEST_OVER: mode = "destination-over"; break;
            case wxCOMPOSITION_DEST_IN: mode = "destination-in"; break;
            case wxCOMPOSITION_DEST_OUT: mode = "destination-out"; break;
            case wxCOMPOSITION_DEST_ATOP: mode = "destination-atop"; break;
            case wxCOMPOSITION_XOR: mode = "xor"; break;
            case wxCOMPOSITION_ADD: mode = "lighter"; break;
            default: return false;
        }
        m_composition = op;
        EM_ASM({ wxgcSetComposition($0, UTF8ToString($1)); }, m_id, mode);
        return true;
    }

    virtual void BeginLayer(wxDouble opacity) wxOVERRIDE { EM_ASM({ wxgcBeginLayer($0, $1); }, m_id, opacity); }
    virtual void EndLayer() wxOVERRIDE { EM_ASM({ wxgcEndLayer($0); }, m_id); }

    virtual void Translate(wxDouble dx, wxDouble dy) wxOVERRIDE { m_user = m_user.Then(Affine::Translation(dx, dy)); SyncTransform(); }
    virtual void Scale(wxDouble xScale, wxDouble yScale) wxOVERRIDE { m_user = m_user.Then(Affine::Scaling(xScale, yScale)); SyncTransform(); }
    virtual void Rotate(wxDouble angle) wxOVERRIDE { m_user = m_user.Then(Affine::Rotation(angle)); SyncTransform(); }
    virtual void ConcatTransform(const wxGraphicsMatrix& matrix) wxOVERRIDE { m_user = m_user.Then(AffineOf(matrix)); SyncTransform(); }
    virtual void SetTransform(const wxGraphicsMatrix& matrix) wxOVERRIDE { m_user = AffineOf(matrix); SyncTransform(); }
    virtual wxGraphicsMatrix GetTransform() const wxOVERRIDE
    {
        wxGraphicsMatrix m;
        m.SetRefData(new wxWasmMatrixData(GetRenderer(), m_user));
        return m;
    }

    virtual void StrokePath(const wxGraphicsPath& path) wxOVERRIDE
    {
        if ( m_pen.IsNull() )
            return;
        const wxWasmPathData* p = static_cast<const wxWasmPathData*>(path.GetRefData());
        EM_ASM({ wxgcStroke($0, $1, $2, $3, $4); }, m_id, p->Ops(), p->OpCount(),
               static_cast<wxWasmPenData*>(m_pen.GetRefData())->m_id, ShouldOffset());
    }
    virtual void FillPath(const wxGraphicsPath& path, wxPolygonFillMode fillStyle = wxODDEVEN_RULE) wxOVERRIDE
    {
        if ( m_brush.IsNull() )
            return;
        const wxWasmPathData* p = static_cast<const wxWasmPathData*>(path.GetRefData());
        EM_ASM({ wxgcFill($0, $1, $2, $3, $4); }, m_id, p->Ops(), p->OpCount(),
               static_cast<wxWasmBrushData*>(m_brush.GetRefData())->m_id, fillStyle == wxODDEVEN_RULE);
    }

    // Cairo's: an odd pen width on a pixel grid draws on pixel centres
    virtual bool ShouldOffset() const wxOVERRIDE
    {
        if ( !m_enableOffset || m_pen.IsNull() )
            return false;
        int width = int(static_cast<wxWasmPenData*>(m_pen.GetRefData())->m_width);
        if ( width == 0 )
            width = 1;
        return width % 2 == 1;
    }

    virtual void GetTextExtent(const wxString& str, wxDouble* width, wxDouble* height,
                               wxDouble* descent = NULL, wxDouble* externalLeading = NULL) const wxOVERRIDE
    {
        if ( width ) *width = 0;
        if ( height ) *height = 0;
        if ( descent ) *descent = 0;
        if ( externalLeading ) *externalLeading = 0;
        wxCHECK_RET(!m_font.IsNull(), wxT("wxWasmGraphicsContext::GetTextExtent - no valid font set"));

        double m[3];
        EM_ASM({ wxgcMeasure(UTF8ToString($0), UTF8ToString($1), $2); },
               static_cast<const char*>(str.utf8_str()), Font()->m_css.data(), m);
        if ( width ) *width = m[0];
        if ( height ) *height = m[1] + m[2];
        if ( descent ) *descent = m[2];
    }

    virtual void GetPartialTextExtents(const wxString& text, wxArrayDouble& widths) const wxOVERRIDE
    {
        widths.clear();
        wxCHECK_RET(!m_font.IsNull(), wxT("wxWasmGraphicsContext::GetPartialTextExtents - no valid font set"));
        const size_t n = text.length();
        if ( !n )
            return;
        std::vector<double> w(n);
        EM_ASM({ wxgcPartialExtents(UTF8ToString($0), UTF8ToString($1), $2, $3); },
               static_cast<const char*>(text.utf8_str()), Font()->m_css.data(), w.data(), int(n));
        widths.assign(w.begin(), w.end());
    }

    virtual void DrawBitmap(const wxGraphicsBitmap& bmp, wxDouble x, wxDouble y, wxDouble w, wxDouble h) wxOVERRIDE
    {
        if ( bmp.IsNull() )
            return;
        DrawBitmap(static_cast<const wxWasmBitmapData*>(bmp.GetRefData())->m_bitmap, x, y, w, h);
    }
    virtual void DrawBitmap(const wxBitmap& bmp, wxDouble x, wxDouble y, wxDouble w, wxDouble h) wxOVERRIDE
    {
        if ( !bmp.IsOk() || bmp.GetWidth() <= 0 || bmp.GetHeight() <= 0 )
            return;   // an empty bitmap draws nothing (the browser's ImageData throws on it)
        bmp.SyncToJs();
        EM_ASM({ wxgcDrawBitmap($0, $1, $2, $3, $4, $5); }, m_id, bmp.GetJavascriptId(), x, y, w, h);
    }
    virtual void DrawIcon(const wxIcon& icon, wxDouble x, wxDouble y, wxDouble w, wxDouble h) wxOVERRIDE
    {
        DrawBitmap(wxBitmap(icon), x, y, w, h);
    }

protected:
    virtual void DoDrawText(const wxString& str, wxDouble x, wxDouble y) wxOVERRIDE
    {
        wxCHECK_RET(!m_font.IsNull(), wxT("wxWasmGraphicsContext::DrawText - no valid font set"));
        if ( str.empty() )
            return;
        const wxWasmFontData* f = Font();
        EM_ASM({ wxgcDrawText($0, UTF8ToString($1), $2, $3, UTF8ToString($4), $5, $6, $7); },
               m_id, static_cast<const char*>(str.utf8_str()), x, y, f->m_css.data(), f->m_colour,
               f->m_underlined, f->m_struckThrough);
    }

private:
    struct ClipBox { double x1, y1, x2, y2; };
    struct State { Affine user; std::vector<ClipBox> clipBoxes; };

    const wxWasmFontData* Font() const { return static_cast<const wxWasmFontData*>(m_font.GetRefData()); }
    Affine Effective() const { return m_internal.Then(m_user); }

    void SyncTransform()
    {
        const Affine m = Effective();
        EM_ASM({ wxgcSetTransform($0, $1, $2, $3, $4, $5, $6); }, m_id, m.a, m.b, m.c, m.d, m.tx, m.ty);
    }

    void ClipPath(const wxGraphicsPath& path)
    {
        const wxWasmPathData* p = static_cast<const wxWasmPathData*>(path.GetRefData());
        // the clip's box in the canvas' coordinates, for GetClipBox
        wxGraphicsPath box = path;
        box.UnShare();
        wxGraphicsMatrix m;
        m.SetRefData(new wxWasmMatrixData(GetRenderer(), Effective()));
        box.Transform(m);
        wxDouble bx, by, bw, bh;
        box.GetBox(&bx, &by, &bw, &bh);
        m_clipBoxes.push_back({ bx, by, bx + bw, by + bh });
        EM_ASM({ wxgcClip($0, $1, $2); }, m_id, p->Ops(), p->OpCount());
    }

    int m_id;
    int m_jsContext;
    Affine m_internal, m_user;
    std::vector<ClipBox> m_clipBoxes;
    std::vector<State> m_states;
    wxDC* m_ownedDC = NULL;
    wxImage* m_image = NULL;
    wxBitmap m_imageBitmap;
};

int JsContextOf(const wxDC& dc)
{
    wxWasmDCImpl* impl = wxDynamicCast(const_cast<wxDC&>(dc).GetImpl(), wxWasmDCImpl);
    return impl && impl->IsOk() ? impl->GetJavascriptId() : -1;
}

} // anonymous namespace

// ----------------------------------------------------------------------------
// renderer
// ----------------------------------------------------------------------------

class wxWasmGraphicsRenderer : public wxGraphicsRenderer
{
public:
    wxWasmGraphicsRenderer() {}

    virtual wxGraphicsContext* CreateContext(const wxWindowDC& dc) wxOVERRIDE { return FromDC(dc); }
    virtual wxGraphicsContext* CreateContext(const wxMemoryDC& dc) wxOVERRIDE { return FromDC(dc); }
#if wxUSE_PRINTING_ARCHITECTURE
    virtual wxGraphicsContext* CreateContext(const wxPrinterDC&) wxOVERRIDE { return NULL; }
#endif

    virtual wxGraphicsContext* CreateContextFromNativeContext(void* context) wxOVERRIDE
    {
        return new wxWasmGraphicsContext(this, int(reinterpret_cast<intptr_t>(context)), 0, 0);
    }
    virtual wxGraphicsContext* CreateContextFromNativeWindow(void*) wxOVERRIDE { return NULL; }

#if wxUSE_IMAGE
    // drawn on a copy of the image as a bitmap, written back to the image when the context goes
    virtual wxGraphicsContext* CreateContextFromImage(wxImage& image) wxOVERRIDE
    {
        wxBitmap bitmap(image, 32);
        bitmap.SyncToJs();
        const int js = EM_ASM_INT({ return createMemoryContext($0, 1); }, bitmap.GetJavascriptId());
        wxWasmGraphicsContext* gc = new wxWasmGraphicsContext(this, js, image.GetWidth(), image.GetHeight());
        gc->DrawToImage(&image, bitmap);
        return gc;
    }
#endif

    // the window's client area, as a wxClientDC draws it
    virtual wxGraphicsContext* CreateContext(wxWindow* window) wxOVERRIDE
    {
        wxClientDC* dc = new wxClientDC(window);
        wxWasmGraphicsContext* gc = static_cast<wxWasmGraphicsContext*>(FromDC(*dc));
        if ( !gc )
        {
            delete dc;
            return NULL;
        }
        gc->OwnDC(dc);
        return gc;
    }

    virtual wxGraphicsContext* CreateMeasuringContext() wxOVERRIDE
    {
        return new wxWasmGraphicsContext(this, -1, 0, 0);
    }

    virtual wxGraphicsPath CreatePath() wxOVERRIDE
    {
        wxGraphicsPath p;
        p.SetRefData(new wxWasmPathData(this));
        return p;
    }

    virtual wxGraphicsMatrix CreateMatrix(wxDouble a = 1.0, wxDouble b = 0.0, wxDouble c = 0.0, wxDouble d = 1.0,
                                          wxDouble tx = 0.0, wxDouble ty = 0.0) wxOVERRIDE
    {
        wxWasmMatrixData* m = new wxWasmMatrixData(this);
        m->Set(a, b, c, d, tx, ty);
        wxGraphicsMatrix matrix;
        matrix.SetRefData(m);
        return matrix;
    }

    virtual wxGraphicsPen CreatePen(const wxGraphicsPenInfo& info) wxOVERRIDE
    {
        wxGraphicsPen p;
        if ( info.GetStyle() != wxPENSTYLE_TRANSPARENT )
            p.SetRefData(new wxWasmPenData(this, info));
        return p;
    }

    virtual wxGraphicsBrush CreateBrush(const wxBrush& brush) wxOVERRIDE
    {
        wxGraphicsBrush b;
        if ( !brush.IsOk() || brush.GetStyle() == wxBRUSHSTYLE_TRANSPARENT )
            return b;
        if ( brush.IsHatch() == false && brush.GetStipple() && brush.GetStipple()->IsOk() &&
             (brush.GetStyle() == wxBRUSHSTYLE_STIPPLE || brush.GetStyle() == wxBRUSHSTYLE_STIPPLE_MASK ||
              brush.GetStyle() == wxBRUSHSTYLE_STIPPLE_MASK_OPAQUE) )
        {
            const wxBitmap stipple = *brush.GetStipple();
            b.SetRefData(new wxWasmBrushData(this, PatternJson(stipple), stipple));
        }
        else
            b.SetRefData(new wxWasmBrushData(this, "{\"colour\":" + ColourJson(brush.GetColour()) + "}"));
        return b;
    }

    virtual wxGraphicsBrush CreateLinearGradientBrush(wxDouble x1, wxDouble y1, wxDouble x2, wxDouble y2,
                                                      const wxGraphicsGradientStops& stops,
                                                      const wxGraphicsMatrix& matrix = wxNullGraphicsMatrix) wxOVERRIDE
    {
        wxGraphicsBrush b;
        b.SetRefData(new wxWasmBrushData(this, GradientJson(wxGRADIENT_LINEAR, x1, y1, x2, y2, 0, stops, matrix)));
        return b;
    }

    virtual wxGraphicsBrush CreateRadialGradientBrush(wxDouble startX, wxDouble startY, wxDouble endX, wxDouble endY,
                                                      wxDouble radius, const wxGraphicsGradientStops& stops,
                                                      const wxGraphicsMatrix& matrix = wxNullGraphicsMatrix) wxOVERRIDE
    {
        wxGraphicsBrush b;
        b.SetRefData(new wxWasmBrushData(this, GradientJson(wxGRADIENT_RADIAL, startX, startY, endX, endY, radius, stops, matrix)));
        return b;
    }

    // the port's own CSS font string (wxNativeFontInfo::ToString), as its wxDC uses
    virtual wxGraphicsFont CreateFont(const wxFont& font, const wxColour& col = *wxBLACK) wxOVERRIDE
    {
        wxGraphicsFont f;
        if ( font.IsOk() )
            f.SetRefData(new wxWasmFontData(this, font.GetNativeFontInfoDesc(), col, font.GetUnderlined(), font.GetStrikethrough()));
        return f;
    }
    virtual wxGraphicsFont CreateFont(double sizeInPixels, const wxString& facename, int flags = wxFONTFLAG_DEFAULT,
                                      const wxColour& col = *wxBLACK) wxOVERRIDE
    {
        wxString css;
        if ( flags & wxFONTFLAG_ITALIC )
            css += "italic ";
        if ( flags & wxFONTFLAG_BOLD )
            css += "bold ";
        css += wxString::Format("%gpx ", sizeInPixels);
        css += facename.empty() ? wxString("\"Noto Sans\", sans-serif") : "\"" + facename + "\", \"Noto Sans\", sans-serif";   // the system font (n-system-font)
        wxGraphicsFont f;
        f.SetRefData(new wxWasmFontData(this, css, col, (flags & wxFONTFLAG_UNDERLINED) != 0, (flags & wxFONTFLAG_STRIKETHROUGH) != 0));
        return f;
    }
    // the canvas works in CSS pixels at 96 per inch, as the port's wxDC
    virtual wxGraphicsFont CreateFontAtDPI(const wxFont& font, const wxRealPoint&, const wxColour& col) wxOVERRIDE
    {
        return CreateFont(font, col);
    }

    virtual wxGraphicsBitmap CreateBitmap(const wxBitmap& bitmap) wxOVERRIDE
    {
        wxGraphicsBitmap b;
        if ( bitmap.IsOk() )
            b.SetRefData(new wxWasmBitmapData(this, bitmap));
        return b;
    }
#if wxUSE_IMAGE
    virtual wxGraphicsBitmap CreateBitmapFromImage(const wxImage& image) wxOVERRIDE
    {
        return CreateBitmap(wxBitmap(image));
    }
    virtual wxImage CreateImageFromBitmap(const wxGraphicsBitmap& bmp) wxOVERRIDE
    {
        if ( bmp.IsNull() )
            return wxNullImage;
        return static_cast<const wxWasmBitmapData*>(bmp.GetRefData())->m_bitmap.ConvertToImage();
    }
#endif
    virtual wxGraphicsBitmap CreateBitmapFromNativeBitmap(void* bitmap) wxOVERRIDE
    {
        return bitmap ? CreateBitmap(*static_cast<wxBitmap*>(bitmap)) : wxNullGraphicsBitmap;
    }
    virtual wxGraphicsBitmap CreateSubBitmap(const wxGraphicsBitmap& bitmap, wxDouble x, wxDouble y, wxDouble w, wxDouble h) wxOVERRIDE
    {
        if ( bitmap.IsNull() )
            return wxNullGraphicsBitmap;
        return CreateBitmap(static_cast<const wxWasmBitmapData*>(bitmap.GetRefData())->m_bitmap.GetSubBitmap(
            wxRect(int(x), int(y), int(w), int(h))));
    }

    virtual wxString GetName() const wxOVERRIDE { return "canvas2d"; }
    virtual void GetVersion(int* major, int* minor = NULL, int* micro = NULL) const wxOVERRIDE
    {
        if ( major ) *major = 1;
        if ( minor ) *minor = 0;
        if ( micro ) *micro = 0;
    }

private:
    wxGraphicsContext* FromDC(const wxDC& dc)
    {
        const int js = JsContextOf(dc);
        if ( js < 0 )
            return NULL;
        const wxSize size = dc.GetSize();
        wxWasmGraphicsContext* gc = new wxWasmGraphicsContext(this, js, size.x, size.y, dc.GetWindow());
        gc->SetContentScaleFactor(dc.GetContentScaleFactor());
        gc->ApplyTransformFromDC(dc);
        gc->EnableOffset();
        return gc;
    }

    wxDECLARE_DYNAMIC_CLASS_NO_COPY(wxWasmGraphicsRenderer);
};

wxIMPLEMENT_DYNAMIC_CLASS(wxWasmGraphicsRenderer, wxGraphicsRenderer);

static wxWasmGraphicsRenderer gs_wasmGraphicsRenderer;

wxGraphicsRenderer* wxGraphicsRenderer::GetDefaultRenderer()
{
    return &gs_wasmGraphicsRenderer;
}

#endif // wxUSE_GRAPHICS_CONTEXT
