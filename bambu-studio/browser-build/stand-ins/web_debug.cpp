// Debug door for the look script: Module._orca_dump_windows(depth) prints every window (class, label,
// rect on the page, shown) down to that depth; windows labelled with the filter word print with their subtree.
#include <emscripten.h>
#include <wx/wx.h>
#include <cstdio>

static void dump(wxWindow* w, int depth, int maxDepth)
{
    const wxRect r = w->GetScreenRect();
    const wxString label = w->GetLabel();
    const wxSize mn = w->GetMinSize(), sz = w->GetSizer() ? w->GetSizer()->GetMinSize() : wxSize(-9, -9);
    fprintf(stderr, "%*sWIN %s '%s' [%d,%d %dx%d] min %dx%d sizer %dx%d%s%s%s\n", depth * 2, "", (const char*)wxString(w->GetClassInfo()->GetClassName()).utf8_str(),
        (const char*)label.Left(30).utf8_str(), r.x, r.y, r.width, r.height, mn.x, mn.y, sz.x, sz.y, w->IsShown() ? "" : " hidden",
        w->IsShownOnScreen() ? "" : " offscreen", w->IsEnabled() ? "" : " DISABLED");
    if (depth >= maxDepth) return;
    for (wxWindow* c : w->GetChildren()) dump(c, depth + 1, maxDepth);
}

extern "C" EMSCRIPTEN_KEEPALIVE void orca_dump_windows(int maxDepth)
{
    wxWindow* cap = wxWindow::GetCapture();
    fprintf(stderr, "CAPTURE %p '%s'\n", (void*)cap, cap ? (const char*)cap->GetName().utf8_str() : "");
    wxWindow* foc = wxWindow::FindFocus();
    fprintf(stderr, "FOCUS %s '%s' in %s\n", foc ? (const char*)wxString(foc->GetClassInfo()->GetClassName()).utf8_str() : "-",
        foc ? (const char*)foc->GetName().utf8_str() : "", foc && wxGetTopLevelParent(foc) ? (const char*)wxGetTopLevelParent(foc)->GetLabel().Left(30).utf8_str() : "-");
    for (wxWindow* w : wxTopLevelWindows) dump(w, 0, maxDepth);
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

// Module._orca_window_at(x, y): the window under a page point and its parents (class, name, rect, colours,
// style flags), topmost shown top-level window first; finds which widget draws a wrong pixel.
static wxWindow* deepest_at(wxWindow* w, const wxPoint& p)
{
    if (!w->IsShown() || !w->GetScreenRect().Contains(p)) return nullptr;
    wxWindowList kids = w->GetChildren();
    for (auto it = kids.rbegin(); it != kids.rend(); ++it)
        if (!(*it)->IsTopLevel())
            if (wxWindow* d = deepest_at(*it, p)) return d;
    return w;
}

extern "C" EMSCRIPTEN_KEEPALIVE void orca_window_at(int x, int y)
{
    const wxPoint p(x, y);
    for (auto it = wxTopLevelWindows.rbegin(); it != wxTopLevelWindows.rend(); ++it) {
        wxWindow* d = deepest_at(*it, p);
        if (!d) continue;
        fprintf(stderr, "AT %d,%d in %s '%s' style=%lx\n", x, y, (const char*)wxString((*it)->GetClassInfo()->GetClassName()).utf8_str(), (const char*)(*it)->GetLabel().Left(30).utf8_str(), (*it)->GetWindowStyle());
        for (wxWindow* w = d; w; w = w->GetParent()) {
            const wxRect r = w->GetScreenRect();
            fprintf(stderr, "  %s '%s' name=%s [%d,%d %dx%d] bg=%s%s fg=%s style=%lx transparent=%d\n",
                (const char*)wxString(w->GetClassInfo()->GetClassName()).utf8_str(), (const char*)w->GetLabel().Left(30).utf8_str(),
                (const char*)w->GetName().utf8_str(), r.x, r.y, r.width, r.height,
                (const char*)w->GetBackgroundColour().GetAsString(wxC2S_HTML_SYNTAX).utf8_str(), w->UseBgCol() ? "(set)" : "",
                (const char*)w->GetForegroundColour().GetAsString(wxC2S_HTML_SYNTAX).utf8_str(), w->GetWindowStyle(), (int)w->HasTransparentBackground());
            wxBitmap bmp;
            if (auto* b = wxDynamicCast(w, wxAnyButton)) bmp = b->GetBitmap();
            else if (auto* sb = wxDynamicCast(w, wxStaticBitmap)) bmp = sb->GetBitmap();
            fprintf(stderr, "    shown=%d tip='%s' bitmap=%dx%d sizerItem=%d\n", (int)w->IsShown(),
                (const char*)w->GetToolTipText().Left(40).utf8_str(), bmp.IsOk() ? bmp.GetWidth() : -1, bmp.IsOk() ? bmp.GetHeight() : -1,
                (int)(w->GetContainingSizer() != nullptr));
            if (w->IsTopLevel()) break;
        }
    }
    fflush(stderr);
}
