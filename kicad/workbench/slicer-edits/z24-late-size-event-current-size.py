# The size event a new window gets after Create() tells its size at the time it is handled, not its size at creation.
# The wasm port queues one size event per created window, made at Create() with the creation size (WidthDefault/HeightDefault:
# 20x20 for a control made without a size). It is handled at the next idle, after the dialog's sizers have already given
# the window its real size, so handlers that read evt.GetSize() act on a stale size. Desktop never does that: wxMSW sends
# WM_SIZE inside CreateWindowEx (before the caller's handlers exist), wxGTK's size-allocate carries the allocated size.
# Seen in Bambu Studio's "Parameter recommendation" box (H2S): its LB_AUTO_WRAP Label wrapped correctly at 380 px, then
# the late 20x20 event re-wrapped it to one or two letters per line (Widgets/Label.cpp OnSize -> Wrap(evt.GetSize().x)).
# The late event is still sent (a window still hears its size once after creation); it now carries GetSize() when handled.
# Run in owx (or pwx). Needs z22 (m_wasmCreated) only for its anchor's neighbour; independent otherwise.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/window.cpp', '''    wxSizeEvent *sizeEvent = new wxSizeEvent(wxSize(w, h), GetId());
    sizeEvent->SetEventObject(this);
    QueueEvent(sizeEvent);
''', '''    // the window hears its size once after creation, as it is when handled (sizers may have resized it by then)
    CallAfter([this]() {
        wxSizeEvent event(GetSize(), GetId());
        event.SetEventObject(this);
        HandleWindowEvent(event);
    });
''')
