# Ctrl+letter makes a char event, as wxGTK and wxMSW do (Ctrl+A arrives as WXK_CONTROL_A = 1 ... Ctrl+Z = 26).
# The port makes char events from the key down (keydown is default-prevented, so the browser sends no keypress) but
# skipped every key with Ctrl held, so no Ctrl shortcut handled in a char handler ever ran: PrusaSlicer's 3D view
# (GLCanvas3D::on_char: Ctrl+A select all, Ctrl+C/V copy/paste, Ctrl+X cut, Ctrl+Z/Y undo/redo, Ctrl+Del...) did
# nothing. Port of wxGTK 3.2 src/gtk/window.cpp AdjustCharEventKeyCodes (line 1289):
# with Ctrl down an ASCII letter becomes code - 'a' + 1 (key code and Unicode key). Not with Alt (AltGr = Ctrl+Alt on
# Windows types characters). Text boxes are unchanged: wxUniv wxTextCtrl::OnChar takes only keys without modifiers,
# and their Ctrl keys are handled on the key down (z9/z13). Meta (Cmd) stays without a char event. Run in owx or pwx.
p = 'src/wasm/app.cpp'
s = open(p).read()
a = '''                    if (!app->HandleKeyEvent(&event) &&
                        !emscriptenEvent->ctrlKey && !emscriptenEvent->metaKey &&
                        std::strlen(emscriptenEvent->key) == 1)
                    {
                        wxKeyEvent charEvent;
                        EmscriptenKeyboardEventToWXEvent(EMSCRIPTEN_EVENT_KEYPRESS, *emscriptenEvent, &charEvent);
                        app->HandleKeyEvent(&charEvent);
                    }'''
b = '''                    const char k = emscriptenEvent->key[0];
                    const bool ctrlLetter = emscriptenEvent->ctrlKey && !emscriptenEvent->altKey &&
                        ((k >= 'a' && k <= 'z') || (k >= 'A' && k <= 'Z'));
                    if (!app->HandleKeyEvent(&event) &&
                        (!emscriptenEvent->ctrlKey || ctrlLetter) && !emscriptenEvent->metaKey &&
                        std::strlen(emscriptenEvent->key) == 1)
                    {
                        wxKeyEvent charEvent;
                        EmscriptenKeyboardEventToWXEvent(EMSCRIPTEN_EVENT_KEYPRESS, *emscriptenEvent, &charEvent);
                        if (ctrlLetter)
                        {
                            // wxGTK AdjustCharEventKeyCodes: Ctrl+letter = 1..26 (WXK_CONTROL_A...)
                            charEvent.m_keyCode = (k >= 'a' ? k - 'a' : k - 'A') + 1;
#if wxUSE_UNICODE
                            charEvent.m_uniChar = charEvent.m_keyCode;
#endif
                        }
                        app->HandleKeyEvent(&charEvent);
                    }'''
if b not in s:
    assert s.count(a) == 1, p
    open(p, 'w').write(s.replace(a, b))
