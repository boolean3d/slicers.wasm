// The browser tab is laid out like PrusaSlicer's Linux build: the program at /prusa/bin/prusa-slicer and its
// resources at /prusa/resources (preloaded). PrusaSlicer finds them from /proc/self/exe (boost::dll::program_location).
Module.preRun = Module.preRun || [];
Module.preRun.push(function () {
  FS.mkdirTree('/prusa/bin');
  FS.writeFile('/prusa/bin/prusa-slicer', '');
  try { FS.symlink('/prusa/bin/prusa-slicer', '/proc/self/exe'); } catch (e) { console.warn('exe link', e); }
  FS.mkdirTree('/home/web_user/.config/PrusaSlicer');
  // the home's Downloads folder, as on a desktop: the wizard's built-in downloader saves there (Finish refused it missing)
  FS.mkdirTree('/home/web_user/Downloads');
  // PrusaSlicer's Linux start (CLI/GuiParams.cpp start_gui_with_params) opens the GUI only when DISPLAY is set;
  // the tab is the display.
  ENV.DISPLAY = ':0';
});
// index.html?log=<fatal|error|warning|info|debug|trace>: what the browser console shows (stand-ins/web_console_log.cpp;
// warnings and errors without it); the program's own level is still ?arg=--loglevel=N
Module.preRun.push(function () {
  const log = new URLSearchParams(location.search).get('log');
  if (log) { FS.mkdirTree('/home/web_user'); FS.writeFile('/home/web_user/.b3d-console-log', log); }
});
// Program arguments from the page address: index.html?arg=--loglevel=5&arg=...
Module.arguments = Module.arguments || new URLSearchParams(location.search).getAll('arg');
// Slicing threads: PrusaSlicer's own --threads (max_allowed_parallelism), at most SLICE_THREADS. Each slicing thread
// keeps its own allocator pages (~32 MB per thread for a Benchy) inside the 4 GB wasm memory: 56 threads peaked at
// 3.3 GB, 8 at 1.8 GB. A --threads in the page address wins. The thread pool (CMakeLists PTHREAD_POOL_SIZE) matches.
var SLICE_THREADS = 8;
if (!Module.arguments.some(function (a) { return /^--threads(=|$)/.test(a); }))
  Module.arguments.push('--threads=' + Math.max(1, Math.min(navigator.hardwareConcurrency || 1, SLICE_THREADS)));
// An abort (main thread or a worker) prints where it came from: wasm-function[n] -> pgui/index.html.symbols
Module['onAbort'] = function (what) { console.error('ABORT ' + what + '\n' + new Error().stack.split('\n').slice(1, 40).map(function (l) { return l.trim(); }).join('\n')); };
