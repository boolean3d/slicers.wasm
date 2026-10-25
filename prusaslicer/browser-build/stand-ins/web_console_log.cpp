// The slicer logs to a file (data_dir/log, as on desktop); a tab that dies takes it along, so the log also goes to the
// browser console. In the worker build every console line is a round trip to the page (13,500 at start-up at the "info"
// level), so by default the console gets warnings and errors only; the page can ask for more with index.html?log=<level>
// (fatal, error, warning, info, debug, trace: the *-pre.js writes the level to /home/web_user/.b3d-console-log before the
// program starts). The program's own level (its config, --debug) still gates everything.
#include <boost/log/core.hpp>
#include <boost/log/trivial.hpp>
#include <boost/log/expressions.hpp>
#include <boost/log/utility/setup/console.hpp>
#include <fstream>
#include <iostream>
#include <string>

namespace {
struct WebConsoleLog {
    WebConsoleLog() {
        auto sink = boost::log::add_console_log(std::cerr);
        sink->locked_backend()->auto_flush(true);
        boost::log::trivial::severity_level level = boost::log::trivial::warning;
        std::ifstream f("/home/web_user/.b3d-console-log");
        std::string name;
        if (f >> name) {
            if (name == "fatal") level = boost::log::trivial::fatal;
            else if (name == "error") level = boost::log::trivial::error;
            else if (name == "warning") level = boost::log::trivial::warning;
            else if (name == "info") level = boost::log::trivial::info;
            else if (name == "debug") level = boost::log::trivial::debug;
            else if (name == "trace") level = boost::log::trivial::trace;
        }
        sink->set_filter(boost::log::trivial::severity >= level);
    }
} web_console_log;
}

// off-thread phase 2h (presets-bundle-reader.js): a place in wasm memory every thread can find. The vendor preset bundles are read
// into the heap once and shared by every thread through these slots (16 bundles x [state, address, size, spare]); slot
// 60 counts chdir calls so a thread's cached working directory is dropped when any thread changes it.
#include <emscripten.h>
#include <cstdint>
extern "C" {
static uint32_t b3d_bundle_slots[64] = {0};
EMSCRIPTEN_KEEPALIVE uint32_t *b3d_bundle_slots_addr() { return b3d_bundle_slots; }
}
