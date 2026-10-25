// The slicer door: a script (or Claude, through scripts/slicer-door) works Bambu Studio in the tab the way a person
// does, with the program's own functions: the same combo pick, the same field change, the same Slice button, the same
// Arrange / Fill bed / Clone jobs. Nothing here slices, arranges or estimates by itself; it presses and reads back.
// There is NO send-to-printer and NO print here, on purpose: the person presses Print.
//
// The page (door/script-door.js) calls b3d_door_call(json) with { id, do, args }. The action runs on the program's own
// main loop (CallAfter), and the answer goes back as B3DDoor.answer(id, json). Actions that start something long
// (slice, arrange, fill_bed) answer at once with started: true; the page then asks "status" until the program is idle.
// b3d_door_now(json) answers at once, even while a box is open (JSPI keeps the page alive under ShowModal): it lists
// the open boxes and presses their buttons, as a person answers a box.
#include <emscripten.h>
#include <nlohmann/json.hpp>
#include <boost/algorithm/string.hpp>
#include <wx/app.h>
#include <wx/button.h>
#include <wx/dialog.h>
#include <wx/stattext.h>
#include <wx/utils.h>
#include <wx/glcanvas.h>

#include "libslic3r/Model.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Utils.hpp"
#include "libslic3r/GCode/ThumbnailData.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/GLCanvas3D.hpp"
#include "slic3r/GUI/Selection.hpp"
#include "slic3r/GUI/GUI_ObjectList.hpp"
#include "slic3r/GUI/Tab.hpp"
#include "slic3r/GUI/PresetComboBoxes.hpp"
#include "slic3r/GUI/OptionsGroup.hpp"
#include "slic3r/GUI/Field.hpp"
#include "slic3r/GUI/Widgets/SideButton.hpp"
#include "slic3r/GUI/Widgets/Button.hpp"

using json = nlohmann::json;
using namespace Slic3r;
using namespace Slic3r::GUI;

namespace {

struct DoorError : std::runtime_error { using std::runtime_error::runtime_error; };

std::string utf8(const wxString &s) { return std::string(s.utf8_str()); }

void answer(const std::string &id, const json &a)
{
    MAIN_THREAD_EM_ASM({ B3DDoor.answer(UTF8ToString($0), UTF8ToString($1)); }, id.c_str(), a.dump().c_str());
}

Plater &plater()
{
    Plater *p = wxGetApp().plater();
    if (!p) throw DoorError("the program is still starting (no plate yet)");
    return *p;
}

// ---- presets: the very lists a person picks from ----------------------------------------------------------------

::ComboBox *combo_of(const std::string &type, int filament)
{
    if (type == "printer") return plater().sidebar().printer_combox();
    if (type == "filament") {
        auto &c = plater().sidebar().combos_filament();
        if (filament < 0 || filament >= int(c.size()))
            throw DoorError("there is no filament " + std::to_string(filament + 1) + " (this plate has " + std::to_string(c.size()) + ")");
        return c[filament];
    }
    if (type == "process") {
        Tab *t = wxGetApp().get_tab(Preset::TYPE_PRINT);
        if (!t || !t->get_combo_box()) throw DoorError("the process settings are not built yet");
        return t->get_combo_box();
    }
    throw DoorError("type is printer, filament or process, not \"" + type + "\"");
}

// A row a person can pick: not a heading, separator or "add printer" row.
bool pickable(::ComboBox *c, unsigned i)
{
    const size_t marker = reinterpret_cast<size_t>(c->GetClientData(i));
    return !(marker >= PresetComboBox::LABEL_ITEM_DISABLED && marker < PresetComboBox::LABEL_ITEM_MAX);
}

std::string clean(const wxString &label) { return Preset::remove_suffix_modified(utf8(label)); }

json list_combo(::ComboBox *c)
{
    json rows = json::array();
    const int sel = c->GetSelection();
    for (unsigned i = 0; i < c->GetCount(); ++i)
        if (pickable(c, i)) rows.push_back(json{{"name", clean(c->GetString(i))}, {"selected", int(i) == sel}});
    return rows;
}

json presets(const json &args)
{
    const std::string type = args.value("type", "");
    json out;
    for (std::string t : {"printer", "filament", "process"}) {
        if (!type.empty() && t != type) continue;
        out[t] = list_combo(combo_of(t, args.value("filament", 1) - 1));
    }
    return out;
}

json pick_preset(const json &args)
{
    const std::string type = args.value("type", ""), name = args.value("name", "");
    ::ComboBox *c = combo_of(type, args.value("filament", 1) - 1);
    int hit = -1;
    for (unsigned i = 0; i < c->GetCount() && hit < 0; ++i)
        if (pickable(c, i) && clean(c->GetString(i)) == name) hit = int(i);
    if (hit < 0) { // a unique part of a name is fine ("X1 Carbon 0.4"), as the list's own search finds it
        std::vector<int> part;
        for (unsigned i = 0; i < c->GetCount(); ++i)
            if (pickable(c, i) && boost::icontains(clean(c->GetString(i)), name)) part.push_back(int(i));
        if (part.size() == 1) hit = part[0];
        else {
            json near = json::array();
            for (int i : part) near.push_back(clean(c->GetString(i)));
            throw DoorError(part.empty() ? "the " + type + " list has no \"" + name + "\"; ask presets for the list"
                                         : "\"" + name + "\" matches " + std::to_string(part.size()) + " " + type + " rows: " + near.dump());
        }
    }
    c->SelectAndNotify(hit); // the list's own pick: the program's handlers run as for a click
    return json{{"type", type}, {"picked", clean(c->GetString(hit))}};
}

// ---- settings: the field a person types in, then Enter ----------------------------------------------------------

Tab *tab_of(const std::string &tab)
{
    const Preset::Type t = tab == "filament" ? Preset::TYPE_FILAMENT : tab == "printer" ? Preset::TYPE_PRINTER : Preset::TYPE_PRINT;
    Tab *x = wxGetApp().get_tab(t);
    if (!x) throw DoorError("the " + tab + " settings are not built yet");
    return x;
}

json set_setting(Tab *tab, const std::string &key, const std::string &value)
{
    DynamicPrintConfig &cfg = *tab->get_config();
    if (!cfg.has(key)) throw DoorError("\"" + key + "\" is not a " + utf8(tab->title()) + " setting");
    const ConfigOption *opt = cfg.option(key);
    const bool vec = opt->is_vector();
    const std::string id = vec ? key + "#0" : key;
    Page *page = nullptr;
    Field *field = tab->get_field(key, &page, vec ? 0 : -1);
    if (!field) {
        // A page's boxes are made when the page is shown: open the page holding the setting, as the settings search
        // does when a person picks a found setting (Tab::activate_option; the page switch runs at once).
        tab->activate_option(key, wxEmptyString);
        field = tab->get_field(key, &page, vec ? 0 : -1);
    }
    if (!field || !page) throw DoorError("\"" + key + "\" has no box on the " + utf8(tab->title()) + " pages"
                                         " (some settings show only with Advanced on)");
    Slic3r::GUI::ConfigOptionsGroup *group = nullptr;
    for (auto &g : page->m_optgroups)
        if (g->get_field(id) == field) { group = g.get(); break; }
    if (!group) throw DoorError("\"" + key + "\": its box was found but not its group");
    // The typed text, read by the program's own option parser (so "15%", "gyroid", "tree(auto)", "1" all mean what
    // they mean in the box); then shown in the box and handed on as the box hands on a change.
    DynamicPrintConfig typed = cfg;
    try { typed.set_deserialize_strict(key, value); }
    catch (const std::exception &e) { throw DoorError("\"" + value + "\" is not a value for " + key + ": " + e.what()); }
    group->set_value(id, group->get_config_value(typed, key, vec ? 0 : -1), false);
    group->on_change_OG(id, field->get_value());
    return json{{"key", key}, {"now", tab->get_config()->opt_serialize(key)}};
}

json settings(const json &args)
{
    Tab *tab = tab_of(args.value("tab", "process"));
    json done = json::array();
    if (args.contains("set"))
        for (auto &[k, v] : args["set"].items()) done.push_back(set_setting(tab, k, v.is_string() ? v.get<std::string>() : v.dump()));
    json now;
    if (args.contains("get"))
        for (auto &k : args["get"]) {
            const std::string key = k.get<std::string>();
            now[key] = tab->get_config()->has(key) ? json(tab->get_config()->opt_serialize(key)) : json(nullptr);
        }
    return json{{"changed", done}, {"values", now}};
}

// ---- the plate --------------------------------------------------------------------------------------------------

json objects()
{
    json rows = json::array();
    Model &m = plater().model();
    for (size_t i = 0; i < m.objects.size(); ++i)
        rows.push_back(json{{"index", i}, {"name", m.objects[i]->name}, {"copies", m.objects[i]->instances.size()}});
    return rows;
}

json add_part(const json &args)
{
    const std::string path = args.value("path", "");
    if (path.empty()) throw DoorError("add_part needs the file (url, file or path)");
    const size_t before = plater().model().objects.size();
    // What Add (Ctrl+I) does with one model file: the geometry only, never a 3MF's settings.
    Plater::TakeSnapshot snapshot(&plater(), "Import Objects: " + boost::filesystem::path(path).filename().string());
    std::vector<boost::filesystem::path> paths{boost::filesystem::path(path)};
    plater().load_files(paths, LoadStrategy::LoadModel, false);
    if (plater().model().objects.size() == before) throw DoorError("the program took nothing from " + path);
    return json{{"objects", objects()}};
}

void select(const json &args)
{
    const json o = args.contains("object") ? args["object"] : json("all");
    if (o.is_string() && o.get<std::string>() == "all") { plater().select_all(); return; }
    const int idx = o.get<int>();
    if (idx < 0 || idx >= int(plater().model().objects.size())) throw DoorError("there is no object " + std::to_string(idx));
    GLCanvas3D *canvas = plater().get_view3D_canvas3D();
    canvas->get_selection().add_object(unsigned(idx), true);
    wxGetApp().obj_list()->update_selections();
    wxPostEvent(canvas->get_wxglcanvas(), SimpleEvent(EVT_GLCANVAS_OBJECT_SELECT));
}

bool busy() { return plater().is_any_job_running() || plater().is_background_process_slicing(); }

json status()
{
    Plater &p = plater();
    PartPlate *plate = p.get_partplate_list().get_curr_plate();
    return json{{"busy", busy()},
                {"jobs", p.is_any_job_running()},
                {"slicing", p.is_background_process_slicing()},
                {"sliced", plate && plate->is_slice_result_valid()},
                {"plate", p.get_partplate_list().get_curr_plate_index() + 1},
                {"plates", p.get_partplate_list().get_plate_count()},
                {"objects", objects()}};
}

// What the Preview's summary shows: total time, filament weight and length, cost; and its layer count.
json results()
{
    Plater &p = plater();
    PartPlate *plate = p.get_partplate_list().get_curr_plate();
    if (!plate || !plate->is_slice_result_valid()) throw DoorError("this plate is not sliced (or changed since): slice first");
    GCodeProcessorResult *r = plate->get_slice_result();
    const PrintStatistics &ps = p.get_partplate_list().get_current_fff_print().print_statistics();
    const float t = r ? r->print_statistics.modes[size_t(PrintEstimatedStatistics::ETimeMode::Normal)].time : 0.f;
    const size_t layers = p.get_preview_canvas3D() ? p.get_preview_canvas3D()->get_gcode_layers_zs().size() : 0;
    char g[32], m[32], c[32];
    std::snprintf(g, sizeof g, "%.2f", ps.total_weight);
    std::snprintf(m, sizeof m, "%.2f", ps.total_used_filament / 1000.0);
    std::snprintf(c, sizeof c, "%.2f", ps.total_cost);
    int copies = 0;
    for (ModelObject *o : plate->get_objects_on_this_plate()) copies += int(o->instances.size());
    return json{{"plate", p.get_partplate_list().get_curr_plate_index() + 1},
                {"time_s", std::lround(t)},
                {"time", short_time(get_time_dhms(t))},
                {"grams", std::stod(g)},
                {"meters", std::stod(m)},
                {"cost", std::stod(c)},
                {"layers", layers},
                {"copies", copies},
                {"printer", wxGetApp().preset_bundle->printers.get_edited_preset().name},
                {"filaments", wxGetApp().preset_bundle->filament_presets},
                {"process", wxGetApp().preset_bundle->prints.get_edited_preset().name}};
}

// The plate's own picture, as the program draws it for the 3MF and the printer screen (top-down, no bed).
void picture(const std::string &id)
{
    Plater &p = plater();
    PartPlate *plate = p.get_partplate_list().get_curr_plate();
    ThumbnailData data;
    ThumbnailsParams params = {{}, false, true, true, true, p.get_partplate_list().get_curr_plate_index()};
    params.background_color = Vec4f(0.0f, 0.0f, 0.0f, 0.0f);
    p.get_view3D_canvas3D()->render_thumbnail(data, plate->plate_thumbnail_width, plate->plate_thumbnail_height, params, Camera::EType::Ortho);
    if (!data.is_valid()) throw DoorError("the program drew no plate picture");
    MAIN_THREAD_EM_ASM({ B3DDoor.picture(UTF8ToString($0), $1, $2, $3 >>> 0); }, id.c_str(), data.width, data.height, data.pixels.data());
}

json run(const std::string &id, const std::string &what, const json &args)
{
    if (what == "status") return status();
    if (what == "presets") return presets(args);
    if (what == "pick_preset") return pick_preset(args);
    if (what == "settings") return settings(args);
    if (what == "results") return results();
    if (what == "add_part") return add_part(args);
    if (what == "new_project") { plater().new_project(true, true); return status(); }
    if (busy()) throw DoorError("the program is busy (slicing or a job); ask status until busy is false");
    if (what == "select") { select(args); return status(); }
    if (what == "clone") { // Clone: the selected object, then the number the person types in the box
        select(args);
        const int n = args.value("copies", 1);
        if (n < 1 || n > 1000) throw DoorError("copies is 1 to 1000, as in the Clone box");
        plater().get_view3D_canvas3D()->get_selection().clone(n);
        return json{{"started", true}};
    }
    if (what == "fill_bed") { // right-click the object: Fill bed with copies
        select(args);
        plater().fill_bed_with_instances();
        return json{{"started", true}};
    }
    if (what == "arrange") { plater().arrange(); return json{{"started", true}}; }
    if (what == "slice") { // the Slice button, as the person has it set (plate or all)
        MainFrame *f = wxGetApp().mainframe;
        if (!f || !f->m_slice_btn) throw DoorError("there is no Slice button yet");
        if (!f->m_slice_btn->IsEnabled()) {
            // Grey after a slice with nothing changed since (as a person sees it): the Preview's numbers stand.
            PartPlate *plate = plater().get_partplate_list().get_curr_plate();
            if (plate && plate->is_slice_result_valid()) return json{{"already", true}};
            throw DoorError("the Slice button is grey (nothing on the plate, or a part off the plate)");
        }
        wxCommandEvent e(wxEVT_BUTTON, f->m_slice_btn->GetId());
        e.SetEventObject(f->m_slice_btn);
        wxPostEvent(f->m_slice_btn, e);
        return json{{"started", true}};
    }
    if (what == "picture") { picture(id); return json{{"later", true}}; }
    throw DoorError("the door has no \"" + what + "\"");
}

// ---- boxes: what is open on screen, and its buttons ---------------------------------------------------------------

void collect(wxWindow *w, std::vector<wxButton *> &buttons, std::vector<std::string> &text)
{
    for (wxWindow *c : w->GetChildren()) {
        if (!c->IsShown()) continue;
        if (auto *b = dynamic_cast<wxButton *>(c)) buttons.push_back(b);
        else if (auto *s = dynamic_cast<wxStaticText *>(c)) { if (!s->GetLabel().empty()) text.push_back(utf8(s->GetLabel())); }
        collect(c, buttons, text);
    }
}

std::vector<wxDialog *> open_boxes()
{
    std::vector<wxDialog *> out;
    for (wxWindow *w : wxTopLevelWindows)
        if (auto *d = dynamic_cast<wxDialog *>(w); d && d->IsShown()) out.push_back(d);
    return out;
}

// Bambu's own buttons (Widgets/Button) are not wxButtons; they answer a click by their label.
void collect_bambu(wxWindow *w, std::vector<::Button *> &out)
{
    for (wxWindow *c : w->GetChildren()) {
        if (!c->IsShown()) continue;
        if (auto *b = dynamic_cast<::Button *>(c)) out.push_back(b);
        collect_bambu(c, out);
    }
}

json boxes()
{
    json rows = json::array();
    for (wxDialog *w : open_boxes()) {
        std::vector<wxButton *> b; std::vector<std::string> t; std::vector<::Button *> bb;
        collect(w, b, t); collect_bambu(w, bb);
        json names = json::array();
        for (auto *x : b) names.push_back(utf8(x->GetLabel()));
        for (auto *x : bb) names.push_back(utf8(x->GetLabel()));
        rows.push_back(json{{"title", utf8(w->GetTitle())}, {"says", t}, {"buttons", names}});
    }
    return rows;
}

json press(const json &args)
{
    const std::string want = args.value("button", "");
    for (wxDialog *w : open_boxes()) {
        std::vector<wxButton *> b; std::vector<std::string> t; std::vector<::Button *> bb;
        collect(w, b, t); collect_bambu(w, bb);
        for (auto *x : b)
            if (boost::iequals(utf8(wxStripMenuCodes(x->GetLabel())), want)) {
                wxCommandEvent e(wxEVT_BUTTON, x->GetId()); e.SetEventObject(x); wxPostEvent(x, e);
                return json{{"pressed", want}, {"box", utf8(w->GetTitle())}};
            }
        for (auto *x : bb)
            if (boost::iequals(utf8(wxStripMenuCodes(x->GetLabel())), want)) {
                wxCommandEvent e(wxEVT_BUTTON, x->GetId()); e.SetEventObject(x); wxPostEvent(x, e);
                return json{{"pressed", want}, {"box", utf8(w->GetTitle())}};
            }
    }
    throw DoorError("no open box has a button \"" + want + "\"; open boxes: " + boxes().dump());
}

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE void b3d_door_call(const char *text)
{
    json m = json::parse(text, nullptr, false);
    if (m.is_discarded() || !m.contains("id")) return;
    const std::string id = m["id"].get<std::string>();
    const std::string what = m.value("do", "");
    const json args = m.contains("args") ? m["args"] : json::object();
    if (!wxTheApp) { answer(id, json{{"ok", false}, {"error", "the program is still starting"}}); return; }
    wxTheApp->CallAfter([id, what, args]() {
        try {
            json r = run(id, what, args);
            if (r.is_object() && r.value("later", false)) return; // picture answers by itself
            answer(id, json{{"ok", true}, {"result", r}});
        } catch (const std::exception &e) {
            answer(id, json{{"ok", false}, {"error", e.what()}});
        }
    });
}

// Answers at once, also under an open box: { do: "boxes" } or { do: "press", args: { button } }. Returns a JSON
// string the page frees.
EMSCRIPTEN_KEEPALIVE char *b3d_door_now(const char *text)
{
    json m = json::parse(text, nullptr, false);
    json a;
    try {
        const std::string what = m.value("do", "");
        const json args = m.contains("args") ? m["args"] : json::object();
        if (what == "boxes") a = json{{"ok", true}, {"result", boxes()}};
        else if (what == "press") a = json{{"ok", true}, {"result", press(args)}};
        else a = json{{"ok", false}, {"error", "now answers boxes and press"}};
    } catch (const std::exception &e) {
        a = json{{"ok", false}, {"error", e.what()}};
    }
    return strdup(a.dump().c_str());
}

} // extern "C"
