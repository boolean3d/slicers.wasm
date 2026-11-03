// KiCad's platform layer for the browser build (wxWidgets wasm port): the Unix version without GLib.
#include <kiplatform/app.h>
#include <wx/string.h>
bool KIPLATFORM::APP::Init() { return true; }
void KIPLATFORM::APP::EnableDarkMode( bool ) {}
bool KIPLATFORM::APP::AttachConsole( bool ) { return true; }
bool KIPLATFORM::APP::IsOperatingSystemUnsupported() { return false; }
bool KIPLATFORM::APP::RegisterApplicationRestart( const wxString& ) { return true; }
bool KIPLATFORM::APP::UnregisterApplicationRestart() { return true; }
bool KIPLATFORM::APP::SupportsShutdownBlockReason() { return false; }
void KIPLATFORM::APP::RemoveShutdownBlockReason( wxWindow* ) {}
void KIPLATFORM::APP::SetShutdownBlockReason( wxWindow*, const wxString& ) {}
void KIPLATFORM::APP::ForceTimerMessagesToBeCreatedIfNecessary() {}
void KIPLATFORM::APP::AddDynamicLibrarySearchPath( const wxString& ) {}
