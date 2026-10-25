// The browser tab is laid out like Bambu Studio's Linux AppImage: the program at /bambu/bin/bambu-studio and its
// resources at /bambu/resources (preloaded). Bambu finds them from /proc/self/exe (boost::dll::program_location).
Module.preRun = Module.preRun || [];
Module.preRun.push(function () {
  FS.mkdirTree('/bambu/bin');
  FS.writeFile('/bambu/bin/bambu-studio', '');
  try { FS.symlink('/bambu/bin/bambu-studio', '/proc/self/exe'); } catch (e) { console.warn('exe link', e); }
  FS.mkdirTree('/home/web_user/.config');
  // Bambu's own preset bundle (resources/profiles/BBL, 2,541 files) was copied into ~/.BambuStudio/system on EVERY load,
  // the tab's file system starting empty: 56,000 file calls, most of the start (4 s when main() runs in a worker and
  // each call crosses to the page). With the installed bundle being the resource bundle itself (links), the updater
  // finds the same version and copies nothing (PresetUpdater::priv::check_installed_vendor_profiles; the links point
  // into the preloaded data, which arrives after preRun: fine, a link may dangle until then).
  FS.mkdirTree('/home/web_user/.BambuStudio/system');
  ['BBL.json', 'BBL'].forEach(function (n) {
    try { FS.symlink('/bambu/resources/profiles/' + n, '/home/web_user/.BambuStudio/system/' + n); } catch (e) { console.warn('bundle link', n, e); }
  });
});
// Program arguments from the page address: index.html?arg=--loglevel=5&arg=...
Module.arguments = Module.arguments || new URLSearchParams(location.search).getAll('arg');
// index.html?log=trace: start with a BambuStudio.conf whose log level is that.
// index.html?printer=H2S: start as if the setup wizard had been finished with that Bambu Lab printer (0.4 nozzle,
// 0.20mm Standard, Bambu PLA Basic) chosen.
Module.preRun.push(function () {
  const q = new URLSearchParams(location.search);
  const log = q.get('log'), printer = q.get('printer');
  // &recent=1 (look tests): a project in the recent list (Box.3mf from the calibration models), as after opening one.
  const recent = q.get('recent');
  if (!log && !printer && !recent) return;
  const conf = { app: {} };
  if (log) {
    conf.app.log_severity_level = log; conf.app.severity_level = log;   // Bambu Studio reads severity_level (Orca: log_severity_level)
    FS.mkdirTree('/home/web_user'); FS.writeFile('/home/web_user/.b3d-console-log', log);   // the console sink's level (stand-ins/web_console_log.cpp)
  }
  if (printer) {
    const model = 'Bambu Lab ' + printer;
    Object.assign(conf.app, { region: 'North America', language: 'en_US' });
    conf.firstguide = { finish: 'true', privacyuse: 'false' };
    conf.models = [{ vendor: 'BBL', model: model, nozzle_diameter: '0.4' }];
    conf.filaments = ['Bambu PLA Basic @BBL ' + printer];
    conf.presets = { machine: model + ' 0.4 nozzle', print: '0.20mm Standard @BBL ' + printer, filaments: ['Bambu PLA Basic @BBL ' + printer] };
  }
  // Bambu Studio's data folder in the tab (wxStandardPaths: ~/.BambuStudio)
  FS.mkdirTree('/home/web_user/.BambuStudio');
  if (recent) {
    // the preloaded resources arrive after this runs: copy the file once they are in, before main starts
    const src = '/bambu/resources/calib/filament_flow/flowrate-test-pass1.3mf';
    addRunDependency('b3d-recent');
    (function copy() {
      if (!FS.analyzePath(src).exists) return setTimeout(copy, 50);
      FS.mkdirTree('/home/web_user/Boolean3d');
      FS.writeFile('/home/web_user/Boolean3d/Box.3mf', FS.readFile(src));
      removeRunDependency('b3d-recent');
    })();
    conf.recent_projects = { '001': '/home/web_user/Boolean3d/Box.3mf' };
  }
  FS.writeFile('/home/web_user/.BambuStudio/BambuStudio.conf', JSON.stringify(conf));
});
