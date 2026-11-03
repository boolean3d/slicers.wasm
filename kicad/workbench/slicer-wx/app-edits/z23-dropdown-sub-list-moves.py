# A filament list's second level (Generic > PLA/PETG) no longer freezes the page. The port's transient popups follow
# the Mac model (src/common/popupcmn.cpp Show: the popup captures the mouse, __WXMAC__ || __WXWASM__), so while the
# sub list is open every move goes to the sub list, also over the main list. Bambu's/Orca's DropDown::mouseMove has the
# Mac answer for that: a move outside the sub list is handed to the main list (#ifdef __WXOSX__). Without it on wasm the
# main list kept the old hover row; the press on the next row re-popped the sub list in mouseDown and the release
# called Popup() on the already shown sub list: its handlers were pushed twice (asserts popupcmn.cpp:316/317,
# wincmn.cpp:1454/1471), the handler chain became a loop and the page hung. Now wasm takes the Mac branch.
# APP SOURCE edit (not wx): run in the Orca (orca/) or Bambu Studio (bambu/) source tree. 
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/slic3r/GUI/Widgets/DropDown.cpp', '''    wxPoint pt  = event.GetPosition();
#ifdef __WXOSX__
    if (mainDropDown) {''', '''    wxPoint pt  = event.GetPosition();
#if defined(__WXOSX__) || defined(__WXWASM__) // the popup has the mouse capture: moves over the main list come here
    if (mainDropDown) {''')
