/////////////////////////////////////////////////////////////////////////////
// Name:        wx/wasm/dirdlg.h
// Purpose:     wxDirDialog for the browser: a browser saves into its own downloads, so a folder chosen to save into
//              is that downloads folder (wx/wasm/filedlg.h); every file written there goes to the browser as a download
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#ifndef _WX_WASM_DIRDLG_H_
#define _WX_WASM_DIRDLG_H_

class WXDLLIMPEXP_CORE wxDirDialog : public wxDirDialogBase
{
public:
    wxDirDialog() { }
    wxDirDialog(wxWindow *parent,
                const wxString& message = wxASCII_STR(wxDirSelectorPromptStr),
                const wxString& defaultPath = wxEmptyString,
                long style = wxDD_DEFAULT_STYLE,
                const wxPoint& pos = wxDefaultPosition,
                const wxSize& size = wxDefaultSize,
                const wxString& name = wxASCII_STR(wxDirDialogNameStr))
        : wxDirDialogBase(parent, message, defaultPath, style, pos, size, name) { }

    virtual int ShowModal() wxOVERRIDE;

private:
    wxDECLARE_DYNAMIC_CLASS(wxDirDialog);
};

#endif // _WX_WASM_DIRDLG_H_
