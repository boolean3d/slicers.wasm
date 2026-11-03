# An empty pen or brush draws nothing, as on wxGTK. The port's wxPen() and wxBrush() made a black 1 px pen / black
# brush, so wxNullPen and wxNullBrush (both default-built, src/common/gdicmn.cpp) were real black ones: every
# dc.SetPen(wxNullPen) left a black outline. Bambu's Slice plate / Print plate buttons (SideButton::dorender fills its
# pieces with wxNullPen) showed dark 2 px seams; any program code that clears the pen this way did the same.
# Now they hold no data (IsOk() false), as wxGTK's wxPen() {} / wxBrush() {}; the DC sends no colour for them and
# draws no stroke / no fill (the draw calls already test IsOk() && IsNonTransparent()), and Clear() with no background
# brush does nothing, as wxGCDCImpl::Clear.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('include/wx/wasm/pen.h', '''    wxPen() : wxPen(*wxBLACK) { }''', '''    wxPen() { }''')
sub('include/wx/wasm/brush.h', '''    wxBrush() : wxBrush(*wxBLACK) { }''', '''    wxBrush() { }''')

D = 'src/wasm/dc.cpp'
sub(D, '''    if (pen != m_pen)
    {
        m_pen = pen;

        int bitmapId = -1;''', '''    if (pen != m_pen)
    {
        m_pen = pen;

        // an empty pen draws nothing (the draw calls test IsOk)
        if (!m_pen.IsOk())
            return;

        int bitmapId = -1;''')
sub(D, '''    m_brush = brush;

    int bitmapId = -1;''', '''    m_brush = brush;

    // an empty brush fills nothing (the draw calls test IsOk)
    if (!m_brush.IsOk())
        return;

    int bitmapId = -1;''')
sub(D, '''    wxCHECK_RET(IsOk(), wxT("invalid dc"));

    wxSize size = GetSize();

    EM_ASM({
        clearRect(''', '''    wxCHECK_RET(IsOk(), wxT("invalid dc"));

    // no background brush: nothing to clear with (wxGCDCImpl::Clear)
    if (!m_backgroundBrush.IsOk())
        return;

    wxSize size = GetSize();

    EM_ASM({
        clearRect(''')
