# A clipping box set on a wasm DC clips where it was asked, on wx 3.2 too. wx 3.2's wxDCImpl::DoSetClippingRegion
# keeps the box in private DEVICE coordinates (m_devClipX1..X2, read back via DoGetClippingRect) and no longer fills the logical
# m_clipX1..X2 the wasm port read (wx 3.1 did), so every SetClippingRegion clipped to a 0x0 box: wxUniv list boxes
# (wxControlRenderer::DoDrawItems clips to the client rect) drew no items at all - PrusaSlicer's setup wizard
# Filaments page (Printer/Type/Vendor/Profile lists) stayed empty. wx 3.1 (Bambu/Orca) unchanged.
# DestroyClippingRegion also runs the base reset, as the other ports do..
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/wasm/dc.cpp', '''    wxDCImpl::DoSetClippingRegion(x, y, width, height);

    EM_ASM({
        clipRect($0, $1, $2, $3, $4);
    }, GetJavascriptId(),
       LogicalToDeviceDoubleX(m_clipX1),
       LogicalToDeviceDoubleY(m_clipY1),
       LogicalToDeviceXRel(m_clipX2 - m_clipX1),
       LogicalToDeviceYRel(m_clipY2 - m_clipY1));
}''', '''    wxDCImpl::DoSetClippingRegion(x, y, width, height);

#if wxCHECK_VERSION(3, 2, 0)
    // wx 3.2 keeps the (intersected) box in private device coordinates; read it back the documented way
    wxRect box;
    wxDCImpl::DoGetClippingRect(box);
    EM_ASM({
        clipRect($0, $1, $2, $3, $4);
    }, GetJavascriptId(),
       LogicalToDeviceX(box.x), LogicalToDeviceY(box.y),
       LogicalToDeviceXRel(box.width), LogicalToDeviceYRel(box.height));
#else
    EM_ASM({
        clipRect($0, $1, $2, $3, $4);
    }, GetJavascriptId(),
       LogicalToDeviceDoubleX(m_clipX1),
       LogicalToDeviceDoubleY(m_clipY1),
       LogicalToDeviceXRel(m_clipX2 - m_clipX1),
       LogicalToDeviceYRel(m_clipY2 - m_clipY1));
#endif
}''')

sub('src/wasm/dc.cpp', '''void wxWasmDCImpl::DestroyClippingRegion()
{
    m_clipping = false;
''', '''void wxWasmDCImpl::DestroyClippingRegion()
{
    wxDCImpl::DestroyClippingRegion();
''')
