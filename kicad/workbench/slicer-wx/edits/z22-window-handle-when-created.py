# A created window has a handle, as on desktop. wx code treats GetHandle() == NULL as "this window was never
# created": wxWindowBase::Destroy skips the destroy event, wxTopLevelWindow::Destroy deletes at once instead of at
# the next idle, wxDisplay::GetFromWindow gives up. The wasm port returned NULL for every window, so all of that
# took the never-created path. Bambu Studio's Label::Wrap (Widgets/Label.cpp) returns early on a NULL handle, so
# every auto-wrapping label stayed empty when its text was set later: the printer's error box ("Info") showed no
# words. The handle is the window itself (nothing native behind it); NULL until Create() has run.
# Run in owx (or pwx).
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('include/wx/wasm/window.h', '''    virtual WXWidget GetHandle() const wxOVERRIDE { return NULL; }''',
'''    virtual WXWidget GetHandle() const wxOVERRIDE { return m_wasmCreated ? (WXWidget)this : NULL; }''')
sub('include/wx/wasm/window.h', '''    bool m_selfNeedsPaint;''', '''    bool m_selfNeedsPaint;
    bool m_wasmCreated;    // Create() has run: GetHandle() is not NULL''')
sub('src/wasm/window.cpp', '''    m_childNeedsPaint = true;
    m_selfNeedsPaint = true;
}''', '''    m_childNeedsPaint = true;
    m_selfNeedsPaint = true;
    m_wasmCreated = false;
}''')
sub('src/wasm/window.cpp', '''    if (!CreateBase(parent, id, pos, size, style, wxDefaultValidator, name))
    {
        return false;
    }
''', '''    if (!CreateBase(parent, id, pos, size, style, wxDefaultValidator, name))
    {
        return false;
    }
    m_wasmCreated = true;
''')
