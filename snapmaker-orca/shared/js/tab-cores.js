// --js-library: the program sees min(cores, 8) processor cores, on every thread (sysconf, std::thread::hardware_concurrency,
// TBB's default concurrency all come from emscripten_num_logical_cores). One number for "cores" everywhere, as on a
// desktop with 8 cores. Why 8: every slicing thread keeps its own allocator pages (~32 MB while slicing) and an 8 MB
// stack inside the tab's one 4 GB memory (PrusaSlicer Benchy 3.3 GB at 56 threads, 1.75 GB at 8); the page's thread
// pool is sized to match (browser-build/CMakeLists.txt PTHREAD_POOL_SIZE min(hc,8)+16).
// This REPLACES shared/cpp/slice-threads.cpp (tbb::global_control max_allowed_parallelism): that capped TBB's workers
// but tbb::this_task_arena::max_concurrency() still said hc, and libslic3r Thread.cpp
// name_tbb_thread_pool_threads_set_locale() (run at the first Slice) is a barrier over max_concurrency() tasks that
// each wait until all have arrived. On a computer with more than 8 cores only 8 arrived: the 8 slicing threads waited
// for ever and Bambu Studio froze at its first Slice (Windows Chrome, 20 hardware threads).
addToLibrary({
  emscripten_num_logical_cores: () => Math.min(navigator['hardwareConcurrency'] || 1, 8),
});
