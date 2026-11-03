// KiCad's platform layer for the browser build: what the GTK version does through GTK/GDK, done with wx's own calls
// on the wasm port, or not at all (reparenting, IME, pointer warps and infinite drags have no browser equivalent yet).
#include <kiplatform/ui.h>
#include <wx/choice.h>
#include <wx/dataview.h>
#include <wx/dialog.h>
#include <wx/nonownedwnd.h>
#include <wx/settings.h>
#include <wx/toplevel.h>
#include <wx/window.h>
#include <wx/utils.h>
bool KIPLATFORM::UI::IsDarkTheme() { return wxSystemSettings::GetAppearance().IsDark(); }
wxColour KIPLATFORM::UI::GetDialogBGColour() { return wxSystemSettings::GetColour( wxSYS_COLOUR_BTNFACE ); }
void KIPLATFORM::UI::ForceFocus( wxWindow* aWindow ) { if( aWindow ) aWindow->SetFocus(); }
bool KIPLATFORM::UI::IsWindowActive( wxWindow* aWindow )
{
    if( !aWindow ) return false;
    wxWindow* tlw = wxGetTopLevelParent( aWindow );
    if( wxTopLevelWindow* t = dynamic_cast<wxTopLevelWindow*>( tlw ) ) return t->IsActive();
    return false;
}
void KIPLATFORM::UI::EnsureVisible( wxWindow* ) {}
void KIPLATFORM::UI::ReparentModal( wxNonOwnedWindow* ) {}
void KIPLATFORM::UI::ReparentWindow( wxNonOwnedWindow*, wxTopLevelWindow* ) {}
void KIPLATFORM::UI::FixupCancelButtonCmdKeyCollision( wxWindow* ) {}
bool KIPLATFORM::UI::IsStockCursorOk( wxStockCursor ) { return true; }
void KIPLATFORM::UI::LargeChoiceBoxHack( wxChoice* ) {}
void KIPLATFORM::UI::EllipsizeChoiceBox( wxChoice* ) {}
double KIPLATFORM::UI::GetPixelScaleFactor( const wxWindow* aWindow ) { return aWindow ? aWindow->GetDPIScaleFactor() : 1.0; }
double KIPLATFORM::UI::GetContentScaleFactor( const wxWindow* aWindow ) { return aWindow ? aWindow->GetContentScaleFactor() : 1.0; }
void KIPLATFORM::UI::GetInfoBarColours( wxColour& aFGColour, wxColour& aBGColour )
{
    aFGColour = wxSystemSettings::GetColour( wxSYS_COLOUR_INFOTEXT );
    aBGColour = wxSystemSettings::GetColour( wxSYS_COLOUR_INFOBK );
}
wxSize KIPLATFORM::UI::GetUnobscuredSize( const wxWindow* aWindow ) { return aWindow ? aWindow->GetClientSize() : wxSize(); }
void KIPLATFORM::UI::SetOverlayScrolling( const wxWindow*, bool ) {}
bool KIPLATFORM::UI::AllowIconsInMenus() { return true; }
wxPoint KIPLATFORM::UI::GetMousePosition() { return wxGetMousePosition(); }
// a browser page cannot move the pointer: report the warp as failed (as wxgtk/ui.cpp does when a Wayland warp fails),
// so callers keep the cursor where it is (CenterOnCursor, infinite pan) instead of acting on a warp that never happened
bool KIPLATFORM::UI::WarpPointer( wxWindow*, int, int ) { return false; }
void KIPLATFORM::UI::ImmControl( wxWindow*, bool ) {}
void KIPLATFORM::UI::ImeNotifyCancelComposition( wxWindow* ) {}
bool KIPLATFORM::UI::InfiniteDragPrepareWindow( wxWindow* ) { return false; }
void KIPLATFORM::UI::InfiniteDragReleaseWindow() {}
void KIPLATFORM::UI::SetFloatLevel( wxWindow* ) {}
void KIPLATFORM::UI::ReleaseChildWindow( wxNonOwnedWindow* ) {}
void KIPLATFORM::UI::AllowNetworkFileSystems( wxDialog* ) {}
void KIPLATFORM::UI::CancelPendingScroll( wxDataViewCtrl* ) {}
