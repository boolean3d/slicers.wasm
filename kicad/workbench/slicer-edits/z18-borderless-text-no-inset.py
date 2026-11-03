# A borderless text box (wxBORDER_NONE) draws its text from its own edge, as native ones do (wxMSW EDIT without
# WS_BORDER, GtkEntry with has-frame false). The wasm theme inset EVERY text box by 4 px on each side
# (GetTextBorderWidth), so a box sized to its text, like Bambu's Device tab temperature boxes
# (TempInput::DoSetSize: text_ctrl->SetSize(GetTextExtent("0000"))), lost 8 px of height and the typed target was
# cut at the bottom. Framed boxes keep the 4 px..
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/univ/themes/wasm.cpp', '''int wxWasmRenderer::GetTextBorderWidth(const wxTextCtrl * WXUNUSED(text)) const
{
    return 4;
}''', '''int wxWasmRenderer::GetTextBorderWidth(const wxTextCtrl *text) const
{
    // a borderless box draws its text from its own edge, as native ones do
    if ( text && text->GetBorder() == wxBORDER_NONE )
        return 0;
    return 4;
}''')
