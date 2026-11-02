// The browser tab is laid out like Orca's Linux tarball: the program at /snapmaker/bin/snapmaker-orca and its
// resources at /orca/resources (preloaded). Orca finds them from /proc/self/exe (boost::dll::program_location).
Module.preRun = Module.preRun || [];
Module.preRun.push(function () {
  FS.mkdirTree('/snapmaker/bin');
  FS.writeFile('/snapmaker/bin/snapmaker-orca', '');
  try { FS.symlink('/snapmaker/bin/snapmaker-orca', '/proc/self/exe'); } catch (e) { console.warn('exe link', e); }
  FS.mkdirTree('/home/web_user/.config');
});
// Program arguments from the page address: index.html?arg=--loglevel=5&arg=...
Module.arguments = Module.arguments || new URLSearchParams(location.search).getAll('arg');
// index.html?log=trace: start with an OrcaSlicer.conf whose log level is that (Orca's GUI takes its level from there).
Module.preRun.push(function () {
  const log = new URLSearchParams(location.search).get('log');
  if (!log) return;
  FS.mkdirTree('/home/web_user/.Snapmaker_Orca');
  FS.writeFile('/home/web_user/.Snapmaker_Orca/Snapmaker_Orca.conf', JSON.stringify({ app: { log_severity_level: log } }));
  FS.writeFile('/home/web_user/.b3d-console-log', log);   // the console sink's level (stand-ins/web_console_log.cpp)
});
// An abort (main thread or a worker) prints where it came from: wasm-function[n] -> bgui/index.html.symbols
Module['onAbort'] = function (what) { console.error('ABORT ' + what + '\n' + new Error().stack.split('\n').slice(1, 40).map(function (l) { return l.trim(); }).join('\n')); };
