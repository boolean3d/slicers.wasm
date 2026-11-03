# A static box (wxStaticBox / wxStaticBoxSizer) keeps the inner margins wxGTK 3 gives it (gtk/statbox.cpp
# GetBordersForSizer, __WXGTK3__): nothing on the sides and bottom, the label's height on top (nothing without a
# label). The univ port used the common fallback, 12 px on every side ("FIXME: hardcoded value") and 12 px on top
# for an empty label, so every framed group sat 12 px inside its frame: Bambu's Nozzle box on the printer card
# (StaticGroup, no label) was 24 px wider inside and taller than desktop.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/common/statboxcmn.cpp', '''void wxStaticBoxBase::GetBordersForSizer(int *borderTop, int *borderOther) const
{
    const int BORDER = FromDIP(12); // FIXME: hardcoded value
''', '''void wxStaticBoxBase::GetBordersForSizer(int *borderTop, int *borderOther) const
{
#ifdef __WXWASM__
    // as wxGTK 3: no side margins, the label's height on top
    *borderOther = 0;
    if ( m_labelWin )
        *borderTop = m_labelWin->GetSize().y;
    else
        *borderTop = GetLabel().empty() ? 0 : GetCharHeight();
    return;
#endif
    const int BORDER = FromDIP(12); // FIXME: hardcoded value
''')
