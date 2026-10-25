/////////////////////////////////////////////////////////////////////////////
// Name:        wx/wasm/filedlg.h
// Purpose:     wxFileDialog for the browser: Open = the browser's file picker,
//              Save = a download (the program writes the file, the browser saves it)
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#ifndef _WX_WASM_FILEDLG_H_
#define _WX_WASM_FILEDLG_H_

// Where saved files are written; each file closed or renamed here goes to the browser as a download.
#define wxWASM_DOWNLOAD_DIR "/home/web_user/Downloads"
// Where picked files are copied so the program can open them by path.
#define wxWASM_UPLOAD_DIR "/home/web_user/Uploads"

class WXDLLIMPEXP_CORE wxFileDialog : public wxFileDialogBase
{
public:
    wxFileDialog() { }
    wxFileDialog(wxWindow *parent,
                 const wxString& message = wxASCII_STR(wxFileSelectorPromptStr),
                 const wxString& defaultDir = wxEmptyString,
                 const wxString& defaultFile = wxEmptyString,
                 const wxString& wildCard = wxASCII_STR(wxFileSelectorDefaultWildcardStr),
                 long style = wxFD_DEFAULT_STYLE,
                 const wxPoint& pos = wxDefaultPosition,
                 const wxSize& sz = wxDefaultSize,
                 const wxString& name = wxASCII_STR(wxFileDialogNameStr))
    {
        Create(parent, message, defaultDir, defaultFile, wildCard, style, pos, sz, name);
    }

    virtual int ShowModal() wxOVERRIDE;
    virtual void GetPaths(wxArrayString& paths) const wxOVERRIDE;
    virtual void GetFilenames(wxArrayString& files) const wxOVERRIDE;

private:
    wxArrayString m_fileNames;   // Open with wxFD_MULTIPLE: every picked file (names in m_dir)

    wxDECLARE_DYNAMIC_CLASS(wxFileDialog);
};

#endif // _WX_WASM_FILEDLG_H_
