// The camera calls Bambu Studio looks up in libBambuSource.so (BambuTunnel.h, Bambu_*), answered by Boolean3d's own
// code for the browser tab (spike bambu-device). lan_printer_agent.cpp's dlsym sends those look-ups here.
//
// The picture comes from the Boolean3d helper on the home network: it reads the printer's camera (RTSPS for X1/H2)
// over the page's websocket (lan-printer-link.js: binary message "<dev_id>\n" + one picture). Two ways:
// - Video (a build whose camera view registered itself with b3d_camera_host_add: Bambu Studio's wxMediaCtrl3): the
//   helper passes the printer's own H.264 through untouched and the page plays it (lan-printer-link.js B3DCam, WebCodecs) on
//   a <canvas> laid over the camera view, placed from here. Bambu Studio sees a stream of the video's size whose
//   samples never come (it shows "Playing" and its idle picture underneath); 30 pictures a second, ~0.1 s behind.
// - JPEG (older helpers, builds without the overlay): the helper sends ~3 JPEGs a second; to the program a stream of
//   video sub-type MJPG that its own decoder and camera view draw unchanged.
// Nothing here talks to Bambu's servers.
//
// The camera view calls these on its own thread and polls (Bambu_would_block); pictures arrive on the main thread.

#include <emscripten.h>
#include <emscripten/threading.h>
#include <atomic>
#include <chrono>
#include <cstring>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <wx/timer.h>
#include <wx/toplevel.h>
#include <wx/window.h>

#include <nlohmann/json.hpp>
#include "slic3r/GUI/Printer/BambuTunnel.h"

using json = nlohmann::json;

namespace {

struct Camera {
    std::string                             dev_id;
    std::mutex                              m;
    std::deque<std::vector<unsigned char>>  frames;   // newest at the back, a few kept
    std::vector<unsigned char>              current;  // the sample Bambu Studio holds until its next ReadSample
    std::string                             error;    // the helper said there is no picture
    int                                     width = 0, height = 0;
    bool                                    open = false;
    bool                                    video = false; // the page plays it (B3DCam); no samples come here
    std::chrono::steady_clock::time_point   opened;
};

std::mutex                                    g_m;
std::map<Camera *, std::shared_ptr<Camera>>   g_cams; // every camera made and not yet destroyed
std::atomic<int>                              g_hosts{0}; // camera views that place the page's video (b3d_camera_host_add)

std::shared_ptr<Camera> find(void *tunnel)
{
    std::lock_guard<std::mutex> l(g_m);
    auto                        it = g_cams.find(static_cast<Camera *>(tunnel));
    return it == g_cams.end() ? nullptr : it->second;
}

// The cameras of one printer (a view closing while the next opens: both for a moment).
std::vector<std::shared_ptr<Camera>> of_printer(const std::string &dev_id)
{
    std::lock_guard<std::mutex>          l(g_m);
    std::vector<std::shared_ptr<Camera>> out;
    for (auto &e : g_cams)
        if (e.second->dev_id == dev_id) out.push_back(e.second);
    return out;
}

void page_send(const std::string &msg)
{
    MAIN_THREAD_EM_ASM({ B3DLan.send(UTF8ToString($0)); }, msg.c_str());
}

// The picture's size from the JPEG's frame header (SOF0..SOF2).
bool jpeg_size(const std::vector<unsigned char> &b, int &w, int &h)
{
    for (size_t i = 2; i + 9 < b.size();) {
        if (b[i] != 0xFF) return false;
        const unsigned char mk = b[i + 1];
        const size_t        len = (size_t(b[i + 2]) << 8) | b[i + 3];
        if (mk >= 0xC0 && mk <= 0xC2) {
            h = (b[i + 5] << 8) | b[i + 6];
            w = (b[i + 7] << 8) | b[i + 8];
            return w > 0 && h > 0;
        }
        i += 2 + len;
    }
    return false;
}

// "bambu:///rtsps___bblp:code@ip/streaming/live/1?proto=rtsps&device=SERIAL&..." -> SERIAL
std::string device_of(const char *url)
{
    const std::string u = url ? url : "";
    const auto        p = u.find("device=");
    if (p == std::string::npos) return "";
    const auto e = u.find('&', p);
    return u.substr(p + 7, e == std::string::npos ? std::string::npos : e - p - 7);
}

Camera *cam(Bambu_Tunnel t) { return static_cast<Camera *>(t); }

int  b3d_Create(Bambu_Tunnel *tunnel, char const *path)
{
    auto c    = std::make_shared<Camera>();
    c->dev_id = device_of(path);
    if (c->dev_id.empty()) return -1;
    {
        std::lock_guard<std::mutex> l(g_m);
        g_cams[c.get()] = c;
    }
    *tunnel = c.get();
    return 0;
}
void b3d_SetLogger(Bambu_Tunnel, Logger, void *) {}
#ifndef B3D_LAN_AGENT_ORCA // OrcaSlicer's BambuTunnel.h is the older one: no stream-info, track or session calls
void b3d_SetStreamInfoCallback(Bambu_Tunnel, StreamInfoCallback, void *) {}
void b3d_SetTrackReporter(Bambu_Tunnel, TrackReporter, void *) {}
#endif
int  b3d_Open(Bambu_Tunnel t)
{
    Camera *c = cam(t);
    {
        std::lock_guard<std::mutex> l(c->m);
        c->open   = true;
        c->opened = std::chrono::steady_clock::now();
    }
    json m = {{"op", "camera"}, {"dev_id", c->dev_id}, {"on", true}};
    if (g_hosts > 0) {
        m["video"] = "h264";
        MAIN_THREAD_EM_ASM({ B3DCam.start(UTF8ToString($0)); }, c->dev_id.c_str());
    }
    page_send(m.dump());
    return 0;
}
// Ready once the first picture came (its size is the stream's); 20 s with none = no camera.
int b3d_StartStream(Bambu_Tunnel t, bool)
{
    Camera                     *c = cam(t);
    std::lock_guard<std::mutex> l(c->m);
    if (!c->error.empty()) return -1;
    if (c->width > 0) return 0;
    if (std::chrono::steady_clock::now() - c->opened > std::chrono::seconds(20)) return -1;
    return Bambu_would_block;
}
int b3d_StartStreamEx(Bambu_Tunnel t, int) { return b3d_StartStream(t, true); }
int b3d_GetStreamCount(Bambu_Tunnel) { return 1; }
int b3d_GetStreamInfo(Bambu_Tunnel t, int index, Bambu_StreamInfo *info)
{
    Camera                     *c = cam(t);
    std::lock_guard<std::mutex> l(c->m);
    if (index != 0 || c->width <= 0) return -1;
    std::memset(info, 0, sizeof *info);
    info->type                     = VIDE;
    info->sub_type                 = MJPG; // for video too: no sample reaches the program's decoder then
    info->format.video.width       = c->width;
    info->format.video.height      = c->height;
    info->format.video.frame_rate  = 4;
    info->format_type              = video_jpeg;
    info->max_frame_size           = 4 << 20;
    return 0;
}
int b3d_ReadSample(Bambu_Tunnel t, Bambu_Sample *sample)
{
    Camera                     *c = cam(t);
    std::lock_guard<std::mutex> l(c->m);
    if (!c->error.empty()) return Bambu_stream_end;
    if (c->video || c->frames.empty()) return Bambu_would_block;
    c->current = std::move(c->frames.front());
    c->frames.pop_front();
    sample->itrack      = 0;
    sample->size        = int(c->current.size());
    sample->flags       = f_sync;
    sample->buffer      = c->current.data();
    sample->decode_time = (unsigned long long) std::chrono::duration_cast<std::chrono::milliseconds>(
                              std::chrono::steady_clock::now().time_since_epoch()).count() * 10000ULL; // 100 ns units
    return Bambu_success;
}
int  b3d_SendMessage(Bambu_Tunnel, int, char const *, int) { return -1; }
void b3d_Close(Bambu_Tunnel t)
{
    Camera *c = cam(t);
    bool    was;
    {
        std::lock_guard<std::mutex> l(c->m);
        was     = c->open;
        c->open = false;
    }
    if (!was) return;
    page_send(json{{"op", "camera"}, {"dev_id", c->dev_id}, {"on", false}}.dump());
    if (g_hosts > 0) MAIN_THREAD_EM_ASM({ B3DCam.stop(UTF8ToString($0)); }, c->dev_id.c_str());
}
void b3d_Destroy(Bambu_Tunnel t)
{
    std::lock_guard<std::mutex> l(g_m);
    g_cams.erase(cam(t)); // the last reference: the camera is gone after this
}
#ifndef B3D_LAN_AGENT_ORCA
void b3d_GetSessionStat(Bambu_Tunnel, Bambu_SessionStat *stat) { std::memset(stat, 0, sizeof *stat); }
#endif
void b3d_FreeLogMsg(tchar const *) {}
void b3d_Deinit() {}

// Camera views that show the page's video (main thread only). Every 100 ms each one's place on the page goes to its
// printer's player when it changed, as wxwidgets-opengl places WebGL over a 3D view (ClientToScreen less the top-level window's
// position, in that window's div); a view with no video, hidden, or gone hides it.
struct Host {
    wxWindow                *win;
    std::function<void *()>  tunnel;
    const double            *zoom;
    std::string              dev;   // the player placed now ("" none)
    wxRect                   rect;
    int                      window = 0;
    bool                     shown  = false;
    double                   z      = 0;
};
std::vector<Host> g_views;

void hide(Host &h)
{
    if (h.dev.empty()) return;
    MAIN_THREAD_EM_ASM({ B3DCam.hide(UTF8ToString($0)); }, h.dev.c_str());
    h.dev.clear();
}

void place(Host &h)
{
    std::string dev;
    if (auto c = find(h.tunnel())) {
        std::lock_guard<std::mutex> l(c->m);
        if (c->open && c->video) dev = c->dev_id;
    }
    if (dev != h.dev) hide(h);
    if (dev.empty()) return;
    auto *tlw = wxDynamicCast(wxGetTopLevelParent(h.win), wxTopLevelWindow);
    if (!tlw) return;
    const wxRect rect(h.win->ClientToScreen(wxPoint(0, 0)) - tlw->GetScreenPosition(), h.win->GetClientSize());
    const bool   shown = h.win->IsShownOnScreen();
    const int    window = tlw->GetCSSId();
    if (dev == h.dev && rect == h.rect && shown == h.shown && window == h.window && *h.zoom == h.z) return;
    h.dev = dev; h.rect = rect; h.shown = shown; h.window = window; h.z = *h.zoom;
    MAIN_THREAD_EM_ASM({ B3DCam.place(UTF8ToString($0), $1, $2, $3, $4, $5, $6, $7); }, dev.c_str(), window, rect.x, rect.y,
           rect.width, rect.height, shown ? 1 : 0, h.z);
}

struct Placer : wxTimer {
    void Notify() override { for (auto &h : g_views) place(h); }
};

} // namespace

// Called by the camera view (the build's patch of wxMediaCtrl3): from its constructor (tunnel = its current
// Bambu_Tunnel, zoom = its wheel zoom) and its destructor.
void b3d_camera_host_add(wxWindow *win, std::function<void *()> tunnel, const double *zoom)
{
    static Placer *placer = nullptr;
    g_views.push_back(Host{win, std::move(tunnel), zoom});
    ++g_hosts;
    if (!placer) {
        placer = new Placer;
        placer->Start(100);
    }
}
void b3d_camera_host_remove(wxWindow *win)
{
    for (auto it = g_views.begin(); it != g_views.end(); ++it)
        if (it->win == win) {
            hide(*it);
            g_views.erase(it);
            --g_hosts;
            return;
        }
}
// The camera's full-screen button: the page's picture of that view fills the screen (again: leaves it). False = this
// view shows no page video (the program's own full screen then).
bool b3d_camera_fullscreen(wxWindow *win)
{
    for (auto &h : g_views)
        if (h.win == win) {
            place(h);
            if (h.dev.empty()) return false;
            MAIN_THREAD_EM_ASM({ B3DCam.fullscreen(UTF8ToString($0)); }, h.dev.c_str());
            return true;
        }
    return false;
}

extern "C" {

void *b3d_lan_camera_symbol(const char *name)
{
    static const std::map<std::string, void *> calls = {
        {"Bambu_Create", (void *) &b3d_Create},
        {"Bambu_Open", (void *) &b3d_Open},
        {"Bambu_StartStream", (void *) &b3d_StartStream},
        {"Bambu_StartStreamEx", (void *) &b3d_StartStreamEx},
        {"Bambu_GetStreamCount", (void *) &b3d_GetStreamCount},
        {"Bambu_GetStreamInfo", (void *) &b3d_GetStreamInfo},
        {"Bambu_SendMessage", (void *) &b3d_SendMessage},
        {"Bambu_ReadSample", (void *) &b3d_ReadSample},
        {"Bambu_Close", (void *) &b3d_Close},
        {"Bambu_Destroy", (void *) &b3d_Destroy},
        {"Bambu_SetLogger", (void *) &b3d_SetLogger},
#ifndef B3D_LAN_AGENT_ORCA
        {"Bambu_SetStreamInfoCallback", (void *) &b3d_SetStreamInfoCallback},
        {"Bambu_SetTrackReporter", (void *) &b3d_SetTrackReporter},
        {"Bambu_GetSessionStat", (void *) &b3d_GetSessionStat},
#endif
        {"Bambu_FreeLogMsg", (void *) &b3d_FreeLogMsg},
        {"Bambu_Deinit", (void *) &b3d_Deinit},
    };
    auto it = calls.find(name ? name : "");
    return it == calls.end() ? nullptr : it->second;
}

// A picture from the helper (main thread, lan-printer-link.js): kept for the open camera of that printer.
EMSCRIPTEN_KEEPALIVE void b3d_lan_camera_frame(const char *dev_id, const unsigned char *data, int size)
{
    if (size <= 0) return;
    const std::vector<unsigned char> f(data, data + size);
    int                              w = 0, h = 0;
    const bool                       sized = jpeg_size(f, w, h);
    for (auto &c : of_printer(dev_id)) {
        std::lock_guard<std::mutex> l(c->m);
        if (!c->open) continue;
        if (c->width <= 0 && sized) { c->width = w; c->height = h; }
        c->frames.push_back(f);
        while (c->frames.size() > 4) c->frames.pop_front(); // a slow view skips old pictures
    }
}

// The first video picture the page decoded for this printer: its size makes the stream ready (b3d_StartStream).
EMSCRIPTEN_KEEPALIVE void b3d_lan_camera_size(const char *dev_id, int width, int height)
{
    for (auto &c : of_printer(dev_id)) {
        std::lock_guard<std::mutex> l(c->m);
        if (!c->open) continue;
        c->video = true;
        if (c->width <= 0) { c->width = width; c->height = height; }
    }
}

// The helper has no picture for this printer (lan_printer_agent.cpp's b3d_lan_incoming, ev "camera").
void b3d_lan_camera_failed(const char *dev_id, const char *error)
{
    for (auto &c : of_printer(dev_id)) {
        std::lock_guard<std::mutex> l(c->m);
        if (c->open) c->error = error && *error ? error : "no picture";
    }
    emscripten_log(EM_LOG_CONSOLE, "b3d-lan: camera of %s: %s", dev_id, error ? error : "");
}

} // extern "C"
