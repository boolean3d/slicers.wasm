// KiCad's platform layer for the browser build: secrets kept in memory for the tab's life (no keyring in a browser).
#include <kiplatform/secrets.h>
#include <wx/string.h>
#include <map>
static std::map<wxString, wxString>& store() { static std::map<wxString, wxString> s; return s; }
bool KIPLATFORM::SECRETS::StoreSecret( const wxString& aService, const wxString& aKey, const wxString& aSecret )
{ store()[aService + ":" + aKey] = aSecret; return true; }
bool KIPLATFORM::SECRETS::GetSecret( const wxString& aService, const wxString& aKey, wxString& aSecret )
{ auto it = store().find( aService + ":" + aKey ); if( it == store().end() ) return false; aSecret = it->second; return true; }
bool KIPLATFORM::SECRETS::DeleteSecret( const wxString& aService, const wxString& aKey )
{ return store().erase( aService + ":" + aKey ) > 0; }
