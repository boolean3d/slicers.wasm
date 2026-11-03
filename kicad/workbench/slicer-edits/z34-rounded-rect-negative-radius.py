# wxDC::DrawRoundedRectangle takes a negative radius as a fraction of the smaller side (wx/dc.h; wxMSW src/msw/dc.cpp and
# wxGTK src/gtk/dcclient.cpp both do radius = -radius * min(width, height)) and 0 as a plain rectangle. The wasm port
# handed the number to the canvas as it was: arcTo threw "The radius provided (-0.25) is negative" and the worker
# died. KiCad's PCB editor draws its layer boxes that way. Run in owx or pwx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/dc.cpp', '''        double radius)
{
    wxCHECK_RET(IsOk(), wxT("invalid dc"));

    EM_ASM({
        drawRoundedRect($0, $1, $2, $3, $4, $5, $6, $7);''', '''        double radius)
{
    wxCHECK_RET(IsOk(), wxT("invalid dc"));

    // z34: a negative radius is a fraction of the smaller side, 0 a plain rectangle (as wxMSW and wxGTK)
    if (radius < 0.0)
        radius = -radius * ((width < height) ? width : height);
    if (radius == 0.0)
    {
        DoDrawRectangle(x, y, width, height);
        return;
    }

    EM_ASM({
        drawRoundedRect($0, $1, $2, $3, $4, $5, $6, $7);''')
print("z34 ok")
