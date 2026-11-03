# Copy and paste (his report 10-24: Ctrl+C / Ctrl+V do nothing anywhere). The port's wxClipboard was an empty stub
# ("TODO: implement": Open() false, so every Copy/Paste of every text box and every program that uses the clipboard
# did nothing). Now: the clipboard keeps text in the program, as wxGTK keeps what it owns, and a copy also goes to
# the computer's clipboard (navigator.clipboard.writeText). The computer's clipboard cannot be read when the program
# asks (the browser reads it only in a paste event, or after a permission prompt), so a paste key (Ctrl+V,
# Cmd+V, Shift+Insert) is not default-prevented: the browser fires its paste event, a page listener keeps the
# event's text, and the key reaches the program after that, with the clipboard holding the pasted text. Then a text
# box pastes, and a program's own Ctrl+V (3D view, lists) runs as before. A paste aimed at a page element of our own
# (an <input> etc.) is left to the browser. Run in owx or pwx. Needs WX=1.
import re

h = 'include/wx/wasm/clipbrd.h'
s = open(h).read()
if 'wxWasmTakeBrowserPaste' not in s:
    a = s.index('class WXDLLIMPEXP_CORE wxClipboard')
    b = s.index('#endif // wxUSE_CLIPBOARD')
    s = s[:a] + '''class WXDLLIMPEXP_CORE wxClipboard : public wxClipboardBase
{
public:
    wxClipboard();
    virtual ~wxClipboard();

    virtual bool Open() wxOVERRIDE;
    virtual void Close() wxOVERRIDE;
    virtual bool IsOpened() const wxOVERRIDE;
    virtual bool SetData(wxDataObject *data) wxOVERRIDE;
    virtual bool AddData(wxDataObject *data) wxOVERRIDE;
    virtual bool IsSupported(const wxDataFormat& format) wxOVERRIDE;
    virtual bool GetData(wxDataObject& data) wxOVERRIDE;
    virtual void Clear() wxOVERRIDE;
    virtual bool Flush() wxOVERRIDE;

private:
    bool m_open;

    wxDECLARE_DYNAMIC_CLASS(wxClipboard);
};

// The text of the browser's last paste event (if one came since the last call) becomes the clipboard's text.
void wxWasmTakeBrowserPaste();
// Keeps the text of every paste event of the program's page (once, at start).
void wxWasmListenForPaste();

''' + s[b:]
    open(h, 'w').write(s)

c = 'src/wasm/clipbrd.cpp'
s = open(c).read()
if 'wxWasmTakeBrowserPaste' not in s:
    a = s.index('IMPLEMENT_DYNAMIC_CLASS(wxClipboard, wxClipboardBase)')
    s = s[:a].replace('#ifndef WX_PRECOMP\n#endif // WX_PRECOMP', '''#ifndef WX_PRECOMP
#endif // WX_PRECOMP

#include "wx/dataobj.h"

#include <emscripten.h>''') + '''IMPLEMENT_DYNAMIC_CLASS(wxClipboard, wxClipboardBase)

namespace
{
wxString gText;     // the clipboard's text: the program's last copy, or the browser's last paste
bool gHasText = false;

wxTextDataObject *AsText(wxDataObject *data)
{
    if ( wxTextDataObject *t = dynamic_cast<wxTextDataObject *>(data) )
        return t;
    if ( wxDataObjectComposite *c = dynamic_cast<wxDataObjectComposite *>(data) )
    {
        if ( wxTextDataObject *t = dynamic_cast<wxTextDataObject *>(c->GetObject(wxDF_UNICODETEXT)) )
            return t;
        return dynamic_cast<wxTextDataObject *>(c->GetObject(wxDF_TEXT));
    }
    return NULL;
}

bool IsText(const wxDataFormat& format)
{
    return format == wxDF_TEXT || format == wxDF_UNICODETEXT || format == wxDF_OEMTEXT;
}
}

void wxWasmTakeBrowserPaste()
{
    const int n = EM_ASM_INT({
        var t = Module.wxWasmPasted;
        return t === undefined || t === null ? -1 : t.length * 3 + 1;   // UTF-8 bytes at most, and the 0
    });
    if ( n < 0 )
        return;
    char *text = (char *)malloc(n);
    EM_ASM({ stringToUTF8(Module.wxWasmPasted, $0, $1); Module.wxWasmPasted = null; }, text, n);
    gText = wxString::FromUTF8(text);
    gHasText = !gText.empty();
    free(text);
}

void wxWasmListenForPaste()
{
    // The paste event's text, kept for the key that caused it (app.cpp lets a paste key through to the browser).
    // Only for the program's page: a paste into an element of the page itself (a text field) is the browser's.
    EM_ASM({
        if (Module.wxWasmPasteListener) return;
        Module.wxWasmPasteListener = function (e) {
            var t = e.target;
            if (t && t.nodeType === 1 && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
            Module.wxWasmPasted = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
            e.preventDefault();
        };
        window.addEventListener('paste', Module.wxWasmPasteListener, true);
    });
}

wxClipboard::wxClipboard() : m_open(false)
{
}

wxClipboard::~wxClipboard()
{
}

bool wxClipboard::Open()
{
    if ( m_open )
        return false;
    m_open = true;
    return true;
}

void wxClipboard::Close()
{
    m_open = false;
}

bool wxClipboard::IsOpened() const
{
    return m_open;
}

bool wxClipboard::SetData(wxDataObject *data)
{
    Clear();
    return AddData(data);
}

bool wxClipboard::AddData(wxDataObject *data)
{
    wxCHECK_MSG( data, false, wxT("data is invalid") );
    wxTextDataObject *t = AsText(data);
    const bool ok = t != NULL;
    if ( ok )
    {
        gText = t->GetText();
        gHasText = true;
        // the computer's clipboard too (allowed while the page has the focus; refused quietly otherwise)
        EM_ASM({
            try { navigator.clipboard.writeText(UTF8ToString($0)).catch(function () {}); } catch (e) {}
        }, (const char *)gText.utf8_str());
    }
    delete data;    // the clipboard owns what it is given
    return ok;
}

bool wxClipboard::IsSupported(const wxDataFormat& format)
{
    return gHasText && IsText(format);
}

bool wxClipboard::GetData(wxDataObject& data)
{
    wxTextDataObject *t = AsText(&data);
    if ( !gHasText || !t )
        return false;
    t->SetText(gText);
    return true;
}

void wxClipboard::Clear()
{
    gText.clear();
    gHasText = false;
}

bool wxClipboard::Flush()
{
    return true;
}
'''
    open(c, 'w').write(s)

p = 'src/wasm/app.cpp'
s = open(p).read()
if 'wxWasmTakeBrowserPaste' not in s:
    a = '''    const EmscriptenKeyboardEvent copy = *e;
    wxWasmQueueUserInput([=]() { KeyCallbackNow(eventType, &copy, userData); });
    return true;
}'''
    b = '''    const EmscriptenKeyboardEvent copy = *e;
    // A paste key: the browser fires its paste event only when the key is not default-prevented, and only that event
    // can read the computer's clipboard (wx/wasm/clipbrd.h). The key reaches the program after the event.
    const char k = e->key[0];
    const bool pasteKey = eventType == EMSCRIPTEN_EVENT_KEYDOWN && !e->altKey &&
        (((e->ctrlKey || e->metaKey) && (k == 'v' || k == 'V') && e->key[1] == 0) ||
         (e->shiftKey && !e->ctrlKey && !e->metaKey && std::strcmp(e->key, "Insert") == 0));
    if (pasteKey)
    {
        wxWasmQueueUserInput([=]() { wxWasmTakeBrowserPaste(); KeyCallbackNow(eventType, &copy, userData); });
        return false;
    }
    wxWasmQueueUserInput([=]() { KeyCallbackNow(eventType, &copy, userData); });
    return true;
}'''
    assert s.count(a) == 1, p
    s = s.replace(a, b)
    a = 'void RegisterEmscriptenCallbacks(wxApp* app)\n{\n    EMSCRIPTEN_RESULT result;\n'
    assert s.count(a) == 1, p + ' RegisterEmscriptenCallbacks'
    s = s.replace(a, a + '\n    wxWasmListenForPaste();\n')
    if '#include "wx/clipbrd.h"' not in s:
        s = s.replace('#include "wx/app.h"', '#include "wx/app.h"\n#include "wx/clipbrd.h"', 1)
        assert '#include "wx/clipbrd.h"' in s, 'app.cpp include'
    open(p, 'w').write(s)
