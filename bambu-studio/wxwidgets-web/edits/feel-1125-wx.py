#!/usr/bin/env python3
# slicer-feel-1125: the wx browser port's edits for a smooth window drag and desktop tree expanders.
# Run on a wxWidgets tree that already has patches/wxwidgets.patch applied:  python3 feel-1125-wx.py <wx tree>
# Each edit must match exactly once; a tree that already has it is left alone (safe to rerun).
#
# 1. Moving a top-level window (a dialog dragged by its title bar, a popup placed) is a move, not a resize: desktop
#    ports send wxMoveEvent and nothing else. The port invalidated the window and every child, sent a size event (the
#    dialog's sizer laid everything out again), had the page remake the window's canvas (which clears it, so all of it
#    was painted again) and refreshed the PARENT top-level's rectangles, which in this port is a full repaint of the
#    main window behind the dialog: every mouse move during a drag cost a whole-program repaint (measured 11-25 at
#    1920x1080, DPR 1.5: the program's thread 100% busy, the dialog at 30 fps, still moving 1 s after the mouse stopped).
#    Now a top-level window that only moves keeps its pixels: no invalidation, no size event, no parent refresh, and the
#    page keeps its canvas when its device size and pixel phase are unchanged (at a fractional scale an odd move shifts
#    the phase: then the canvas is remade and only this window repaints).
# 2. Tree expanders (wxDataViewCtrl, wxTreeCtrl: the object list) were the generic renderer's +/- boxes; the desktop
#    (GTK) draws a small triangle, pointing right when closed and down when open. Drawn the same way here, and, as
#    GTK's tree, only on a row that has rows under it (the object list's empty "Outside" had a + box).
# 3. Wheel and trackpad in a scrolled panel: wx turns every 120 units of wheel into 3 lines at once, so a trackpad's
#    small steps (a few pixels each) piled up and the panel jumped 3 lines at a time. The lines are counted one by
#    one instead (120 units = 3 lines, as before, for a mouse notch; 40 units = 1 line), so a trackpad scrolls a line
#    as soon as it has moved one, steadily, and a mouse notch stays the desktop's 3 lines.
import sys, pathlib

root = pathlib.Path(sys.argv[1])

def edit(rel, old, new, done_marker):
    p = root / rel
    s = p.read_text()
    if done_marker in s:
        print(f'{rel}: already has "{done_marker}"')
        return
    n = s.count(old)
    if n != 1:
        sys.exit(f'{rel}: expected the text once, found it {n} times:\n{old}')
    p.write_text(s.replace(old, new))
    print(f'{rel}: edited ({done_marker})')

# ---- 1a. wxWindowWasm::DoSetSize: a top-level window that only moves
edit('src/wasm/window.cpp',
'''    if (x != currentX || y != currentY || width != currentW || height != currentH)
    {
        Invalidate(true);

        AdjustForParentClientOrigin(x, y, sizeFlags);
        DoMoveWindow(x, y, width, height);

        wxSize newSize(width, height);
        wxSizeEvent event(newSize, GetId());
        event.SetEventObject(this);
        HandleWindowEvent(event);
    }''',
'''    if (x != currentX || y != currentY || width != currentW || height != currentH)
    {
        // (feel-1125) a top-level window that only moves keeps its pixels and hears a move, as on the desktop
        const bool onlyMoved = IsTopLevel() && width == currentW && height == currentH;
        if (!onlyMoved)
            Invalidate(true);

        AdjustForParentClientOrigin(x, y, sizeFlags);
        DoMoveWindow(x, y, width, height);

        if (onlyMoved)
        {
            wxMoveEvent event(wxPoint(x, y), GetId());
            event.SetEventObject(this);
            HandleWindowEvent(event);
        }
        else
        {
            wxSize newSize(width, height);
            wxSizeEvent event(newSize, GetId());
            event.SetEventObject(this);
            HandleWindowEvent(event);
        }
    }''', '(feel-1125) a top-level window that only moves')

# ---- 1b. wxWindowWasm::DoMoveWindow: a top-level window has a canvas of its own, its parent's pixels are not under it
edit('src/wasm/window.cpp',
'''        wxWindow *parent = GetParent();

        if (parent != NULL)
        {
            parent->RefreshRect(oldPos);
            parent->RefreshRect(newPos);
        }''',
'''        wxWindow *parent = GetParent();

        // (feel-1125) a top-level window is a canvas of its own: moving it uncovers nothing in its parent's canvas
        if (parent != NULL && !IsTopLevel())
        {
            parent->RefreshRect(oldPos);
            parent->RefreshRect(newPos);
        }''', '(feel-1125) a top-level window is a canvas of its own')

# ---- 1c. wxNonOwnedWindow::DoSetSize: paint again only when the page remade the canvas
edit('src/wasm/nonownedwnd.cpp',
'''        EM_ASM({
            return setWindowRect($0, $1, $2, $3, $4);
        }, GetCSSId(), newRect.x, newRect.y, newRect.width, newRect.height);''',
'''        // (feel-1125) 1: the canvas was made anew (cleared), so the window paints again; 0: it kept its pixels
        if (EM_ASM_INT({
            return setWindowRect($0, $1, $2, $3, $4) ? 1 : 0;
        }, GetCSSId(), newRect.x, newRect.y, newRect.width, newRect.height))
            Refresh();''', '(feel-1125) 1: the canvas was made anew')

# ---- 1d. wx.js setWindowRect: keep the canvas when its device size and pixel phase are unchanged
edit('build/wasm/wx.js',
'''    var canvas = windowData.canvas;
    windowData.rect = [x, y, width, height];   // (z59) remade at a new devicePixelRatio

    if (canvas) {
      // (z59) the device pixels the browser shows this window at (a rounded scale stretched it: soft at 1.25)
      var scaleFactor = wxDevScale();
      windowData.devScale = scaleFactor;
      var wxTop = wxInWorker ? wxPageMainTop : 0;
''',
'''    var canvas = windowData.canvas;
    windowData.rect = [x, y, width, height];   // (z59) remade at a new devicePixelRatio

    if (canvas) {
      // (z59) the device pixels the browser shows this window at (a rounded scale stretched it: soft at 1.25)
      var scaleFactor = wxDevScale();
      var wxTop = wxInWorker ? wxPageMainTop : 0;
      // (feel-1125) a move that keeps the device size and the pixel phase keeps the canvas and its pixels: setting
      // canvas.width clears it, and the whole window would have to paint again for every mouse move of a drag
      var keepW = wxDevSpan(x, width, scaleFactor), keepH = wxDevSpan(y + wxTop, height, scaleFactor);
      var phase = function (p) { return Math.round(p * scaleFactor) - p * scaleFactor; };
      if (windowData.context && windowData.devScale === scaleFactor && canvas.width === keepW && canvas.height === keepH &&
          windowData.phase && windowData.phase[0] === phase(x) && windowData.phase[1] === phase(y + wxTop)) {
        return 0;
      }
      windowData.phase = [phase(x), phase(y + wxTop)];
      windowData.devScale = scaleFactor;
''', '(feel-1125) a move that keeps the device size')
edit('build/wasm/wx.js',
'''      windowData.context = ctx;
    }
  };''',
'''      windowData.context = ctx;
    }
    return 1;
  };''', 'windowData.context = ctx;\n    }\n    return 1;')

# ---- 2. tree expanders: a triangle, as the desktop draws them
edit('src/generic/renderg.cpp',
'''    // store settings
    wxDCPenChanger penChanger(dc, *wxGREY_PEN);
    wxDCBrushChanger brushChanger(dc, *wxWHITE_BRUSH);

    dc.DrawRectangle(rect);
''',
'''#ifdef __WXWASM__
    // (feel-1125) the desktop's expander (GTK): a small filled triangle, right when closed, down when open
    {
        wxDCPenChanger penChanger(dc, *wxTRANSPARENT_PEN);
        wxDCBrushChanger brushChanger(dc, wxBrush(wxColour(0x6b, 0x6b, 0x6b)));
        const double cx = rect.x + rect.width / 2.0, cy = rect.y + rect.height / 2.0;
        const double h = wxMax(3.0, wxMin(rect.width, rect.height) * 0.30);   // half the triangle's long side
        wxPoint pts[3];
        if ( flags & wxCONTROL_EXPANDED )
        {
            pts[0] = wxPoint(wxRound(cx - h), wxRound(cy - h / 2));
            pts[1] = wxPoint(wxRound(cx + h), wxRound(cy - h / 2));
            pts[2] = wxPoint(wxRound(cx), wxRound(cy + h / 2 + 1));
        }
        else
        {
            pts[0] = wxPoint(wxRound(cx - h / 2), wxRound(cy - h));
            pts[1] = wxPoint(wxRound(cx - h / 2), wxRound(cy + h));
            pts[2] = wxPoint(wxRound(cx + h / 2 + 1), wxRound(cy));
        }
        dc.DrawPolygon(3, pts);
        return;
    }
#endif // __WXWASM__
    // store settings
    wxDCPenChanger penChanger(dc, *wxGREY_PEN);
    wxDCBrushChanger brushChanger(dc, *wxWHITE_BRUSH);

    dc.DrawRectangle(rect);
''', '(feel-1125) the desktop\'s expander')
edit('src/generic/datavgen.cpp',
'''                // draw expander if needed
                if ( node->HasChildren() )
                {''',
'''                // draw expander if needed
#ifdef __WXWASM__
                // (feel-1125) as GTK's tree: no expander on a container with nothing in it
                wxDataViewItemArray feelKids;
                if ( node->HasChildren() && GetModel()->GetChildren(node->GetItem(), feelKids) > 0 )
#else
                if ( node->HasChildren() )
#endif
                {''', '(feel-1125) as GTK\'s tree: no expander')
edit('src/generic/scrlwing.cpp',
'''    m_wheelRotation += event.GetWheelRotation();
    int lines = m_wheelRotation / event.GetWheelDelta();
    m_wheelRotation -= lines * event.GetWheelDelta();
''',
'''#ifdef __WXWASM__
    // (feel-1125) counted line by line (a notch, 120 units, is still the lines per action): a trackpad's small steps
    // scroll a line as soon as they add up to one, instead of 3 lines at once every 120 units
    const int perAction = event.IsPageScroll() ? 1 : wxMax(1, event.GetLinesPerAction());
    m_wheelRotation += event.GetWheelRotation() * perAction;
#else
    m_wheelRotation += event.GetWheelRotation();
#endif
    int lines = m_wheelRotation / event.GetWheelDelta();
    m_wheelRotation -= lines * event.GetWheelDelta();
''', '(feel-1125) counted line by line')
edit('src/generic/scrlwing.cpp',
'''            lines *= event.GetLinesPerAction();
            if (lines > 0)''',
'''#ifndef __WXWASM__ // (feel-1125) already counted in lines
            lines *= event.GetLinesPerAction();
#endif
            if (lines > 0)''', '(feel-1125) already counted in lines')
