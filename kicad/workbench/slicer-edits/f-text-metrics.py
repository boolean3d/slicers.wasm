# Text is measured the way wxGTK measures it (Pango): the font's own ascent and descent, not a guess.
# - wxFont::GetTextExtent gave every font a height of 1.6 x its point size and no descent, and wxDC::DrawText put the
#   baseline at 5/6 of that height. Every text height (labels, list rows, menu rows) and every baseline was off by a
#   few pixels against the desktop app. Now: height = the font's ascent + descent (canvas fontBoundingBox, the same
#   hhea/OS2 numbers Pango uses), descent reported, baseline at the ascent. Per-font numbers are cached in the page.
#   wxGraphicsContext (slicer-wx/wxgc) already measured this way; both now agree.
# - (an 11 pt system font was set here; wrong, undone by p-system-font-size.py)
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

F = 'src/wasm/font.cpp'
# utf8_str() returns a temporary buffer: keep it alive while the pointer is used (it dangled before)
sub(F, '''    wxString fontInfoDesc = m_nativeFontInfo.ToString();
    const char *fontString = fontInfoDesc.utf8_str();

    const char *s = string.utf8_str();
''', '''    wxString fontInfoDesc = m_nativeFontInfo.ToString();
    const wxScopedCharBuffer fontBuf = fontInfoDesc.utf8_str();
    const char *fontString = fontBuf.data();

    const wxScopedCharBuffer textBuf = string.utf8_str();
    const char *s = textBuf.data();
''')
sub(F, '''    if (y != NULL)
    {
        *y = static_cast<int>(round(1.6 * m_nativeFontInfo.GetFractionalPointSize()));
    }

    if (descent != NULL)
    {
        *descent = 0;
    }
''', '''    // the font's ascent and descent (Pango's logical height), cached per font in the page
    double ascent = 0, desc = 0;
    if (y != NULL || descent != NULL)
    {
        ascent = EM_ASM_DOUBLE({ return wxFontMetric(UTF8ToString($0), 0); }, fontString);
        desc = EM_ASM_DOUBLE({ return wxFontMetric(UTF8ToString($0), 1); }, fontString);
    }

    if (y != NULL)
    {
        *y = static_cast<int>(ceil(ascent) + ceil(desc));
    }

    if (descent != NULL)
    {
        *descent = static_cast<int>(ceil(desc));
    }
''')

sub('src/wasm/dc.cpp', '''    wxCoord textY = devY + textHeight * (5.0 / 6.0);
''', '''    // the baseline sits at the font's ascent (height - descent), as Pango draws it
    wxCoord textDescent = 0;
    DoGetTextExtent(text, NULL, NULL, &textDescent);
    wxCoord textY = devY + LogicalToDeviceYRel(textHeight - textDescent);
''')

# (system font size: see p-system-font-size.py; 11 pt here was wrong)

sub('build/wasm/wx.js', '''  var measureText = function (text, font) {''', '''  // a font's ascent (which 0) or descent (which 1) in CSS pixels: the font's own line box, not the text's ink
  var fontMetricCache = new Map();
  var wxFontMetric = function (font, which) {
    var m = fontMetricCache.get(font);
    if (m === undefined) {
      offscreenContext.font = font;
      var t = offscreenContext.measureText('Mg');
      m = [t.fontBoundingBoxAscent !== undefined ? t.fontBoundingBoxAscent : t.actualBoundingBoxAscent,
           t.fontBoundingBoxDescent !== undefined ? t.fontBoundingBoxDescent : t.actualBoundingBoxDescent];
      fontMetricCache.set(font, m);
    }
    return m[which];
  };

  var measureText = function (text, font) {''')

# DoDrawText kept dangling pointers to temporary utf8 buffers too
sub('src/wasm/dc.cpp', '''        wxString fontInfoDesc = m_font.GetNativeFontInfoDesc();
        const char *fontString = fontInfoDesc.utf8_str();

        // TODO: set underline''', '''        wxString fontInfoDesc = m_font.GetNativeFontInfoDesc();
        const wxScopedCharBuffer fontBuf = fontInfoDesc.utf8_str();
        const char *fontString = fontBuf.data();

        // TODO: set underline''')
sub('src/wasm/dc.cpp', '''    const char *s = text.utf8_str();

    wxCoord devX = LogicalToDeviceDoubleX(x);''', '''    const wxScopedCharBuffer textBuf = text.utf8_str();
    const char *s = textBuf.data();

    wxCoord devX = LogicalToDeviceDoubleX(x);''')
