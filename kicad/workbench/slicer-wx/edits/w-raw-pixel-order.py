# Raw pixel access (wxAlphaPixelData / wxNativePixelData) reads and writes the wasm bitmap's bytes in the order the
# bitmap keeps them: R, G, B, A (wasm/bitmap.cpp ConvertToImage and CreateFromImage). rawbmp.h said B, G, R for
# __WXWASM__, so every bitmap filled through pixel data came out with red and blue swapped: wx 3.2's SVG bundles
# (generic/bmpsvg.cpp, PrusaSlicer's every icon) drew Prusa orange #ED6B21 as blue #216BED, and BitmapCache's joined
# icons read swapped colours. Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('include/wx/rawbmp.h', '''#elif defined(__WXWASM__)
    // Under Wasm, RGB components are reversed, they're in BGR order
    // Alpha channel is present and must be set to 255, hence 32bpp
    typedef wxPixelFormat<unsigned char, 32, 2, 1, 0> wxNativePixelFormat;''', '''#elif defined(__WXWASM__)
    // Under Wasm a bitmap keeps R, G, B, A bytes (wasm/bitmap.cpp ConvertToImage)
    // Alpha channel is present and must be set to 255, hence 32bpp
    typedef wxPixelFormat<unsigned char, 32, 0, 1, 2> wxNativePixelFormat;''')
