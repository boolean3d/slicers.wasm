# wxAuiManager draws its pane captions, borders, sashes and caption buttons on the managed frame with a wxClientDC, and
# then shifts that DC by the frame's client area origin ("if the frame has a toolbar, the client area origin will not be
# (0,0)"). On the wasm port a top-level window's wxClientDC already starts at GetClientAreaOrigin() (src/wasm/dcclient.cpp
# Create(wxRect(win->GetClientAreaOrigin(), ...))), and wxUniv's frame counts its menu bar in that origin: the shift
# moved every caption one menu bar lower, over the first row of its own pane (KiCad's Properties and Selection Filter
# captions drawn on "No objects selected" / "All items". Children are placed right; only what
# AUI paints itself was off. Slicers without AUI panes: no change. Run in owx (or pwx).
p = 'src/aui/framemanager.cpp'
s = open(p).read()
if 'z46' not in s:
    for dc in ('dc->', 'cdc.'):
        a = '''    wxPoint pt = m_frame->GetClientAreaOrigin();
    if (pt.x != 0 || pt.y != 0)
        %sSetDeviceOrigin(pt.x, pt.y);''' % dc
        b = '''#ifndef __WXWASM__   // z46: the port's wxClientDC of a frame already starts at its client area origin
    wxPoint pt = m_frame->GetClientAreaOrigin();
    if (pt.x != 0 || pt.y != 0)
        %sSetDeviceOrigin(pt.x, pt.y);
#endif''' % dc
        if s.count(a) != 1:
            print("z46: tree does not fit, skipped"); raise SystemExit(0)
        s = s.replace(a, b)
    open(p, 'w').write(s)
print("z46 ok")
