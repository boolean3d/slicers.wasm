# One wheel notch = what the desktop gives: wheel rotation 120 per notch (WHEEL_DELTA), delta 120, 3 lines per
# action (wxMSW SPI_GETWHEELSCROLLLINES default, wxGTK 3). The browser reports a notch as 100 pixels (Chrome,
# deltaMode PIXEL), 3 lines (Firefox, deltaMode LINE) or 1 page; each is turned into the same 120 units, smaller
# trackpad steps into a part of one (wxScrollHelper adds parts up). The port passed the pixels as the rotation with
# delta 10 and 1 line per action: 10 lines a notch (a scrolled page jumped 300 px where the desktop moves 3 lines)
# and the 3D views zoomed by 10 notches at a time. Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/mouse.cpp', '#include <emscripten/html5.h>\n', '#include <emscripten/html5.h>\n#include <cmath>\n')
sub('src/wasm/mouse.cpp', '''    mouseEvent->m_wheelRotation = delta;
    mouseEvent->m_wheelDelta = 10;

    mouseEvent->m_linesPerAction = 1;
    mouseEvent->m_columnsPerAction = 1;''', '''    // the browser's notch (100 px, 3 lines or 1 page) as the desktop's 120 units
    const double perNotch = emscriptenEvent.deltaMode == DOM_DELTA_LINE ? 3.0
                          : emscriptenEvent.deltaMode == DOM_DELTA_PAGE ? 1.0 : 100.0;
    int rotation = (int)lround(delta * 120.0 / perNotch);
    if (rotation == 0)
        rotation = delta > 0 ? 1 : -1;
    mouseEvent->m_wheelRotation = rotation;
    mouseEvent->m_wheelDelta = 120;

    mouseEvent->m_linesPerAction = 3;
    mouseEvent->m_columnsPerAction = 3;''')
