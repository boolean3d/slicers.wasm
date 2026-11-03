# A top-level window that appears goes above the others, as a window manager maps a new window on top (wxGTK/wxMSW:
# the shown window is the active one, in front). The wasm port gave a new window's page element no z-index (auto)
# and only Raise() set one (max + 1), so after a Raise()d frame (z-index 11) every later dialog, menu and tooltip
# (z-index auto) sat UNDER the frame: invisible, with the frame greyed out by the modal disabler. KiCad raises its
# frames at start (kicad.cpp frame->Raise(), KIWAY_PLAYER::ShowModal); the slicers never did, so they never saw it.
#.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/nonownedwnd.cpp', '''        wxpage_set_window_visibility(GetCSSId(), show);
        if (show && IsMainFrame())''', '''        wxpage_set_window_visibility(GetCSSId(), show);
        // z30: a window that appears goes on top, as a window manager maps a new window in front
        if (show)
            Raise();
        if (show && IsMainFrame())''')
print("z30 ok")
