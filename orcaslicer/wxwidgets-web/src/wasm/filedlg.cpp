/////////////////////////////////////////////////////////////////////////////
// Name:        src/wasm/filedlg.cpp
// Purpose:     wxFileDialog for the browser (see wx/wasm/filedlg.h)
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#include "wx/wxprec.h"

#if wxUSE_FILEDLG

#include "wx/filedlg.h"
#include "wx/filename.h"
#include "wx/tokenzr.h"

#include <emscripten.h>
#include <stdlib.h>

wxIMPLEMENT_DYNAMIC_CLASS(wxFileDialog, wxFileDialogBase);

// Both run on the page (bulk/page-bridge-web.js): main() runs in a worker, and the browser's picker, the DOM and
// Emscripten's FS (the worker's file syscalls are proxied to it) are on the page.
extern "C" {
    // Every file written (closed after writing) or renamed into dir is handed to the browser as a download, once it
    // has been quiet for half a second (a program that writes, closes and appends gives one download). Files ending
    // in .tmp wait for their rename. Hooks FS.close/FS.rename on the page; installed once.
    void wxWasmWatchDownloads(const char *dir) __asm__("wxpage_fd_watch_downloads");
    // The browser's file picker; picked files are copied into dir. Returns their names joined by '\n'
    // (malloc'd on the page, freed here), or 0 when nothing was picked or the wait ran out (10 min). The page
    // awaits the picker while this thread blocks: only call it from main's chain (the wx event loop), never from a
    // proxied task or a message handler (R13). Without user activation left (5 s after the gesture) the page opens
    // the picker on the user's next click or key (R16).
    char *wxWasmPickFiles(const char *accept, int multiple, const char *dir) __asm__("wxpage_fd_pick");
}

// "STL files (*.stl;*.STL)|*.stl;*.STL|All files|*.*" -> ".stl,.STL" (empty when any file is allowed)
static wxString AcceptFromWildcard(const wxString& wildCard)
{
    wxArrayString descriptions, filters;
    wxParseCommonDialogsFilter(wildCard, descriptions, filters);
    wxArrayString exts;
    for (size_t i = 0; i < filters.size(); ++i)
    {
        wxStringTokenizer tk(filters[i], ";");
        while (tk.HasMoreTokens())
        {
            wxString pattern = tk.GetNextToken().Trim().Trim(false);
            if (pattern == "*" || pattern == "*.*")
                return wxString();
            if (pattern.StartsWith("*.") && exts.Index(pattern.Mid(1)) == wxNOT_FOUND)
                exts.Add(pattern.Mid(1));
        }
    }
    return wxJoin(exts, ',', '\0');
}

int wxFileDialog::ShowModal()
{
    if (HasFlag(wxFD_SAVE))
    {
        // A browser saves into its own downloads; the program writes there and the browser takes it.
        wxFileName::Mkdir(wxWASM_DOWNLOAD_DIR, wxS_DIR_DEFAULT, wxPATH_MKDIR_FULL);
        wxWasmWatchDownloads(wxWASM_DOWNLOAD_DIR);
        if (m_fileName.empty())
            m_fileName = "untitled";
        m_dir = wxWASM_DOWNLOAD_DIR;
        m_path = m_dir + "/" + m_fileName;
        return wxID_OK;
    }

    char *picked = wxWasmPickFiles(AcceptFromWildcard(m_wildCard).utf8_str(), HasFlag(wxFD_MULTIPLE), wxWASM_UPLOAD_DIR);
    if (!picked)
        return wxID_CANCEL;
    m_fileNames = wxSplit(wxString::FromUTF8(picked), '\n', '\0');
    free(picked);
    m_dir = wxWASM_UPLOAD_DIR;
    m_fileName = m_fileNames[0];
    m_path = m_dir + "/" + m_fileName;
    return wxID_OK;
}

void wxFileDialog::GetPaths(wxArrayString& paths) const
{
    paths.Empty();
    if (m_fileNames.empty()) { paths.Add(m_path); return; }
    for (size_t i = 0; i < m_fileNames.size(); ++i)
        paths.Add(m_dir + "/" + m_fileNames[i]);
}

void wxFileDialog::GetFilenames(wxArrayString& files) const
{
    files = m_fileNames;
    if (files.empty())
        files.Add(m_fileName);
}

#endif // wxUSE_FILEDLG
