/////////////////////////////////////////////////////////////////////////////
// Name:        src/wasm/secretstore.cpp
// Purpose:     wxSecretStore for the wasm port. The browser's own lasting storage
//              for this site (localStorage) plays the system keyring: kept on this
//              computer across reloads and browser restarts, never sent anywhere
//              (desktop: Windows Credential Manager / libsecret / Keychain).
//              localStorage is the page's only: with main() in a worker (off-thread
//              recipe) every call is run on the page thread (MAIN_THREAD_EM_ASM).
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#include "wx/wxprec.h"

#if wxUSE_SECRETSTORE

#include "wx/secretstore.h"
#include "wx/private/secretstore.h"

#include <map>
#include <string>

#include <emscripten.h>

namespace
{

// localStorage "b3d-secret:<service>" = "<user>\n<secret as hex>"
const char* const KEY_PREFIX = "b3d-secret:";

std::string ToHex(const std::string& in)
{
    static const char digits[] = "0123456789abcdef";
    std::string out;
    out.reserve(in.size() * 2);
    for ( unsigned char c : in )
    {
        out += digits[c >> 4];
        out += digits[c & 15];
    }
    return out;
}

std::string FromHex(const std::string& in)
{
    std::string out;
    for ( size_t i = 0; i + 1 < in.size(); i += 2 )
        out += static_cast<char>(std::stoi(in.substr(i, 2), nullptr, 16));
    return out;
}

void StoreSet(const std::string& key, const std::string& value)
{
    MAIN_THREAD_EM_ASM({
        try { if (typeof localStorage !== 'undefined') localStorage.setItem(UTF8ToString($0), UTF8ToString($1)); }
        catch (e) { console.log('password store: not kept (' + e.message + ')'); }
    }, key.c_str(), value.c_str());
}

bool StoreGet(const std::string& key, std::string* value)
{
    char* const got = static_cast<char*>(MAIN_THREAD_EM_ASM_PTR({
        try {
            if (typeof localStorage === 'undefined') return 0;
            var v = localStorage.getItem(UTF8ToString($0));
            return v === null ? 0 : stringToNewUTF8(v);
        } catch (e) { return 0; }
    }, key.c_str()));
    if ( !got )
        return false;
    *value = got;
    free(got);
    return true;
}

void StoreRemove(const std::string& key)
{
    MAIN_THREAD_EM_ASM({
        try { if (typeof localStorage !== 'undefined') localStorage.removeItem(UTF8ToString($0)); } catch (e) {}
    }, key.c_str());
}

class wxSecretStoreMemoryImpl : public wxSecretStoreImpl
{
public:
    virtual bool Save(const wxString& service, const wxString& username,
                      const wxSecretValueImpl& password, wxString& WXUNUSED(errmsg)) wxOVERRIDE
    {
        Entry& e = m_entries[service];
        e.user = username;
        e.secret.assign(static_cast<const char*>(password.GetData()), password.GetSize());
        StoreSet(KEY_PREFIX + std::string(service.utf8_str()), std::string(username.utf8_str()) + "\n" + ToHex(e.secret));
        return true;
    }

    virtual bool Load(const wxString& service, wxString* username,
                      wxSecretValueImpl** password, wxString& WXUNUSED(errmsg)) const wxOVERRIDE
    {
        auto it = m_entries.find(service);
        if ( it == m_entries.end() )
        {
            std::string kept;
            if ( !StoreGet(KEY_PREFIX + std::string(service.utf8_str()), &kept) )
                return false;
            const size_t nl = kept.find('\n');
            if ( nl == std::string::npos )
                return false;
            Entry& e = m_entries[service];
            e.user = wxString::FromUTF8(kept.substr(0, nl));
            e.secret = FromHex(kept.substr(nl + 1));
            it = m_entries.find(service);
        }
        *username = it->second.user;
        *password = new wxSecretValueGenericImpl(it->second.secret.size(), it->second.secret.data());
        return true;
    }

    virtual bool Delete(const wxString& service, wxString& WXUNUSED(errmsg)) wxOVERRIDE
    {
        StoreRemove(KEY_PREFIX + std::string(service.utf8_str()));
        return m_entries.erase(service) != 0;
    }

private:
    struct Entry { wxString user; std::string secret; };
    mutable std::map<wxString, Entry> m_entries;   // what Load read from the browser's store is kept here
};

} // anonymous namespace

/* static */
#if wxCHECK_VERSION(3, 2, 0)
// 3.2: the common code's 2-argument NewImpl calls this one; the content type is libsecret's, unused here
wxSecretValueImpl* wxSecretValue::NewImpl(size_t size, const void *data, const char* WXUNUSED(contentType))
#else
wxSecretValueImpl* wxSecretValue::NewImpl(size_t size, const void *data)
#endif
{
    return new wxSecretValueGenericImpl(size, data);
}

/* static */
wxSecretStore wxSecretStore::GetDefault()
{
    static wxSecretStoreMemoryImpl* const impl = []() {
        wxSecretStoreMemoryImpl* p = new wxSecretStoreMemoryImpl;
        p->IncRef();   // the page's one store lives as long as the page
        return p;
    }();
    impl->IncRef();
    return wxSecretStore(impl);
}

#endif // wxUSE_SECRETSTORE
