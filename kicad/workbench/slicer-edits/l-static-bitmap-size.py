# wxStaticBitmap::SetBitmap with a bitmap of a new size re-fits the control to it, as wxGTK does
# (src/gtk/statbmp.cpp: InvalidateBestSize + SetSize(GetBestSize())). wxUniv only stored the bitmap, so a static
# bitmap made empty and given its picture later kept its first tiny size and the picture was squeezed into it:
# Bambu Studio's plate picture on the printer card (made with wxNullBitmap, then update_bed_thumbnail) drew 27x16
# instead of its 48 px high plate.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

# wx 3.2 (prusa's tree) already does it: SetBitmap(const wxBitmapBundle&) re-fits the control
if 'InvalidateBestSize();' in open('src/univ/statbmp.cpp').read().split('void wxStaticBitmap::SetBitmap(', 1)[1][:200]:
    raise SystemExit(0)
sub('src/univ/statbmp.cpp', '''void wxStaticBitmap::SetBitmap(const wxBitmap& bitmap)
{
    m_bitmap = bitmap;
}''', '''void wxStaticBitmap::SetBitmap(const wxBitmap& bitmap)
{
    const wxSize sizeOld(m_bitmap.IsOk() ? m_bitmap.GetSize() : wxSize());
    const wxSize sizeNew(bitmap.IsOk() ? bitmap.GetSize() : wxSize());

    m_bitmap = bitmap;

    // as wxGTK: a picture of another size re-fits the control (Create sets the initial size itself afterwards)
    if ( sizeNew != sizeOld )
    {
        InvalidateBestSize();
        SetSize(GetBestSize());
    }
    Refresh();
}''')
