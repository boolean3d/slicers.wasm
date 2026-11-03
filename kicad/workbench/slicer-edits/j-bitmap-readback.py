# A bitmap read back twice keeps its pixels. getBitmapData (wx.js) copies a bitmap's pixels to C++; when the bitmap
# had been drawn into (a wxMemoryDC: bitmap.context) it read the canvas, dropped the context and kept no imageData,
# so the next read-back (a second copy of the same bitmap: wxBitmap::CloneGDIRefData via AllocExclusive) found
# neither and threw "Cannot read properties of null (reading 'data')". PrusaSlicer's splash screen does exactly
# that (SplashScreen::SetText selects a copy into a wxMemoryDC). Now the canvas's pixels become the bitmap's imageData.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('build/wasm/wx.js', '''      imageData = bitmap.context.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.context = null;
''', '''      imageData = bitmap.context.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.context = null;
      bitmap.imageData = imageData;   // a later read-back (another copy) needs the pixels too
''')
