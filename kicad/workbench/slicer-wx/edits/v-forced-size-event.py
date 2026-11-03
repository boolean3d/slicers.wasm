# A sizer's SetSize(..., wxSIZE_FORCE_EVENT) sends a size event even when the size did not change, as on
# wxMSW (window.cpp DoSetSize: "We need to send wxSizeEvent ourselves") and wxGTK (DoSetSize sizeFlags &
# wxSIZE_FORCE_EVENT). The wasm port sent one only on a change, so a scrolled window whose content grew
# while its own size stayed never heard of it: wxScrollHelper::HandleOnSize (the only place that sets the
# virtual size from the best size) did not run, ScrollLayout laid the taller content into the old client
# height and the sizer squeezed it. PrusaSlicer: after Slice the Sliced Info box was drawn over Object
# manipulation (virtual 420x784, best 420x1031) and no scroll bar came.
# Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/window.cpp', '''        wxSize newSize(width, height);
        wxSizeEvent event(newSize, GetId());
        event.SetEventObject(this);
        HandleWindowEvent(event);
    }
}''', '''        wxSize newSize(width, height);
        wxSizeEvent event(newSize, GetId());
        event.SetEventObject(this);
        HandleWindowEvent(event);
    }
    else if (sizeFlags & wxSIZE_FORCE_EVENT)
    {
        // same size, but the caller (a sizer) wants the window to lay itself out again (wxMSW, wxGTK)
        wxSizeEvent event(wxSize(width, height), GetId());
        event.SetEventObject(this);
        HandleWindowEvent(event);
    }
}''')
