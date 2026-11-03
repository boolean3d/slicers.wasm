# The system font is Noto Sans, shipped with the app (slicer-wx/fonts, preloaded at /wx-fonts, made FontFaces by
# js/app-fonts.js), as on the Linux desktop where GTK's 'Sans' is fontconfig's Noto Sans. The port asked for
# "Open Sans, sans-serif": no Open Sans anywhere, so every menu, stock dialog and plain control drew with whatever the
# visitor's browser calls sans-serif (Liberation Sans/Arial: 13+3 px tall at 11 pt against Noto's 16+4), and
# menu rows, list rows and labels came out shorter and narrower than desktop. Families DEFAULT and SWISS now ask for
# "Noto Sans" first; a named face that is missing (e.g. "Segoe UI") also falls to Noto Sans before sans-serif.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

F = 'src/wasm/font.cpp'
sub(F, '''        case wxFONTFAMILY_DEFAULT:
            return "Open Sans, sans-serif";''', '''        case wxFONTFAMILY_DEFAULT:
            return "\\"Noto Sans\\", sans-serif";''')
sub(F, '''        case wxFONTFAMILY_SWISS:
            return "Open Sans, sans-serif";''', '''        case wxFONTFAMILY_SWISS:
            return "\\"Noto Sans\\", sans-serif";''')
