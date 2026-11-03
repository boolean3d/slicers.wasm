# DrawText with '\n' in the text draws one line per piece on a wasm DC, as wxMSW (src/msw/dc.cpp DoDrawText), wxGCDC
# (src/common/dcgraph.cpp) and wxGTK (Pango) do: the text goes to the generic DrawLabel(), which calls back here with
# single lines only. Before, the port handed the whole string to canvas fillText, which draws a line break as nothing:
# Orca/Bambu RecenterDialog ("Please home all axes ... and causing equipment wear.") breaks its own text with '\n' and
# showed one long line cut off at the dialog edge, the last line missing..
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/dc.cpp', '''void wxWasmDCImpl::DoDrawText(const wxString& text, wxCoord x, wxCoord y)
{
    wxCHECK_RET(IsOk(), wxT("invalid dc"));
''', '''void wxWasmDCImpl::DoDrawText(const wxString& text, wxCoord x, wxCoord y)
{
    wxCHECK_RET(IsOk(), wxT("invalid dc"));

    // multiline strings: as wxMSW, let the generic DrawLabel() split them; it calls back with single lines only
    if ( text.find('\\n') != wxString::npos )
    {
        GetOwner()->DrawLabel(text, wxRect(x, y, 0, 0));
        return;
    }
''')
