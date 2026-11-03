# wxBitmap::SetScaleFactor in the wasm port, as wxGTK3 (src/gtk/bitmap.cpp) and wxOSX: the pixels stay, the bitmap now
# covers (pixels / scale) logical pixels and is drawn that size. wx 3.2's wxBitmapBundle::GetBitmap (bmpbndl.cpp) makes a
# bitmap of size x GetDPIScaleFactor() pixels and calls SetScaleFactor so it takes its default room; the port had only
# wxBitmapBase's empty one, so at display scale 1.5/2 (content scale 2) every bundle bitmap drew twice as big:
# PrusaSlicer's preset combo icons covered their names ("m BALANCED", "ment PLA"), mode dot, search icon.
# Port semantics kept: GetWidth/GetHeight = logical, data = logical x scale. Run in owx or pwx;
# only wx 3.2 (pwx, Prusa) declares SetScaleFactor in wxBitmapBase, so the code is under wxCHECK_VERSION(3,2,0).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('include/wx/wasm/bitmap.h', '''    virtual double GetScaleFactor() const;
''', '''    virtual double GetScaleFactor() const;
#if wxCHECK_VERSION(3, 2, 0)
    virtual void SetScaleFactor(double scale) wxOVERRIDE;
#endif
''')

sub('src/wasm/bitmap.cpp', '''double wxBitmap::GetScaledWidth() const
{''', '''#if wxCHECK_VERSION(3, 2, 0)
// as wxGTK3/wxOSX: same pixels, drawn at (pixels / scale) logical size
void wxBitmap::SetScaleFactor(double scale)
{
    wxCHECK_RET(IsOk(), wxT("invalid bitmap"));
    if ( scale <= 0 || M_BITMAPDATA->m_scaleFactor == scale )
        return;

    AllocExclusive();

    wxBitmapRefData* const data = M_BITMAPDATA;
    data->m_scaleFactor = scale;
    data->m_width = wxRound(data->m_dataWidth / scale);
    data->m_height = wxRound(data->m_dataHeight / scale);
    if ( data->m_jsId != -1 )
    {
        EM_ASM({
            var bitmap = bitmapMap.get($0);
            if (bitmap) bitmap.scaleFactor = $1;
        }, data->m_jsId, scale);
    }
}
#endif

double wxBitmap::GetScaledWidth() const
{''')
