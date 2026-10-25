// Boolean3d's own LAN-only network agent for Bambu Studio running in a browser tab (spike bambu-device, 10-23).
//
// Bambu Studio's open code (src/slic3r/Utils/NetworkAgent.cpp) loads a network library from
// <data dir>/plugins/libbambu_networking.so and looks its calls up by name. In the tab there is no such library and
// Bambu's closed plugin is NOT used, downloaded or imitated: this file answers those look-ups with our own
// implementation, for the LAN path only (a printer in LAN Only + Developer Mode). Bambu Studio's own DeviceManager,
// MachineObject, Device tab and Print dialog drive it unchanged.
//
// The printer is reached through the Boolean3d helper on the home network (bridge.mjs), over a websocket owned by
// the page (lan-printer-link.js): the helper speaks MQTT (8883) and FTPS (990) / a LAN web link to the printer, relays the
// camera, and listens for the printers' SSDP announcements. Nothing here talks to Bambu's servers: there is no
// login, no cloud, no bind.
//
// The link: the linker sends dlopen/dlsym/dlclose here (-Wl,--wrap=...). dlopen of the two plugin paths returns our
// handles; dlsym on them returns the calls below. Every other dlopen goes to the real one.

#include <emscripten.h>
#include <emscripten/threading.h>
#include <dlfcn.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <map>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>
#include "slic3r/Utils/bambu_networking.hpp"
#include "slic3r/GUI/Printer/BambuTunnel.h"

using json = nlohmann::json;
#ifdef B3D_LAN_AGENT_ORCA
using namespace Slic3r; // OrcaSlicer keeps the network library's types in Slic3r
#else
using namespace BBL;
#endif

extern "C" void *__real_dlopen(const char *, int);
extern "C" void *__real_dlsym(void *, const char *);
extern "C" int __real_dlclose(void *);

namespace {

// ── The page's websocket (lan-printer-link.js) ────────────────────────────────────────────────────────────────────────
// Every call runs on the main browser thread, where the socket lives; a worker thread waits for it.
void page_send(const std::string &msg)
{
    MAIN_THREAD_EM_ASM({ B3DLan.send(UTF8ToString($0)); }, msg.c_str());
}

// ── Answers the helper sends back for a request id (calls made on worker threads wait here) ─────────────────
struct Waiter {
    std::mutex              m;
    std::condition_variable cv;
    std::deque<json>        msgs;
};
std::mutex                                 g_wait_m;
std::map<int, std::shared_ptr<Waiter>>     g_waiters;
std::atomic<int>                           g_next_id{1};

std::shared_ptr<Waiter> open_waiter(int id)
{
    auto w = std::make_shared<Waiter>();
    std::lock_guard<std::mutex> l(g_wait_m);
    g_waiters[id] = w;
    return w;
}
void close_waiter(int id)
{
    std::lock_guard<std::mutex> l(g_wait_m);
    g_waiters.erase(id);
}
// The next answer for this request, or null after `ms`.
json next_answer(const std::shared_ptr<Waiter> &w, int ms)
{
    std::unique_lock<std::mutex> l(w->m);
    if (!w->cv.wait_for(l, std::chrono::milliseconds(ms), [&] { return !w->msgs.empty(); }))
        return nullptr;
    json j = std::move(w->msgs.front());
    w->msgs.pop_front();
    return j;
}

// ── The agent Bambu Studio holds ─────────────────────────────────────────────────────────────────────────────
struct Agent {
    OnMsgArrivedFn     on_ssdp;
    OnLocalConnectedFn on_local_connect;
    OnMessageFn        on_local_message;
    QueueOnMainFn      queue_on_main;
    std::mutex         m;
    std::string        dev_id; // the printer this agent is connected to (one at a time, as Bambu Studio does)
    std::string        dev_ip;
    std::string        code;
};
Agent *g_agent = nullptr;

int fail(const char *what, int code)
{
    emscripten_log(EM_LOG_CONSOLE, "b3d-lan: %s (%d)", what, code);
    return code;
}

// ── The calls NetworkAgent.cpp looks up (signatures from its NetworkAgent.hpp typedefs) ─────────────────────
bool        b3d_check_debug_consistent(bool) { return true; }
// GUI_App::check_networking_version compares the first 8 characters with SLIC3R_VERSION: the agent is built with
// this very Bambu Studio, so it says so. The rest of the string says whose agent it is.
// OrcaSlicer (B3D_LAN_AGENT_ORCA) compares them with the network library version it is made for instead
// (bambu_networking.hpp get_latest_network_version), and keeps the library under a versioned name (below).
#ifdef B3D_LAN_AGENT_ORCA
std::string b3d_get_version() { return std::string(get_latest_network_version()) + "-boolean3d-lan"; }
#else
std::string b3d_get_version() { return std::string(SLIC3R_VERSION) + "-boolean3d-lan"; }
#endif
void *b3d_create_agent(std::string) { if (!g_agent) g_agent = new Agent(); return g_agent; }
int   b3d_destroy_agent(void *a) { if (a == g_agent) { delete g_agent; g_agent = nullptr; } return 0; }
int   b3d_ok_agent(void *) { return 0; }
int   b3d_ok_agent_str(void *, std::string) { return 0; }
int   b3d_ok_agent_str2(void *, std::string, std::string) { return 0; }
int   b3d_start(void *)
{
    // Opens (or reopens) the page's link to the helper; the helper answers with what it hears on the network.
    MAIN_THREAD_EM_ASM({ B3DLan.start(); });
    return 0;
}
int b3d_set_on_ssdp_msg_fn(void *a, OnMsgArrivedFn fn) { static_cast<Agent *>(a)->on_ssdp = fn; return 0; }
int b3d_set_on_local_connect_fn(void *a, OnLocalConnectedFn fn) { static_cast<Agent *>(a)->on_local_connect = fn; return 0; }
int b3d_set_on_local_message_fn(void *a, OnMessageFn fn) { static_cast<Agent *>(a)->on_local_message = fn; return 0; }
int b3d_set_queue_on_main_fn(void *a, QueueOnMainFn fn) { static_cast<Agent *>(a)->queue_on_main = fn; return 0; }
// Cloud-only callbacks: kept nowhere, there is no cloud.
int  b3d_set_ignored_fn_login(void *, OnUserLoginFn) { return 0; }
int  b3d_set_ignored_fn_printer(void *, OnPrinterConnectedFn) { return 0; }
int  b3d_set_ignored_fn_server(void *, OnServerConnectedFn) { return 0; }
int  b3d_set_ignored_fn_http(void *, OnHttpErrorFn) { return 0; }
int  b3d_set_ignored_fn_country(void *, GetCountryCodeFn) { return 0; }
int  b3d_set_ignored_fn_subscribe(void *, GetSubscribeFailureFn) { return 0; }
int  b3d_set_ignored_fn_message(void *, OnMessageFn) { return 0; }
int  b3d_set_ignored_fn_server_err(void *, OnServerErrFn) { return 0; }
bool b3d_false(void *) { return false; }
std::string b3d_empty(void *) { return ""; }
// The home page asks every 2 s who is signed in (GUI_App::get_login_info): nobody, ever.
std::string b3d_build_logout_cmd(void *) { return "{\"command\":\"studio_useroffline\",\"sequence_id\":\"\"}"; }

int b3d_connect_printer(void *a, std::string dev_id, std::string dev_ip, std::string username, std::string password, bool use_ssl)
{
    auto *ag = static_cast<Agent *>(a);
    {
        std::lock_guard<std::mutex> l(ag->m);
        ag->dev_id = dev_id;
        ag->dev_ip = dev_ip;
        ag->code   = password;
    }
    page_send(json{{"op", "connect"}, {"dev_id", dev_id}, {"ip", dev_ip}, {"user", username}, {"code", password}, {"ssl", use_ssl}}.dump());
    return 0;
}
int b3d_disconnect_printer(void *a)
{
    auto       *ag = static_cast<Agent *>(a);
    std::string dev;
    {
        std::lock_guard<std::mutex> l(ag->m);
        dev = ag->dev_id;
        ag->dev_id.clear();
    }
    if (!dev.empty()) page_send(json{{"op", "disconnect"}, {"dev_id", dev}}.dump());
    return 0;
}
int b3d_send_message_to_printer(void *, std::string dev_id, std::string json_str, int qos, int flag)
{
    page_send(json{{"op", "send"}, {"dev_id", dev_id}, {"msg", json_str}, {"qos", qos}}.dump());
    return 0;
}
bool b3d_start_discovery(void *, bool start, bool sending)
{
    page_send(json{{"op", "discover"}, {"on", start}, {"search", sending}}.dump());
    return true;
}
int  b3d_check_cert(void *) { return 0; }
void b3d_install_device_cert(void *, std::string, bool) {}

// "Connect by IP": who is at this address. The helper reads it from the printer (its certificate names its serial,
// its announcements its model and name). Called on a worker thread by InputIpAddressDialog / DeviceManager.
int b3d_bind_detect(void *, std::string dev_ip, std::string sec_link, detectResult &detect)
{
    const int id = g_next_id++;
    auto      w  = open_waiter(id);
    page_send(json{{"op", "detect"}, {"id", id}, {"ip", dev_ip}}.dump());
    json r = next_answer(w, 15000);
    close_waiter(id);
    if (r.is_null()) return fail("detect: the helper did not answer", -1);
    if (!r.value("ok", false)) return fail("detect: no printer at that address", -1);
    detect.result_msg   = "";
    detect.command      = "bind_detect";
    detect.dev_id       = r.value("dev_id", "");
    detect.model_id     = r.value("model_id", "");
    detect.dev_name     = r.value("dev_name", detect.dev_id);
    detect.version      = r.value("version", "");
    detect.bind_state   = r.value("bind_state", "free");
    detect.connect_type = r.value("connect_type", "lan");
    return 0;
}

// Sends the sliced file to the printer through the helper, and (print = true) starts it. Worker thread (PrintJob /
// SendJob). The helper stores it on the printer (FTPS), or for printers that fetch it themselves serves it on the
// house network, then sends the print command built from these parameters.
int send_file(const PrintParams &p, OnUpdateStatusFn update_fn, WasCancelledFn cancel_fn, bool print, bool verify_only)
{
    const int id = g_next_id++;
    auto      w  = open_waiter(id);
    json      req{{"op", print ? "print" : (verify_only ? "verify" : "upload")},
                  {"id", id},
                  {"dev_id", p.dev_id},
                  {"ip", p.dev_ip},
                  {"code", p.password},
                  {"project_name", p.project_name},
                  {"task_name", p.task_name},
                  {"plate_index", p.plate_index},
                  {"ftp_folder", p.ftp_folder},
                  {"ams_mapping", p.ams_mapping},
                  {"ams_mapping2", p.ams_mapping2},
                  {"ams_mapping_info", p.ams_mapping_info},
                  {"nozzle_mapping", p.nozzle_mapping},
                  {"nozzles_info", p.nozzles_info},
                  {"use_ams", p.task_use_ams},
                  {"bed_type", p.task_bed_type},
                  {"bed_leveling", p.task_bed_leveling},
                  {"flow_cali", p.task_flow_cali},
                  {"vibration_cali", p.task_vibration_cali},
                  {"layer_inspect", p.task_layer_inspect},
                  {"timelapse", p.task_record_timelapse},
                  {"auto_bed_leveling", p.auto_bed_leveling},
                  {"auto_flow_cali", p.auto_flow_cali},
                  {"auto_offset_cali", p.auto_offset_cali},
                  {"ext_change_assist", p.task_ext_change_assist},
                  {"try_emmc_print", p.try_emmc_print},
                  {"dst_file", p.dst_file}};
#ifndef B3D_LAN_AGENT_ORCA // OrcaSlicer's PrintParams has no manual extruder calibration mode
    req["extruder_cali_manual_mode"] = p.extruder_cali_manual_mode;
#endif
    // The file is read by the page (it owns the file system) and follows the request as one binary message.
    MAIN_THREAD_EM_ASM({ B3DLan.sendFile(UTF8ToString($0), UTF8ToString($1)); }, req.dump().c_str(), verify_only ? "" : p.filename.c_str());
    if (update_fn) update_fn(PrintingStageCreate, 0, "");
    int result = BAMBU_NETWORK_ERR_TIMEOUT;
    for (int quiet = 0; quiet < 240;) {
        if (cancel_fn && cancel_fn()) {
            page_send(json{{"op", "cancel"}, {"id", id}}.dump());
            result = BAMBU_NETWORK_ERR_CANCELED;
            break;
        }
        json m = next_answer(w, 500);
        if (m.is_null()) { ++quiet; continue; } // 2 minutes with no word from the helper = timed out
        quiet = 0;
        const std::string stage = m.value("stage", "");
        if (stage == "upload") {
            if (update_fn) update_fn(PrintingStageUpload, m.value("percent", 0), std::to_string(m.value("percent", 0)) + "%");
        } else if (stage == "sending") {
            if (update_fn) update_fn(PrintingStageSending, 0, "");
        } else if (stage == "done") {
            if (update_fn) update_fn(PrintingStageFinished, 0, "3");
            result = 0;
            break;
        } else if (stage == "error") {
            const std::string what = m.value("error", "");
            emscripten_log(EM_LOG_CONSOLE, "b3d-lan: %s failed: %s", req.value("op", "").c_str(), what.c_str());
            if (update_fn) update_fn(PrintingStageERROR, m.value("code", -1), what);
            result = m.value("code", BAMBU_NETWORK_ERR_PRINT_LP_UPLOAD_FTP_FAILED);
            break;
        }
    }
    close_waiter(id);
    return result;
}
int b3d_start_local_print(void *, PrintParams params, OnUpdateStatusFn update_fn, WasCancelledFn cancel_fn)
{
    return send_file(params, update_fn, cancel_fn, true, false);
}
int b3d_start_local_print_with_record(void *, PrintParams params, OnUpdateStatusFn update_fn, WasCancelledFn cancel_fn, OnWaitFn)
{
    return send_file(params, update_fn, cancel_fn, true, false);
}
// "Send" (to the printer's storage, no print). project_name "verify_job" = the access check PrintJob/SendJob make
// first: the helper logs in to the printer's storage and uploads nothing.
int b3d_start_send_gcode_to_sdcard(void *, PrintParams params, OnUpdateStatusFn update_fn, WasCancelledFn cancel_fn, OnWaitFn)
{
    return send_file(params, update_fn, cancel_fn, false, params.project_name == "verify_job");
}
int b3d_start_sdcard_print(void *, PrintParams params, OnUpdateStatusFn update_fn, WasCancelledFn cancel_fn)
{
    return send_file(params, update_fn, cancel_fn, true, true);
}
int b3d_get_camera_url(void *, std::string, std::function<void(std::string)> callback)
{
    if (callback) callback("");
    return -1;
}
int b3d_set_extra_http_header(void *, std::map<std::string, std::string>) { return 0; }
int b3d_track_enable(void *, bool) { return 0; }
int b3d_track_event(void *, std::string, std::string) { return 0; }
int b3d_track_header(void *, std::string) { return 0; }
int b3d_track_update_property(void *, std::string, std::string, std::string) { return 0; }
int b3d_track_get_property(void *, std::string, std::string &, std::string) { return 0; }

// Bambu's file-transfer tunnel (FileTransferUtils.hpp, ft_*: its own protocol on port 6000 for printers that store
// files on built-in memory). Not offered: every call says it could not be made, so FileTransferTunnel/Job see a
// failed connection (PrintJob then relies on start_send_gcode_to_sdcard's check, which the helper answers) instead
// of calling a null pointer. Files reach the printer through the helper.
extern "C" {
struct FT_Handle;
int  b3d_ft_abi_version() { return 1; }
void b3d_ft_free(void *) {}
void b3d_ft_destroy(void *) {}
int  b3d_ft_create(const char *, FT_Handle **out) { if (out) *out = nullptr; return -3; } // FT_EIO
void b3d_ft_handle(FT_Handle *) {}
int  b3d_ft_fail(FT_Handle *) { return -3; }
int  b3d_ft_fail_cb(FT_Handle *, void *, void *) { return -3; }
int  b3d_ft_fail2(FT_Handle *, FT_Handle *) { return -3; }
int  b3d_ft_fail_wait(FT_Handle *, uint32_t, void *) { return -4; } // FT_ETIMEOUT
int  b3d_ft_fail_msg(FT_Handle *, void *) { return -3; }
}

// The table NetworkAgent's dlsym look-ups read. Names not here are calls for the cloud: they stay unset, and
// NetworkAgent.cpp's wrappers then return their "not supported" defaults. ft_* = the refusing tunnel above.
const std::map<std::string, void *> &agent_calls()
{
    static const std::map<std::string, void *> t = {
        {"bambu_network_check_debug_consistent", (void *) &b3d_check_debug_consistent},
        {"bambu_network_get_version", (void *) &b3d_get_version},
        {"bambu_network_create_agent", (void *) &b3d_create_agent},
        {"bambu_network_destroy_agent", (void *) &b3d_destroy_agent},
        {"bambu_network_init_log", (void *) &b3d_ok_agent},
        {"bambu_network_set_config_dir", (void *) &b3d_ok_agent_str},
        {"bambu_network_set_cert_file", (void *) &b3d_ok_agent_str2},
        {"bambu_network_set_country_code", (void *) &b3d_ok_agent_str},
        {"bambu_network_start", (void *) &b3d_start},
        {"bambu_network_set_on_ssdp_msg_fn", (void *) &b3d_set_on_ssdp_msg_fn},
        {"bambu_network_set_on_user_login_fn", (void *) &b3d_set_ignored_fn_login},
        {"bambu_network_set_on_printer_connected_fn", (void *) &b3d_set_ignored_fn_printer},
        {"bambu_network_set_on_server_connected_fn", (void *) &b3d_set_ignored_fn_server},
        {"bambu_network_set_on_http_error_fn", (void *) &b3d_set_ignored_fn_http},
        {"bambu_network_set_get_country_code_fn", (void *) &b3d_set_ignored_fn_country},
        {"bambu_network_set_on_subscribe_failure_fn", (void *) &b3d_set_ignored_fn_subscribe},
        {"bambu_network_set_on_message_fn", (void *) &b3d_set_ignored_fn_message},
        {"bambu_network_set_on_user_message_fn", (void *) &b3d_set_ignored_fn_message},
        {"bambu_network_set_on_local_connect_fn", (void *) &b3d_set_on_local_connect_fn},
        {"bambu_network_set_on_local_message_fn", (void *) &b3d_set_on_local_message_fn},
        {"bambu_network_set_queue_on_main_fn", (void *) &b3d_set_queue_on_main_fn},
        {"bambu_network_set_server_callback", (void *) &b3d_set_ignored_fn_server_err},
        {"bambu_network_is_server_connected", (void *) &b3d_false},
        {"bambu_network_connect_printer", (void *) &b3d_connect_printer},
        {"bambu_network_disconnect_printer", (void *) &b3d_disconnect_printer},
        {"bambu_network_send_message_to_printer", (void *) &b3d_send_message_to_printer},
        {"bambu_network_update_cert", (void *) &b3d_check_cert},
        {"bambu_network_install_device_cert", (void *) &b3d_install_device_cert},
        {"bambu_network_start_discovery", (void *) &b3d_start_discovery},
        {"bambu_network_is_user_login", (void *) &b3d_false},
        {"bambu_network_build_logout_cmd", (void *) &b3d_build_logout_cmd},
        {"bambu_network_get_user_id", (void *) &b3d_empty},
        {"bambu_network_bind_detect", (void *) &b3d_bind_detect},
        {"bambu_network_start_local_print", (void *) &b3d_start_local_print},
        {"bambu_network_start_local_print_with_record", (void *) &b3d_start_local_print_with_record},
        {"bambu_network_start_send_gcode_to_sdcard", (void *) &b3d_start_send_gcode_to_sdcard},
        {"bambu_network_start_sdcard_print", (void *) &b3d_start_sdcard_print},
        {"bambu_network_get_camera_url", (void *) &b3d_get_camera_url},
        {"bambu_network_set_extra_http_header", (void *) &b3d_set_extra_http_header},
        {"bambu_network_track_enable", (void *) &b3d_track_enable},
        {"bambu_network_track_event", (void *) &b3d_track_event},
        {"bambu_network_track_header", (void *) &b3d_track_header},
        {"bambu_network_track_update_property", (void *) &b3d_track_update_property},
        {"bambu_network_track_get_property", (void *) &b3d_track_get_property},
        {"ft_abi_version", (void *) &b3d_ft_abi_version},
        {"ft_free", (void *) &b3d_ft_free},
        {"ft_job_result_destroy", (void *) &b3d_ft_destroy},
        {"ft_job_msg_destroy", (void *) &b3d_ft_destroy},
        {"ft_tunnel_create", (void *) &b3d_ft_create},
        {"ft_tunnel_retain", (void *) &b3d_ft_handle},
        {"ft_tunnel_release", (void *) &b3d_ft_handle},
        {"ft_tunnel_start_connect", (void *) &b3d_ft_fail_cb},
        {"ft_tunnel_sync_connect", (void *) &b3d_ft_fail},
        {"ft_tunnel_set_status_cb", (void *) &b3d_ft_fail_cb},
        {"ft_tunnel_shutdown", (void *) &b3d_ft_fail},
        {"ft_job_create", (void *) &b3d_ft_create},
        {"ft_job_retain", (void *) &b3d_ft_handle},
        {"ft_job_release", (void *) &b3d_ft_handle},
        {"ft_job_set_result_cb", (void *) &b3d_ft_fail_cb},
        {"ft_job_get_result", (void *) &b3d_ft_fail_wait},
        {"ft_tunnel_start_job", (void *) &b3d_ft_fail2},
        {"ft_job_cancel", (void *) &b3d_ft_fail},
        {"ft_job_set_msg_cb", (void *) &b3d_ft_fail_cb},
        {"ft_job_try_get_msg", (void *) &b3d_ft_fail_msg},
        {"ft_job_get_msg", (void *) &b3d_ft_fail_wait},
    };
    return t;
}

char g_agent_handle;  // what dlopen of libbambu_networking.so returns
char g_source_handle; // what dlopen of libBambuSource.so returns (the camera calls, lan_printer_camera.cpp)

bool ends_with(const char *s, const char *tail)
{
    const size_t n = std::strlen(s), m = std::strlen(tail);
    return n >= m && std::strcmp(s + n - m, tail) == 0;
}

} // namespace

// The camera calls (BambuTunnel.h), lan_printer_camera.cpp.
extern "C" void *b3d_lan_camera_symbol(const char *name);
extern "C" void  b3d_lan_camera_failed(const char *dev_id, const char *error);

extern "C" {

void *__wrap_dlopen(const char *path, int flags)
{
    if (path && ends_with(path, "/libbambu_networking.so")) return &g_agent_handle;
#ifdef B3D_LAN_AGENT_ORCA
    // Orca: <data dir>/plugins/libbambu_networking_<version>.so (BBLNetworkPlugin::initialize)
    if (path && std::strstr(path, "/libbambu_networking_") && ends_with(path, ".so")) return &g_agent_handle;
#endif
    if (path && ends_with(path, "/libBambuSource.so")) return &g_source_handle;
    return __real_dlopen(path, flags);
}
void *__wrap_dlsym(void *handle, const char *name)
{
    if (handle == &g_agent_handle) {
        auto &t = agent_calls();
        auto  it = t.find(name);
        return it == t.end() ? nullptr : it->second;
    }
    if (handle == &g_source_handle) return b3d_lan_camera_symbol(name);
    return __real_dlsym(handle, name);
}
int __wrap_dlclose(void *handle)
{
    if (handle == &g_agent_handle || handle == &g_source_handle) return 0;
    return __real_dlclose(handle);
}

// What the helper says, delivered by the page on the main thread (lan-printer-link.js). Bambu Studio's callbacks hop to its
// own main loop themselves (CallAfter), as they do for the desktop plugin's threads.
EMSCRIPTEN_KEEPALIVE void b3d_lan_incoming(const char *text)
{
    json m = json::parse(text, nullptr, false);
    if (m.is_discarded()) return;
    const std::string ev = m.value("ev", "");
    if (m.contains("id") && m["id"].is_number_integer()) {
        std::shared_ptr<Waiter> w;
        {
            std::lock_guard<std::mutex> l(g_wait_m);
            auto it = g_waiters.find(m["id"].get<int>());
            if (it != g_waiters.end()) w = it->second;
        }
        if (w) {
            std::lock_guard<std::mutex> l(w->m);
            w->msgs.push_back(std::move(m));
            w->cv.notify_all();
        }
        return;
    }
    if (ev == "camera") {
        if (!m.value("ok", true)) b3d_lan_camera_failed(m.value("dev_id", "").c_str(), m.value("error", "").c_str());
        return;
    }
    Agent *ag = g_agent;
    if (!ag) return;
    if (ev == "ssdp") {
        if (ag->on_ssdp) ag->on_ssdp(m["info"].dump());
    } else if (ev == "connect") {
        // status: 0 ok, 1 failed (msg "5" = the access code was refused, as MQTT says it), 2 lost
        if (ag->on_local_connect) ag->on_local_connect(m.value("status", 1), m.value("dev_id", ""), m.value("msg", ""));
    } else if (ev == "msg") {
        if (ag->on_local_message) ag->on_local_message(m.value("dev_id", ""), m.value("msg", ""));
    }
}

} // extern "C"
