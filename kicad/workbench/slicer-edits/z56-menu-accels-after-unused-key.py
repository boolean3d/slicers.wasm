# Menu shortcuts work (z56, prusa-accel-1 10-26). A key the program left alone is then a menu accelerator, as wxGTK
# (src/gtk/toplevel.cpp wxgtk_tlw_key_press_event: the focused window gets the key first, char hook, key down, char;
# only if nobody took it, gtk_window_activate_key = the top-level window's accelerators). wxUniv does this in
# wxWindow::OnKeyDown, but the port never connected it (src/univ/winuniv.cpp: "//EVT_KEY_DOWN(wxWindow::OnKeyDown)"),
# so no menu accelerator ever fired: PrusaSlicer's Ctrl+S, Ctrl+O, Ctrl+E, Ctrl+R... did nothing (Bambu, Orca and KiCad
# answer most of their keys themselves). Now, in wxApp::HandleKeyEvent, every key event of a key passes through one
# rule: a key down nobody took waits for its char; a char nobody took (made here from the key down, or the browser's
# text for a text key) is tried as an accelerator before anything else happens to it (Tab navigation comes after, as
# GTK's own key handling does); a key that makes no char is tried when its dispatch ends. Accelerators: the focused
# window's accelerator tables up to its top-level window, then that frame's menu bar (wxMenuBar::ProcessAccelEvent:
# enabled items only), never the parent frame of a dialog. A key the program takes never reaches them, so nothing
# fires twice. Edits only text no earlier edit checks (z10/z14/z54b blocks untouched). Run in owx or pwx.
import sys
p = 'src/wasm/app.cpp'
s = open(p).read()
if '(z56)' in s:
    sys.exit(0)

inc_a = '#include "wx/toplevel.h"\n'
inc_b = inc_a + '#include "wx/frame.h"   // (z56)\n#include "wx/menu.h"\n#include "wx/accel.h"\n'

fn_a = 'bool wxApp::HandleKeyEvent(wxKeyEvent *event)\n{\n'
fn_b = '''// Menu accelerators (z56): see the edit's header. One key at a time: the char hook starts a key, so a nested key (a
// modal dialog's loop run by a handler) starts over and its own key down / char decide for it.
static bool s_accelWaits = false;   // the current key's key down went unhandled: its char (or its end) may be an accelerator
static wxKeyEvent s_accelKey;       // that key down (accelerators match key code + Ctrl/Shift/Alt, never a char code)

static bool wxWasmMenuAccel(const wxKeyEvent& key)
{
    wxWindow *start = wxWindow::FindFocus();
    if (!start && wxTheApp) start = wxTheApp->GetTopWindow();
    for (wxWindow *win = start; win; win = win->GetParent())
    {
        if (!win->IsEnabled()) return false;   // under a modal dialog: GTK leaves an insensitive window's accelerators alone
        wxAcceleratorTable *table = win->GetAcceleratorTable();
        const int command = table && table->IsOk() ? table->GetCommand(key) : -1;
        if (command != -1)
        {
            wxCommandEvent ev(wxEVT_MENU, command);
            ev.SetEventObject(win);
            if (win->GetEventHandler()->ProcessEvent(ev)) return true;
        }
        if (win->IsTopLevel())
        {
#if wxUSE_MENUS
            wxFrame *frame = wxDynamicCast(win, wxFrame);
            wxMenuBar *bar = frame ? frame->GetMenuBar() : NULL;
            return bar && bar->ProcessAccelEvent(key);
#else
            return false;
#endif
        }
    }
    return false;
}

// every key event the port sends ends here with what the program did with it; returns whether the key is now used
static bool wxWasmKeyAccel(const wxKeyEvent& event, bool handled)
{
    const wxEventType t = event.GetEventType();
    if (t == wxEVT_CHAR_HOOK)
        s_accelWaits = false;   // a new key
    else if (t == wxEVT_KEY_DOWN)
    {
        s_accelWaits = !handled;
        if (!handled) s_accelKey = event;
    }
    else if (t == wxEVT_CHAR && s_accelWaits)
    {
        s_accelWaits = false;
        if (!handled) return wxWasmMenuAccel(s_accelKey);
    }
    return handled;
}

// the end of a key's dispatch: a key whose key down nobody took and that made no char is tried now (F keys, Delete, a
// Cmd shortcut on a Mac); a text key's char comes later with its text (wxWasmSendChars)
static void wxWasmKeyEnded(int keyFlags)
{
    if (s_accelWaits && !(keyFlags & 16))   // 16 = wxWASM_KEY_TEXT
    {
        s_accelWaits = false;
        wxWasmMenuAccel(s_accelKey);
    }
}

''' + fn_a

ret_a = '''        return window->HandleWindowEvent(*event);
    }
    else
    {
        return false;
    }
}'''
ret_b = '''        return wxWasmKeyAccel(*event, window->HandleWindowEvent(*event));   // (z56)
    }
    else
    {
        return wxWasmKeyAccel(*event, false);
    }
}'''

end_a = '''
    return preventDefault;
}

static EM_BOOL MouseCallbackNow('''
end_b = '''
    if (event.GetEventType() == wxEVT_KEY_DOWN)
        wxWasmKeyEnded(keyFlags);   // (z56)

    return preventDefault;
}

static EM_BOOL MouseCallbackNow('''

for a in (inc_a, fn_a, ret_a, end_a):
    if s.count(a) != 1:
        print('z56: app.cpp differs here, NOT applied:', repr(a[:50]), s.count(a)); sys.exit(1)
if 'int keyFlags' not in s:
    print('z56: KeyCallbackNow has no keyFlags (no off-thread text path), NOT applied'); sys.exit(1)
s = s.replace(inc_a, inc_b, 1).replace(fn_a, fn_b, 1).replace(ret_a, ret_b, 1).replace(end_a, end_b, 1)
open(p, 'w').write(s)
print('z56: menu accelerators after a key nobody took')
