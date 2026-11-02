// The browser tab is laid out like Anycubic's build tree: the program at /anycubic/bin/Release/anycubic-slicer-next and its
// resources at /anycubic/resources (preloaded). Anycubic finds them from /proc/self/exe (boost::dll::program_location): its
// main looks for <exe dir>/Resources (its Linux package), else <exe dir>/../../resources (a multi-config build's bin/Release),
// which is /anycubic/resources here, the path the package serves the web pages at (file:///anycubic/resources/web/...).
Module.preRun = Module.preRun || [];
Module.preRun.push(function () {
  FS.mkdirTree('/anycubic/bin/Release');
  FS.writeFile('/anycubic/bin/Release/anycubic-slicer-next', '');
  try { FS.symlink('/anycubic/bin/Release/anycubic-slicer-next', '/proc/self/exe'); } catch (e) { console.warn('exe link', e); }
  FS.mkdirTree('/home/web_user/.config');
});
// Program arguments from the page address: index.html?arg=--loglevel=5&arg=...
Module.arguments = Module.arguments || new URLSearchParams(location.search).getAll('arg');
// index.html?log=trace: start with an AnycubicSlicerNext.conf whose log level is that (Orca's GUI takes its level from there).
Module.preRun.push(function () {
  const log = new URLSearchParams(location.search).get('log');
  if (!log) return;
  FS.mkdirTree('/home/web_user/.AnycubicSlicerNext');
  FS.writeFile('/home/web_user/.AnycubicSlicerNext/AnycubicSlicerNext.conf', JSON.stringify({ app: { log_severity_level: log } }));
  FS.writeFile('/home/web_user/.b3d-console-log', log);   // the console sink's level (stand-ins/web_console_log.cpp)
});
// An abort (main thread or a worker) prints where it came from: wasm-function[n] -> bgui/index.html.symbols
Module['onAbort'] = function (what) { console.error('ABORT ' + what + '\n' + new Error().stack.split('\n').slice(1, 40).map(function (l) { return l.trim(); }).join('\n')); };
