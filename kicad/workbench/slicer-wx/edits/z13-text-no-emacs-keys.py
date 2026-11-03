# Text boxes take Ctrl/Alt keys as Windows and GTK 3 text boxes do (select all, copy, paste, cut, undo), not as Emacs.
# The wasm theme was copied from wxUniv's GTK 1 theme, whose text handler maps Ctrl+A to line start, Ctrl+E to line
# end, Ctrl+B/F/N/P to arrows, Ctrl+D/H/K/U/W and Alt+B/D/F to deletes and word moves. It runs before the standard
# handler, so Ctrl+A never reached z9's select-all: the caret jumped to 0 and typing went in front of the old value
# (PrusaSlicer Object manipulation. The handler now passes every)
# key to the standard one. Run in owx (or pwx).
p = 'src/univ/themes/wasm.cpp'
s = open(p).read()
head = 'bool wxWasmTextCtrlInputHandler::HandleKey(wxInputConsumer *control,'
tail = '    return wxStdInputHandler::HandleKey(control, event, pressed);\n}'
new = '''bool wxWasmTextCtrlInputHandler::HandleKey(wxInputConsumer *control,
                                          const wxKeyEvent& event,
                                          bool pressed)
{
    // Ctrl/Alt keys as a Windows or GTK 3 text box takes them (z13): the standard handler has them all
'''
if new not in s:
    assert s.count(head) == 1, p
    i = s.index(head); j = s.index(tail, i)
    open(p, 'w').write(s[:i] + new + s[j:])
