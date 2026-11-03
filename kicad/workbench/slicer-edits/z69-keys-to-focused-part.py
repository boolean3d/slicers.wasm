# Keys go to the window that has the keyboard (z69. wxApp::HandleKeyEvent picked its target with)
# wxWindow::FindFocus(), which returns the MAIN window of a composite control (wincmn.cpp: GetMainWindowOfCompositeControl),
# not the part that holds the focus. So a key typed into a composite's text part (generic wxSearchCtrl's wxSearchTextCtrl,
# univ wxComboCtrl/wxComboBox text, spin/date text) went to the composite itself (wxWindow::OnChar, skipped), never to
# wxTextCtrl::OnChar: no text appeared (KiCad: symbol chooser filter, Project Template Selector search, Find combo).
# wxMSW and wxGTK deliver a key to the native widget that has the focus, the part; the part then shows it to the composite
# (compositewin.h OnKeyEvent, hooked by z68). The port's own focus is wxWindow::DoFindFocus() (gs_focusWindow), so the key
# dispatch uses it. Other FindFocus uses (accelerator walk up the parents, top-level focus restore, z10's unclaimed Tab
# navigation, whose text z10 re-checks) are the same for the part or the composite and stay. Trace k34: SetFocus this=part,
# wxWindow::OnChar this=a different window. Trees without the anchors skip.
import sys
p = 'src/wasm/app.cpp'
s = open(p).read()
if '(z69)' in s:
    sys.exit(0)
a1 = "    wxWindow *window = wxWindow::FindFocus();\n"
if s.count(a1) != 1:
    print('z69: key dispatch anchor not found once in', p, ', skipped'); sys.exit(0)
s = s.replace(a1, "    wxWindow *window = wxWindow::DoFindFocus();   // (z69) the focused part itself, as native toolkits deliver keys\n", 1)
open(p, 'w').write(s)
print('z69: keys to the focused part')
