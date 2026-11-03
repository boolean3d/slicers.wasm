# The system font is 10 pt, GTK's own default ("Sans 10", gtksettings.c) and what the desktop answer key draws its
# menus with (Noto Sans at 13 px: "Batch Preset Management" 162 px wide on desktop). f-text-metrics.py had set 11 pt
# (the desktop-environment setting of GNOME/Ubuntu); with Noto Sans that drew every menu and plain control a size too
# big. A tree f made 11 goes back to 10; a fresh tree is already 10.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/settings.cpp', '''static wxFont gs_fontDefault(11, wxFONTFAMILY_SWISS''', '''static wxFont gs_fontDefault(10, wxFONTFAMILY_SWISS''')
