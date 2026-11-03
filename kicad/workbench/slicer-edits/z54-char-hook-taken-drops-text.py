# A key's text belongs to that key (z54, second form. The off-thread text path (recipe p2-text))
# gets a printable key's text from the page AFTER the key (wxWasmInText), and used to drop it only when the KEY DOWN was
# taken (one flag, s_textTaken). Two faults in KiCad (kicad-keys-1/2 10-26):
#  - a taken wxEVT_CHAR_HOOK left the flag false, so the text still came as a wxEVT_CHAR; KiCad runs hotkeys from the
#    char hook AND from chars, so one R turned a part twice (two undo steps). Desktop: a handled char hook ends the key,
#    no key down, no char (wxGTK window.cpp gtk_window_key_press_callback).
#  - a hotkey that opens a modal dialog (E, V) runs the dialog's loop INSIDE the char hook handler; the key's text was
#    taken from the queue in that nested loop, before anyone knew the key was taken, and typed into the dialog ('v').
# Now each text key being dispatched has a frame: its text, if it arrives during the dispatch (nested loop), is kept in
# the frame; when the dispatch ends the text is dropped if the program took the key (char hook or key down), else sent.
# A taken key whose text has not come yet drops it on arrival. Page order is key, text, key, text, so keys typed inside
# the dialog get their own frames and their text is theirs; a text key that sends no text (Dead key) is forgotten at
# the next text key. Slicers: only a char hook handler that eats a printable key changes (Bambu MainFrame 'Z'), now as
# on desktop. Replaces the first z54 (char-hook flag only) and undoes it where applied. Trees without p2-text skip.
import sys
p = 'src/wasm/app.cpp'
s = open(p).read()
if '(z54b)' in s:
    sys.exit(0)
if 's_textTaken' not in s:
    print('z54: no off-thread text path here, skipped'); sys.exit(0)

decl = 'static bool s_textTaken = false;  // the last text-producing key down was handled by the program: its text is dropped\n'
frames = '''// A text key's text belongs to it (z54b): text that arrives while the key is being dispatched (a modal dialog's loop run
// by its hotkey) waits in the key's frame; the key's end sends it, or drops it when the program took the key.
struct wxWasmTextKey { bool got; wxString text; };
static std::vector<wxWasmTextKey> s_textKeys;   // text keys being dispatched, innermost last
static int s_textDrops = 0;                     // texts still to come whose key the program took
static void (*s_textSend)(const wxString&) = nullptr;   // wxWasmSendChars, set by wxWasmInText (defined in the page-input block)
static void wxWasmTextKeyBegin()
{
    s_textDrops = 0;   // page order is key, text, key, text: a text not here by the next text key never comes
    s_textKeys.push_back(wxWasmTextKey{false, wxString()});
}
static void wxWasmTextKeyEnd(bool taken)
{
    const wxWasmTextKey k = s_textKeys.back();
    s_textKeys.pop_back();
    if (!k.got)
        s_textDrops = taken ? 1 : 0;
    else if (!taken)
        s_textSend(k.text);   // got = it came through wxWasmInText, which set s_textSend
}
static void wxWasmTextArrived(const wxString& text)
{
    if (!s_textKeys.empty() && !s_textKeys.back().got)
    {
        s_textKeys.back().got = true;
        s_textKeys.back().text = text;
        return;
    }
    if (s_textDrops > 0) { s_textDrops--; return; }   // its key was taken: no char, as on desktop
    s_textSend(text);
}
'''

begin_a = '            wxKeyEvent charHookEvent(wxEVT_CHAR_HOOK, event);\n'
begin_b = '''            const bool textKey = (keyFlags & wxWASM_KEY_TEXT) != 0;
            bool taken = false;   // the program took the key: char hook or key down (z54b)
            if (textKey)
                wxWasmTextKeyBegin();
''' + begin_a

down_a = '''                    // the browser sends this key's text after it (wxWasmInText), unless the program took the key down
                    s_textTaken = app->HandleKeyEvent(&event);'''
down_b = '''                    // the browser sends this key's text after it (wxWasmInText); it is dropped if the program takes the key
                    taken = app->HandleKeyEvent(&event);'''

else_old = ['''            else
            {
                preventDefault = false;
            }
''', '''            else
            {
                // the program took the char hook (z54): no key down and no char follow, so a text key's text is dropped too
                if (keyFlags & wxWASM_KEY_TEXT)
                    s_textTaken = true;
                preventDefault = false;
            }
''']
else_new = '''            else
            {
                // the program took the char hook: no key down and no char follow, so a text key's text is dropped too
                taken = true;
                preventDefault = false;
            }
            if (textKey)
                wxWasmTextKeyEnd(taken);
'''

in_a = '''        if (s_textTaken) { s_textTaken = false; return; }   // the key down before it was handled: no char, as on desktop
        wxWasmSendChars(text);'''
in_b = '''        s_textSend = wxWasmSendChars;   // (z54b)
        wxWasmTextArrived(text);'''

for a in (decl, begin_a, down_a, in_a):
    if s.count(a) != 1:
        print('z54: key path differs from the p2-text one, skipped'); sys.exit(0)
olds = [e for e in else_old if s.count(e) == 1]
if len(olds) != 1:
    print('z54: char hook branch differs, skipped'); sys.exit(0)
if '#include <vector>' not in s:
    s = s.replace('#include <deque>\n', '#include <deque>\n#include <vector>\n', 1)
s = s.replace(decl, frames).replace(begin_a, begin_b).replace(down_a, down_b).replace(olds[0], else_new).replace(in_a, in_b)
assert 's_textTaken' not in s, 'z54: s_textTaken still used somewhere'
open(p, 'w').write(s)
print('z54: text bound to its key')
