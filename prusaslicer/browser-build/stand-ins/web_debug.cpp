// Debug door for the look script: Module._orca_dump_windows(depth) prints every window (class, label,
// rect on the page, shown) down to that depth; windows labelled with the filter word print with their subtree.
#include <emscripten.h>
#include <wx/wx.h>
#include <cstdio>
#include <wx/scrolwin.h>

static void dump(wxWindow* w, int depth, int maxDepth)
{
    const wxRect r = w->GetScreenRect();
    const wxString label = w->GetLabel();
    const wxSize mn = w->GetMinSize(), sz = w->GetSizer() ? w->GetSizer()->GetMinSize() : wxSize(-9, -9);
    fprintf(stderr, "%*sWIN %s '%s' [%d,%d %dx%d] min %dx%d sizer %dx%d%s%s\n", depth * 2, "", (const char*)wxString(w->GetClassInfo()->GetClassName()).utf8_str(),
        (const char*)label.Left(30).utf8_str(), r.x, r.y, r.width, r.height, mn.x, mn.y, sz.x, sz.y, w->IsShown() ? "" : " hidden",
        w->IsShownOnScreen() ? "" : " offscreen");
    if (wxScrollHelper* sh = dynamic_cast<wxScrollHelper*>(w)) {
        int vx = 0, vy = 0; sh->GetViewStart(&vx, &vy);
        fprintf(stderr, "%*s  scrolled virtual %dx%d best virtual %dx%d view start %d,%d autolayout %d\n", depth * 2, "", w->GetVirtualSize().x, w->GetVirtualSize().y,
            w->GetBestVirtualSize().x, w->GetBestVirtualSize().y, vx, vy, (int)w->GetAutoLayout());
    }
    if (wxStaticText* st = dynamic_cast<wxStaticText*>(w)) {
        // the font a static text measures with (window) and draws with (paint DC), and each label line's width in both
        wxClientDC dc(w); dc.SetFont(w->GetFont());
        fprintf(stderr, "%*s  font '%s' own %d\n", depth * 2, "", (const char*)w->GetFont().GetNativeFontInfoDesc().utf8_str(), (int)st->GetFont().IsOk());
        for (const wxString& line : wxSplit(st->GetLabel(), '\n')) {
            int wx = 0, wy = 0, dx = 0, dy = 0; w->GetTextExtent(line, &wx, &wy); dc.GetTextExtent(line, &dx, &dy);
            fprintf(stderr, "%*s  line window %d dc %d '%s'\n", depth * 2, "", wx, dx, (const char*)line.Right(20).utf8_str());
        }
    }
    if (w->IsTopLevel()) fprintf(stderr, "%*s  style %lx client origin %d,%d\n", depth * 2, "", w->GetWindowStyleFlag(), w->GetClientAreaOrigin().x, w->GetClientAreaOrigin().y);
    if (depth >= maxDepth) return;
    for (wxWindow* c : w->GetChildren()) dump(c, depth + 1, maxDepth);
}

extern "C" EMSCRIPTEN_KEEPALIVE void orca_dump_windows(int maxDepth)
{
    for (wxWindow* w : wxTopLevelWindows) dump(w, 0, maxDepth);
    fflush(stderr);
}

// Module._orca_dump_scrolled(depth): only the shown scrolled windows at least 300 px wide, with their subtree
static void dumpScrolled(wxWindow* w, int maxDepth)
{
    if (dynamic_cast<wxScrollHelper*>(w) && w->IsShownOnScreen() && w->GetSize().x >= 300) { dump(w, 0, maxDepth); return; }
    for (wxWindow* c : w->GetChildren()) dumpScrolled(c, maxDepth);
}

extern "C" EMSCRIPTEN_KEEPALIVE void orca_dump_scrolled(int maxDepth)
{
    for (wxWindow* w : wxTopLevelWindows) dumpScrolled(w, maxDepth);
    fflush(stderr);
}

// Module._orca_relayout(): lay out every window that has a sizer again, top down (tells a stale layout
// from a wrong size).
static void relayout(wxWindow* w)
{
    if (w->GetSizer()) { w->InvalidateBestSize(); w->Layout(); }
    for (wxWindow* c : w->GetChildren()) relayout(c);
}

extern "C" EMSCRIPTEN_KEEPALIVE void orca_relayout()
{
    for (wxWindow* w : wxTopLevelWindows) relayout(w);
}

// An exception that ends the program (libc++abi is silent in this build): print its type and message.
#include <exception>
#include <typeinfo>
#include <cxxabi.h>
#include <cstdlib>
namespace {
struct WebTerminateLog {
    WebTerminateLog() {
        std::set_terminate([] {
            std::exception_ptr e = std::current_exception();
            const std::type_info* t = abi::__cxa_current_exception_type();
            fprintf(stderr, "TERMINATE type %s\n", t ? t->name() : "(no active exception)");
            if (e) {
                try { std::rethrow_exception(e); }
                catch (const std::exception& x) { fprintf(stderr, "TERMINATE what: %s\n", x.what()); }
                catch (...) {}
            }
            fflush(stderr);
            abort();
        });
    }
} web_terminate_log;
}

// Every C++ throw on a worker thread prints its type and the wasm stack (first 40): a throw that escapes a
// TBB task ends in private_worker::run's noexcept terminate with "no active exception". Linked with
// -Wl,--wrap=__cxa_throw.
#include <atomic>
#include <string>
#include <emscripten/threading.h>
extern "C" {
[[noreturn]] void __real___cxa_throw(void*, std::type_info*, void* (*)(void*));
[[noreturn]] void __wrap___cxa_throw(void* obj, std::type_info* t, void* (*dest)(void*))
{
    static std::atomic<int> n{0};
    if (!emscripten_is_main_runtime_thread() && n++ < 40) {
        int status = 0;
        char* name = abi::__cxa_demangle(t->name(), nullptr, nullptr, &status);
        EM_ASM({ console.error('WTHROW ' + UTF8ToString($0) + '\n' + new Error().stack.split('\n').slice(2, 40).join('\n')); }, name ? name : t->name());
        free(name);
    }
    __real___cxa_throw(obj, t, dest);
}
}

// Module._orca_hit(x, y): the window under a page point (wx's own hit test) with its parents, and the focused window
static void hitLine(const char* what, wxWindow* w)
{
    for (int d = 0; w && d < 12; w = w->GetParent(), ++d) {
        const wxRect r = w->GetScreenRect();
        fprintf(stderr, "HIT %s %d %s '%s' [%d,%d %dx%d]%s%s%s\n", what, d, (const char*)wxString(w->GetClassInfo()->GetClassName()).utf8_str(),
            (const char*)w->GetLabel().Left(20).utf8_str(), r.x, r.y, r.width, r.height, w->IsShown() ? "" : " hidden",
            w->IsEnabled() ? "" : " disabled", w->IsTopLevel() ? " TLW" : "");
    }
}
extern "C" EMSCRIPTEN_KEEPALIVE void orca_hit(int x, int y)
{
    hitLine("at", wxFindWindowAtPoint(wxPoint(x, y)));
    hitLine("focus", wxWindow::FindFocus());
    hitLine("capture", wxWindow::GetCapture());
    if (wxTextCtrl* t = wxDynamicCast(wxWindow::FindFocus(), wxTextCtrl)) {
        long f = 0, e = 0; t->GetSelection(&f, &e);
        fprintf(stderr, "HIT text '%s' caret %ld sel %ld-%ld\n", (const char*)t->GetValue().utf8_str(), t->GetInsertionPoint(), f, e);
    }
    fflush(stderr);
}
