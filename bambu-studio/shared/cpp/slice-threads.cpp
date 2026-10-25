// Slicing threads in a browser tab: at most min(cores, 8), for the whole run of the program.
// Every TBB worker keeps its own allocator pages (~32 MB each while slicing) and an 8 MB stack inside the
// tab's one 4 GB memory, so a 56-core computer sliced with 55 workers for little gain (PrusaSlicer in a tab:
// Benchy 3.3 GB at 56 threads, 1.75 GB at 8). The page's thread pool is sized to match (browser-build/CMakeLists.txt
// PTHREAD_POOL_SIZE min(hc,8)+16). Built into each slicer from shared/cpp.
// The limit is made on the first turn of the page's event loop, not as a global object: TBB's own control
// tables are global objects too, and a global_control built before them called a null function at start-up
// (b12/o5: "null function or function signature mismatch" in __wasm_call_ctors). The limit applies to arenas
// made earlier as well (TBB re-reads max_allowed_parallelism).
#include <tbb/global_control.h>
#include <emscripten.h>
#include <emscripten/threading.h>
#include <algorithm>

namespace {
void make_limit(void*)
{
    static tbb::global_control limit(tbb::global_control::max_allowed_parallelism,
                                     std::max(1, std::min(emscripten_num_logical_cores(), 8)));
}
struct Deferred { Deferred() { emscripten_async_call(make_limit, nullptr, 0); } } deferred;
}
