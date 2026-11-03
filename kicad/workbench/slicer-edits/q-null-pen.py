# No pen means no outline, no brush means no fill, as on wxGTK 3 (wxGCDC: SetPen(wxNullPen) gives a null graphics
# pen, nothing is stroked). The wasm wxDC asked wxPen::IsNonTransparent(), which is true for an invalid pen
# (GetStyle() returns wxPENSTYLE_INVALID), so wxNullPen stroked with an invalid = black colour. Bambu's Slice plate /
# Print plate buttons (SideButton::dorender sets wxNullPen before its fills) came out with black frames and bars.
# Run in owx.
P = 'src/wasm/dc.cpp'
s = open(P).read()
if 'm_pen.IsOk() && m_pen.IsNonTransparent()' not in s:
    assert s.count('m_pen.IsNonTransparent()') >= 1 and s.count('m_brush.IsNonTransparent()') >= 1
    s = s.replace('m_pen.IsNonTransparent()', '(m_pen.IsOk() && m_pen.IsNonTransparent())')
    s = s.replace('m_brush.IsNonTransparent()', '(m_brush.IsOk() && m_brush.IsNonTransparent())')
    open(P, 'w').write(s)
