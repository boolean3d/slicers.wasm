// KiCad's platform layer for the browser build: paths under the tab's home, no desktop services (trash, proxy).
#include <kiplatform/environment.h>
#include <wx/filename.h>
#include <wx/filefn.h>
#include <wx/utils.h>
#include <wx/dir.h>
static wxString homeDir( const char* aSub )
{
    wxFileName fn;
    fn.AssignDir( wxGetHomeDir() );
    for( const wxString& part : wxSplit( wxString::FromUTF8( aSub ), '/' ) )
        fn.AppendDir( part );
    return fn.GetFullPath();
}
void KIPLATFORM::ENV::Init() {}
bool KIPLATFORM::ENV::MoveToTrash( const wxString& aPath, wxString& aError )
{
    // no trash in a browser's file system: the file is removed
    bool ok = wxDirExists( aPath ) ? wxFileName::Rmdir( aPath, wxPATH_RMDIR_RECURSIVE ) : wxRemoveFile( aPath );
    if( !ok ) aError = wxT( "could not remove " ) + aPath;
    return ok;
}
bool KIPLATFORM::ENV::IsNetworkPath( const wxString& ) { return false; }
wxString KIPLATFORM::ENV::GetDocumentsPath() { return homeDir( ".local/share" ); }
wxString KIPLATFORM::ENV::GetUserConfigPath() { return homeDir( ".config" ); }
wxString KIPLATFORM::ENV::GetUserDataPath() { return homeDir( ".local/share" ); }
wxString KIPLATFORM::ENV::GetUserLocalDataPath() { return homeDir( ".local/share" ); }
wxString KIPLATFORM::ENV::GetUserCachePath() { return homeDir( ".cache" ); }
bool KIPLATFORM::ENV::GetSystemProxyConfig( const wxString&, PROXY_CONFIG& ) { return false; }
bool KIPLATFORM::ENV::VerifyFileSignature( const wxString& ) { return true; }
wxString KIPLATFORM::ENV::GetAppUserModelId() { return wxEmptyString; }
void KIPLATFORM::ENV::SetAppDetailsForWindow( wxWindow*, const wxString&, const wxString& ) {}
wxString KIPLATFORM::ENV::GetCommandLineStr() { return wxEmptyString; }
void KIPLATFORM::ENV::AddToRecentDocs( const wxString& ) {}
