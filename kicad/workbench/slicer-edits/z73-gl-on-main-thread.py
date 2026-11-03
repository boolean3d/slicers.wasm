# The port's GL state lives on the main thread (z73. A wxGLContext is a WebGL context plus a)
# page canvas element, and both exist only in the JavaScript of the worker that made them (Emscripten's GL.contexts,
# wx.js's canvas map, the element id counter). A program whose GL windows are made on another thread (KiCad: a tool runs
# on its own thread, so a dialog it opens with a GL preview, the symbol chooser, made its context in that thread's
# worker) got a context the main thread could not draw with ("setting bitmap font sampler ... invalid operation") and
# whose destructor, run on the main thread, threw in GL.deleteContext inside a noexcept destructor: std::terminate
# (chooser OK or Cancel killed KiCad).
# Now every wxGLContext entry point (create, destroy, make current, place over its canvas, detach) runs on wx's main
# thread. The hand-over belongs to the program's threading layer, which knows how its main thread waits: it defines
# wxWasmRunOnMainThread(fn, arg) (runs fn(arg) on the main thread while the caller waits; KiCad: spike
# stubs/libcontext_threads.cpp, the same hand-over its EM_ASM calls use). The symbol is weak: a program without it (the
# slicers: GL only on the main thread) runs everything where it is called, as before. Only lines are added.
import sys
p = 'src/wasm/glcanvas.cpp'
s = open(p).read()
if '(z73)' in s:
    sys.exit(0)

def sub(a, b):
    global s
    if s.count(a) != 1:
        print('z73: anchor not found once in', p, ':', a[:60].strip(), ', skipped'); sys.exit(0)
    s = s.replace(a, b, 1)

# the hand-over
a = 'static int TopLevelId(const wxWindow& win)\n'
sub(a, '''// (z73) GL contexts and their canvas elements exist in the main thread's worker only: their entry points run there
extern "C" void wxWasmRunOnMainThread(void (*fn)(void *), void *arg) __attribute__((weak));
template <typename F>
static bool wxglOnMain(F& work)
{
#if wxUSE_THREADS
    if (!wxIsMainThread() && wxWasmRunOnMainThread)
    {
        wxWasmRunOnMainThread([](void *p) { (*static_cast<F *>(p))(); }, &work);
        return true;
    }
#endif
    return false;
}

''' + a)

# constructor: the body in a lambda that runs on the main thread
sub('''    : m_handle(0), m_elementId(0), m_lastHost(0), m_lastShown(false), m_lastScale(0)
{
    m_isOk = false;
''', '''    : m_handle(0), m_elementId(0), m_lastHost(0), m_lastShown(false), m_lastScale(0)
{
    m_isOk = false;
    auto body = [&]() {   // (z73)
''')
sub('''    gs_placed[win] = this;
    PlaceOver(*win);
}
''', '''    gs_placed[win] = this;
    PlaceOver(*win);
    };
    if (!wxglOnMain(body)) body();   // (z73)
}
''')

sub('''wxGLContext::~wxGLContext()
{
''', '''wxGLContext::~wxGLContext()
{
    auto body = [&]() {   // (z73)
''')
sub('''    if (m_elementId)
        wxglDestroyElement(m_elementId);
}
''', '''    if (m_elementId)
        wxglDestroyElement(m_elementId);
    };
    if (!wxglOnMain(body)) body();   // (z73)
}
''')

sub('''bool wxGLContext::SetCurrent(const wxGLCanvas& win) const
{
''', '''bool wxGLContext::SetCurrent(const wxGLCanvas& win) const
{
    bool made = false;   // (z73)
    auto onMain = [&]() { made = SetCurrent(win); };
    if (wxglOnMain(onMain)) return made;
''')

sub('''void wxGLContext::PlaceOver(const wxGLCanvas& win) const
{
''', '''void wxGLContext::PlaceOver(const wxGLCanvas& win) const
{
    auto onMain = [&]() { PlaceOver(win); };   // (z73)
    if (wxglOnMain(onMain)) return;
''')

sub('''void wxGLContext::Detach() const
{
''', '''void wxGLContext::Detach() const
{
    auto onMain = [&]() { Detach(); };   // (z73)
    if (wxglOnMain(onMain)) return;
''')

if '#include "wx/thread.h"' not in s:
    sub('#include "wx/toplevel.h"\n', '#include "wx/toplevel.h"\n#include "wx/thread.h"   // (z73)\n')
open(p, 'w').write(s)
print('z73: GL entry points on the main thread')
