# A menu closes before its command runs (z78. Run in owx/pwx (every wx tree: the anchor is
# stock wxUniv, same text in 3.1.5 / 3.2.6 / 3.3).
#
# Seen: KiCad PCB editor, File > Plot... opens the Plot dialog, but the File menu stays painted and no click reaches
# the dialog (text box, Plot, Close dead); keys work; Escape closes the dialog and only then the menu goes. The toolbar
# button opens the same dialog fine.
#
# Cause (stock wxUniv order, src/univ/menu.cpp wxPopupMenuWindow::ClickItem): m_menu->ClickItem(item) sends the
# command FIRST and DismissAndNotify() runs only after the handler returns. KiCad's handler runs the dialog in a nested
# loop (ACTION_MENU::OnMenuEvent -> toolMgr->ProcessEvent, synchronous -> BOARD_EDITOR_CONTROL::Plot ->
# DIALOG_SHIM::ShowQuasiModal), so during the whole dialog:
#   - capture stack (src/common/wincmn.cpp CaptureMouse/ReleaseMouse) is [menubar (wxMenuBar::OnLeftDown/SelectMenu
#     CaptureMouse), menu popup (popupcmn.cpp Show, __WXWASM__ CaptureMouse)];
#   - ShowQuasiModal (common/dialog_shim.cpp:1652) releases GetCapture() = the popup; wxWindowBase::ReleaseMouse pops it
#     and gives the capture BACK to the menubar (wincmn.cpp:3450 DoCaptureMouse on stack.back());
#   - WINDOW_DISABLER(frame) disables the frame, so the menubar child is disabled;
#   - wasm app.cpp GetMouseWindow returns the capture window (menubar) for every mouse event, and SendMouseEventToWindow
#     drops events for a disabled window (app.cpp:341 IsEnabled) -> every click is swallowed. Keys go to focus (dialog).
#   - the popup is never hidden until the handler returns -> menu image stays.
# (ModalTakesMouse in univ dialog.cpp, d-popup-clicks, does not help: quasi-modal never calls wxDialog::ShowModal.)
#
# Desktop order: GTK hides the menu shell before activating the item (gtkmenushell.c gtk_menu_shell_activate_item:
# deactivate, then gtk_widget_activate); wxMSW gets WM_COMMAND after the menu loop ends. So: close every menu (popup
# hidden, popup + menubar capture released, menubar unhighlighted, popup-menu loop told to exit) THEN send the command.
# Also safer: a command that rebuilds or deletes the menus (KiCad ReCreateMenuBar) no longer leaves DismissAndNotify
# running on a freed popup. The item stays valid until its own handler runs; the command is sent by m_menu, whose
# SendEvent uses the invoking window / menubar frame, not the (now hidden) popup.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _wxforms import sub

sub('src/univ/menu.cpp', '''    wxASSERT_MSG( !item->IsSeparator() && !item->IsSubMenu(),
                  wxT("can't click this item") );

    m_menu->ClickItem(item);

    // close all menus
    DismissAndNotify();
}''', '''    wxASSERT_MSG( !item->IsSeparator() && !item->IsSubMenu(),
                  wxT("can't click this item") );

#ifdef __WXWASM__
    // (z78) as wxGTK/wxMSW: every menu is closed (hidden, capture released) before the command runs, so a command that
    // (z78) runs a dialog's loop gets a dialog that takes clicks, and no menu stays painted over it
    wxMenu * const menu = m_menu;   // (z78) the command may delete this popup's menus; nothing here is used after it
    DismissAndNotify();             // (z78)
    menu->ClickItem(item);          // (z78)
#else
    m_menu->ClickItem(item);

    // close all menus
    DismissAndNotify();
#endif
}''')
