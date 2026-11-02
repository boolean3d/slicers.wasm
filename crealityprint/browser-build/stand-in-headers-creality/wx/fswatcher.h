// wxFileSystemWatcher for a wx built without it (the browser's wx: wxUSE_FSWATCHER 0, as in the wx 3.1 port: a tab
// has no file change notifications). Creality Print's GUI_App watches its Creality Cloud user file with one; here the
// watcher accepts the request and never reports a change (the tab has no cloud sign-in that would write the file).
// With a wx that has the watcher, wx's own header is used.
#pragma once
#include_next <wx/fswatcher.h>
#if !wxUSE_FSWATCHER
#include <wx/event.h>
#include <wx/filename.h>

enum wxFSWFlags {
    wxFSW_EVENT_CREATE = 0x01, wxFSW_EVENT_DELETE = 0x02, wxFSW_EVENT_RENAME = 0x04, wxFSW_EVENT_MODIFY = 0x08,
    wxFSW_EVENT_ACCESS = 0x10, wxFSW_EVENT_ATTRIB = 0x20, wxFSW_EVENT_WARNING = 0x40, wxFSW_EVENT_ERROR = 0x80,
    wxFSW_EVENT_ALL = 0xFF
};

class wxFileSystemWatcherEvent : public wxEvent {
public:
    explicit wxFileSystemWatcherEvent(int change_type = 0, int id = wxID_ANY);
    wxEvent* Clone() const override { return new wxFileSystemWatcherEvent(*this); }
    int GetChangeType() const { return m_change_type; }
    const wxFileName& GetPath() const { return m_path; }
    const wxFileName& GetNewPath() const { return m_path; }
private:
    int        m_change_type;
    wxFileName m_path;
};
inline const wxEventTypeTag<wxFileSystemWatcherEvent> wxEVT_FSWATCHER(wxNewEventType());
inline wxFileSystemWatcherEvent::wxFileSystemWatcherEvent(int change_type, int id)
    : wxEvent(id, wxEVT_FSWATCHER), m_change_type(change_type) {}

class wxFileSystemWatcher : public wxEvtHandler {
public:
    bool Add(const wxFileName&, int = wxFSW_EVENT_ALL) { return true; }
    bool AddTree(const wxFileName&, int = wxFSW_EVENT_ALL, const wxString& = wxString()) { return true; }
    bool Remove(const wxFileName&) { return true; }
    bool RemoveAll() { return true; }
    void SetOwner(wxEvtHandler*) {}
};
#endif // !wxUSE_FSWATCHER
