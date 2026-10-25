// OrcaSlicer's camera view (wxMediaCtrl2) in the browser tab.
//
// Desktop Orca plays the printer camera through the platform's player: GStreamer on Linux (its own bambusrc element,
// GUI/Printer/gstbambusrc.c, reads the camera library's samples), the camera library's BambuPlayer on macOS. A tab has
// neither, so it takes the macOS shape of the class (a plain window, wxMediaCtrl2.h) and does what bambusrc does: it
// reads the camera library's samples (Bambu_*, bambulib_get as gstbambusrc.c) on a thread and draws each picture.
// In the tab the camera library is Boolean3d's LAN camera (printer-link/lan_printer_camera.cpp): the helper on the home network
// relays the printer's camera as MJPG, one JPEG per sample, decoded here with wx's own JPEG handler.
// With a helper that passes the printer's own H.264 through (smooth-camera), the page plays it instead: this view
// registers with printer-link/lan_printer_camera.cpp (b3d_camera_host_add), which lays the page's <canvas> over it; the
// stream then has the video's size and no samples, so the reader below just waits. Desktop Orca has no camera
// full screen, so there is none here either.
// States and events follow wxMediaCtrl2.mm: Load opens the stream (video size known), Play starts the pictures,
// a stream that ends stops the view; MediaPlayCtrl drives it unchanged from its media thread.

#include "wxMediaCtrl2.h"
#include <wx/dcbuffer.h>
#include <wx/mstream.h>
#include <wx/image.h>
#include <boost/log/trivial.hpp>
#include <atomic>
#include <functional>
#include <chrono>
#include <mutex>
#include <thread>

#define BAMBU_DYNAMIC
#include "Printer/BambuTunnel.h"

extern "C" BambuLib *bambulib_get();

wxDEFINE_EVENT(EVT_MEDIA_CTRL_STAT, wxCommandEvent);

namespace {
struct Player {
    BambuLib         *lib = nullptr;
    std::atomic<Bambu_Tunnel> tnl{nullptr}; // read by the page's video placer on the main thread
    std::thread       reader;
    std::atomic<bool> stop{false};
    std::mutex        m;
    wxImage           picture; // the newest picture, drawn by the window
};
Player *player(void *p) { return static_cast<Player *>(p); }
const double g_zoom = 1.0; // Orca's view has no wheel zoom
} // namespace

void b3d_camera_host_add(wxWindow *, std::function<void *()>, const double *);
void b3d_camera_host_remove(wxWindow *);

void wxMediaCtrl2::bambu_log(void const *, int, char const *msg) { BOOST_LOG_TRIVIAL(info) << msg; }

wxMediaCtrl2::wxMediaCtrl2(wxWindow *parent) : wxWindow(parent, wxID_ANY, wxDefaultPosition, wxDefaultSize)
{
    SetBackgroundColour(*wxBLACK);
    SetBackgroundStyle(wxBG_STYLE_PAINT);
    Bind(wxEVT_PAINT, [this](wxPaintEvent &) {
        wxAutoBufferedPaintDC dc(this);
        dc.SetBackground(*wxBLACK_BRUSH);
        dc.Clear();
        Player *p = player(m_player);
        if (!p) return;
        wxImage img;
        {
            std::lock_guard<std::mutex> l(p->m);
            img = p->picture;
        }
        const wxSize s = GetClientSize();
        if (!img.IsOk() || s.x <= 0 || s.y <= 0) return;
        const double k = std::min(double(s.x) / img.GetWidth(), double(s.y) / img.GetHeight());
        const int    w = std::max(1, int(img.GetWidth() * k)), h = std::max(1, int(img.GetHeight() * k));
        dc.DrawBitmap(wxBitmap(img.Scale(w, h, wxIMAGE_QUALITY_BILINEAR)), (s.x - w) / 2, (s.y - h) / 2);
    });
    create_player();
    b3d_camera_host_add(this, [this] { Player *p = player(m_player); return p ? (void *) p->tnl.load() : nullptr; }, &g_zoom);
}

wxMediaCtrl2::~wxMediaCtrl2()
{
    b3d_camera_host_remove(this);
    Stop();
    delete player(m_player);
}

void wxMediaCtrl2::create_player()
{
    if (m_player) return;
    BambuLib *lib = bambulib_get();
    if (!lib || !lib->Bambu_Create) {
        BOOST_LOG_TRIVIAL(info) << __FUNCTION__ << ": camera library not ready yet";
        return;
    }
    auto p = new Player;
    p->lib = lib;
    m_player = p;
}

// Media thread (MediaPlayCtrl::media_proc): open the stream; the video size is known once it starts.
void wxMediaCtrl2::Load(wxURI url)
{
    create_player();
    Player *p = player(m_player);
    if (!p) { m_error = -2; }
    else {
        Stop();
        m_error = 0;
        const std::string u = url.BuildURI().ToUTF8().data();
        Bambu_Tunnel tnl = nullptr;
        int          rv  = p->lib->Bambu_Create(&tnl, u.c_str());
        p->tnl           = tnl;
        if (rv == Bambu_success) {
            p->lib->Bambu_SetLogger(p->tnl, [](void *ctx, int level, char const *msg) { bambu_log(ctx, level, msg); }, this);
            rv = p->lib->Bambu_Open(p->tnl);
        }
        if (rv == Bambu_success)
            while ((rv = p->lib->Bambu_StartStream(p->tnl, true)) == Bambu_would_block)
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
        Bambu_StreamInfo info{};
        if (rv == Bambu_success && p->lib->Bambu_GetStreamInfo(p->tnl, 0, &info) == 0 && info.format.video.width > 0)
            m_video_size = {info.format.video.width, info.format.video.height};
        else if (rv == Bambu_success) rv = -1;
        if (rv != Bambu_success) {
            m_error = rv;
            if (p->tnl) { p->lib->Bambu_Close(p->tnl); p->lib->Bambu_Destroy(p->tnl); p->tnl = nullptr; }
        }
    }
    wxMediaEvent event(wxEVT_MEDIA_STATECHANGED);
    event.SetId(GetId());
    event.SetEventObject(this);
    wxPostEvent(this, event);
}

void wxMediaCtrl2::Play()
{
    Player *p = player(m_player);
    if (!p || !p->tnl) return;
    if (!p->reader.joinable()) {
        p->stop = false;
        p->reader = std::thread([this, p] {
            while (!p->stop) {
                Bambu_Sample s{};
                const int    rv = p->lib->Bambu_ReadSample(p->tnl, &s);
                if (rv == Bambu_would_block) { std::this_thread::sleep_for(std::chrono::milliseconds(30)); continue; }
                if (rv != Bambu_success) {
                    m_error = rv == Bambu_stream_end ? 0 : rv;
                    CallAfter([this] { NotifyStopped(); });
                    break;
                }
                wxMemoryInputStream in(s.buffer, s.size);
                wxImage             img;
                if (!img.LoadFile(in, wxBITMAP_TYPE_JPEG)) continue;
                {
                    std::lock_guard<std::mutex> l(p->m);
                    p->picture = std::move(img);
                }
                CallAfter([this] { Refresh(false); });
            }
        });
    }
    if (m_state != wxMEDIASTATE_PLAYING) {
        m_state = wxMEDIASTATE_PLAYING;
        wxMediaEvent event(wxEVT_MEDIA_STATECHANGED);
        event.SetId(GetId());
        event.SetEventObject(this);
        wxPostEvent(this, event);
    }
}

void wxMediaCtrl2::Stop()
{
    if (Player *p = player(m_player)) {
        p->stop = true;
        if (p->reader.joinable()) p->reader.join();
        if (Bambu_Tunnel tnl = p->tnl.exchange(nullptr)) {
            p->lib->Bambu_Close(tnl);
            p->lib->Bambu_Destroy(tnl);
        }
        std::lock_guard<std::mutex> l(p->m);
        p->picture = wxImage();
    }
    NotifyStopped();
    CallAfter([this] { Refresh(false); });
}

void wxMediaCtrl2::NotifyStopped()
{
    if (m_state != wxMEDIASTATE_STOPPED) {
        m_state = wxMEDIASTATE_STOPPED;
        wxMediaEvent event(wxEVT_MEDIA_STATECHANGED);
        event.SetId(GetId());
        event.SetEventObject(this);
        wxPostEvent(this, event);
    }
}

void wxMediaCtrl2::SetIdleImage(wxString const &) {}

wxMediaState wxMediaCtrl2::GetState() const { return m_state; }

wxSize wxMediaCtrl2::GetVideoSize() const
{
    Player *p = player(m_player);
    return p && p->tnl ? m_video_size : wxSize{0, 0};
}
