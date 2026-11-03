# z52: a window's "needs paint" mark always reaches its top-level window, and the marks are cleared BEFORE the paint
# handlers run, not after. Before: Invalidate() stopped at a window already marked, and PaintSelf/PaintChildren cleared
# the marks after the handlers. A Refresh() made during a paint pass on a window the pass had already visited (KiCad's
# 3D view: its render reports "Last render time" into the status bar; a canvas asking for another frame) left that
# window marked but its ancestors cleared at the end of the pass: unreachable, and every later Refresh() on it stopped
# at the early return. KiCad's 3D canvas got about half the frames the loop offered it (kicad-play-11, 10-26: 125
# Refresh() handled, 58 paints in 3 s). Now a mark made during a pass marks the chain up to the top again and the next
# pass paints it, as GTK/MSW queue a paint made from inside a paint. Rerun-safe; does nothing on a tree it does not fit.
# Run in pwx/owx.
MARK = 'z52'
def edit(path, pairs):
    s = open(path).read()
    if MARK in s:
        print(MARK, 'already in', path); return True
    for a, b in pairs:
        if s.count(a) != 1:
            print(MARK + ': ' + path + ' does not fit, skipped (' + a[:50].replace('\n', ' ') + ')'); return False
    for a, b in pairs:
        s = s.replace(a, b)
    open(path, 'w').write(s); print(MARK, 'ok', path); return True

ok = edit('src/wasm/window.cpp', [(
'''void wxWindowWasm::Invalidate(bool needsPaint)
{
    if (!m_childNeedsPaint || m_selfNeedsPaint != needsPaint)
    {
        m_selfNeedsPaint |= needsPaint;
        m_childNeedsPaint = true;

        if (GetParent())
        {
            bool parentNeedsPaint = needsPaint && HasTransparentBackground();
            GetParent()->Invalidate(parentNeedsPaint);
        }
    }
}
''',
'''void wxWindowWasm::Invalidate(bool needsPaint)
{
    // z52: always up to the top-level window. Stopping at a window already marked left it unreachable when the mark
    // was made during a paint pass that had visited it: the pass cleared its ancestors' marks at its end.
    m_selfNeedsPaint |= needsPaint;
    m_childNeedsPaint = true;

    if (GetParent())
    {
        bool parentNeedsPaint = needsPaint && HasTransparentBackground();
        GetParent()->Invalidate(parentNeedsPaint);
    }
}
'''), (
'''    EraseBackgroundWindow();

    if (GetClientRect() != GetRect())
    {
        wxNcPaintEvent ncPaintEvent(this);
        HandleWindowEvent(ncPaintEvent);
    }

    wxPaintEvent paintEvent(this);
    HandleWindowEvent(paintEvent);

    m_selfNeedsPaint = false;
}
''',
'''    m_selfNeedsPaint = false;   // z52: before the handlers, so a Refresh() made inside one is kept for the next pass

    EraseBackgroundWindow();

    if (GetClientRect() != GetRect())
    {
        wxNcPaintEvent ncPaintEvent(this);
        HandleWindowEvent(ncPaintEvent);
    }

    wxPaintEvent paintEvent(this);
    HandleWindowEvent(paintEvent);
}
'''), (
'''    wxWindowList& children = GetChildren();

    for (wxWindowList::iterator i = children.begin(); i != children.end(); ++i)
    {
        wxWindow *child = *i;

        wxASSERT(child);

        if (!child->IsFrozen() && child->IsShown())
        {
            if (child->NeedsPaint() || selfWasPainted)
            {
                child->DoPaint(selfWasPainted);
            }
        }
    }

    m_childNeedsPaint = false;
}
''',
'''    wxWindowList& children = GetChildren();

    m_childNeedsPaint = false;   // z52: before the children paint, so a mark made by one of them stays for the next pass

    for (wxWindowList::iterator i = children.begin(); i != children.end(); ++i)
    {
        wxWindow *child = *i;

        wxASSERT(child);

        if (!child->IsFrozen() && child->IsShown())
        {
            if (child->NeedsPaint() || selfWasPainted)
            {
                child->DoPaint(selfWasPainted);
            }
        }
    }
}
''')])
print(MARK, 'done' if ok else 'INCOMPLETE')
