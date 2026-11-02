// The browser tab is laid out like Creality's Linux tarball: the program at /creality/bin/CrealityPrint and its
// resources at /creality/resources (preloaded). Orca finds them from /proc/self/exe (boost::dll::program_location).
Module.preRun = Module.preRun || [];
Module.preRun.push(function () {
  FS.mkdirTree('/creality/bin');
  FS.writeFile('/creality/bin/CrealityPrint', '');
  try { FS.symlink('/creality/bin/CrealityPrint', '/proc/self/exe'); } catch (e) { console.warn('exe link', e); }
  FS.mkdirTree('/home/web_user/.config');
});
// Program arguments from the page address: index.html?arg=--loglevel=5&arg=...
Module.arguments = Module.arguments || new URLSearchParams(location.search).getAll('arg');
// index.html?log=trace: start with a Creality.conf whose log level is that (Orca's GUI takes its level from there).
Module.preRun.push(function () {
  const log = new URLSearchParams(location.search).get('log');
  if (!log) return;
  FS.mkdirTree('/home/web_user/.Creality');
  FS.writeFile('/home/web_user/.Creality/Creality.conf', JSON.stringify({ app: { log_severity_level: log } }));
  FS.writeFile('/home/web_user/.b3d-console-log', log);   // the console sink's level (stand-ins/web_console_log.cpp)
});
// An abort (main thread or a worker) prints where it came from: wasm-function[n] -> bgui/index.html.symbols
Module['onAbort'] = function (what) { console.error('ABORT ' + what + '\n' + new Error().stack.split('\n').slice(1, 40).map(function (l) { return l.trim(); }).join('\n')); };
