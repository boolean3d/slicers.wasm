# Partial text extents (the width of each prefix of a string) measured by the browser itself, as wxGTK asks Pango
# for each character's position. The generic version adds up each letter's width measured alone and rounded to a
# whole pixel; with the port's proportional fonts that sum came out up to ~2% short of the real line width.
# wxTextWrapper (wxStaticText::Wrap) breaks lines by these widths, so a line it thought fit was wider than the wrap
# width and the label was clipped: PrusaSlicer's setup wizard "...helps you with the initi" (line 509 px, wrap 500).
# Also used by DC ellipsizing and text controls. Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/generic/textmeasure.cpp', '''#include "wx/private/textmeasure.h"

#if wxUSE_GENERIC_TEXTMEASURE
''', '''#include "wx/private/textmeasure.h"

#ifdef __WXWASM__
    #include <emscripten.h>
#endif

#if wxUSE_GENERIC_TEXTMEASURE
''')
sub('src/generic/textmeasure.cpp', '''                                            double scaleX)
{
    return wxTextMeasureBase::DoGetPartialTextExtents(text, widths, scaleX);''', '''                                            double scaleX)
{
#ifdef __WXWASM__
    // every prefix measured whole by the browser (wx.js measureText's canvas), rounded like GetTextExtent
    const wxFont font = GetFont();
    if ( font.IsOk() && !text.empty() && widths.size() >= text.length() )
    {
        const wxScopedCharBuffer f = font.GetNativeFontInfoDesc().utf8_str();
        const wxScopedCharBuffer t = text.utf8_str();
        EM_ASM({
            offscreenContext.font = UTF8ToString($1);
            var chars = Array.from(UTF8ToString($0)); var s = "";
            for (var i = 0; i < chars.length && i < $3; i++) {
                s += chars[i];
                HEAP32[($2 >> 2) + i] = Math.round(offscreenContext.measureText(s).width * $4);
            }
        }, t.data(), f.data(), &widths[0], (int)text.length(), scaleX);
        return true;
    }
#endif
    return wxTextMeasureBase::DoGetPartialTextExtents(text, widths, scaleX);''')
