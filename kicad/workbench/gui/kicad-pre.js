// The browser tab is laid out like KiCad's Linux install: programs at /kicad/bin, data at /kicad/share/kicad
// (preloaded: demos, template; CMAKE_INSTALL_PREFIX=/kicad), Python's library at /kicad/lib/python3.12, the user's
// settings under /home/web_user/.config/kicad/10.0. Which program this page is comes from its folder name.
Module.preRun = Module.preRun || [];
Module.preRun.push(function () {
  var prog = (location.pathname.match(/\/(kicad|eeschema|pcbnew)\/[^/]*$/) || [0, 'kicad'])[1];
  FS.mkdirTree('/kicad/bin'); FS.mkdirTree('/kicad/share/kicad'); FS.mkdirTree('/kicad/lib');
  ['kicad', 'eeschema', 'pcbnew'].forEach(function (p) { FS.writeFile('/kicad/bin/' + p, ''); });
  try { FS.symlink('/kicad/bin/' + prog, '/proc/self/exe'); } catch (e) { console.warn('exe link', e); }
  FS.mkdirTree('/home/web_user/.config/kicad'); FS.mkdirTree('/home/web_user/.local/share/kicad');
  FS.mkdirTree('/home/web_user/.cache/kicad'); FS.mkdirTree('/home/web_user/Documents');
  ENV.HOME = '/home/web_user'; ENV.DISPLAY = ':0';
  // test switch ?glcache=MASK for the GL stand-in's state caches (gl_es_compat.cpp cacheMask)
  var glc = new URLSearchParams(location.search).get('glcache'); if (glc) ENV.KIGL_CACHE = glc;
  ENV.PYTHONHOME = '/kicad'; ENV.PYTHONPATH = '/kicad/lib/python3.12';
  ENV.KICAD10_SYMBOL_DIR = '/kicad/share/kicad/symbols'; ENV.KICAD10_FOOTPRINT_DIR = '/kicad/share/kicad/footprints';
  ENV.KICAD10_3DMODEL_DIR = '/kicad/share/kicad/3dmodels'; ENV.KICAD10_TEMPLATE_DIR = '/kicad/share/kicad/template';
  ENV.FONTCONFIG_PATH = '/etc/fonts'; ENV.FONTCONFIG_FILE = '/etc/fonts/fonts.conf';
});
// The demo projects as the person's own files: copied into the home folder (which home-sync keeps) at the first start,
// so an edit saved there is still there after a reload; the preloaded copies under /kicad/share stay as shipped.
// Not a preRun: the preloaded .data package is unpacked after the preRun functions ran (its own run dependency), so a
// preRun copy found the folders of the demos and none of their files (10-25). onRuntimeInitialized comes after every
// run dependency (the package, home-sync's put-back) and before main().
var prevInit = Module.onRuntimeInitialized;
Module.onRuntimeInitialized = function () {
  if (prevInit) prevInit();
  var src = '/kicad/share/kicad/demos', dst = '/home/web_user/Documents/kicad-demos';
  var copy = function (a, b) { FS.mkdirTree(b); FS.readdir(a).forEach(function (n) { if (n === '.' || n === '..') return;
    var st = FS.stat(a + '/' + n); if (FS.isDir(st.mode)) copy(a + '/' + n, b + '/' + n); else FS.writeFile(b + '/' + n, FS.readFile(a + '/' + n)); }); };
  if (!FS.analyzePath(dst).exists) {
    try { copy(src, dst); console.log('kicad: demos copied to ' + dst + ' (' + FS.readdir(dst).length + ' entries)'); } catch (e) { console.warn('kicad: demos not copied', e); }
  }
  pruneTables(dst);
};
// The demos' own library tables list KiCad's stock symbol and footprint libraries (${KICAD10_FOOTPRINT_DIR}/LED_THT.pretty
// ...), which this tab does not carry (~1 GB): every board opened with 20-30 "library not found" load messages. Rows whose
// library is not in the tab are taken out of the copies in the home folder (the shipped copies stay as they are); the parts
// themselves are stored in the board and schematic files, so nothing drawn changes. Runs at every start (homes made before).
function pruneTables(dir) {
  var vars = { KICAD10_FOOTPRINT_DIR: '/kicad/share/kicad/footprints', KICAD10_SYMBOL_DIR: '/kicad/share/kicad/symbols',
    KICAD10_3DMODEL_DIR: '/kicad/share/kicad/3dmodels', KICAD10_TEMPLATE_DIR: '/kicad/share/kicad/template' };
  var walk = function (d) {
    FS.readdir(d).forEach(function (n) {
      if (n === '.' || n === '..') return; var f = d + '/' + n, st = FS.stat(f);
      if (FS.isDir(st.mode)) return walk(f);
      if (n !== 'fp-lib-table' && n !== 'sym-lib-table') return;
      var text = FS.readFile(f, { encoding: 'utf8' }), gone = 0;
      var kept = text.split('\n').filter(function (l) {
        var m = l.match(/\(uri "\$\{(KICAD\d+_[A-Z0-9_]+_DIR)\}([^"]*)"\)/);
        if (!m || !vars[m[1]] || FS.analyzePath(vars[m[1]] + m[2]).exists) return true;
        gone++; return false;
      });
      if (gone) { FS.writeFile(f, kept.join('\n')); console.log('kicad: ' + gone + ' stock libraries not in this tab left out of ' + f); }
    });
  };
  try { if (FS.analyzePath(dir).exists) walk(dir); } catch (e) { console.warn('kicad: library tables not pruned', e); }
}
// index.html?log=<fatal|error|warning|info|debug|trace>: what the browser console shows (stubs/web_console_log.cpp)
Module.preRun.push(function () {
  const log = new URLSearchParams(location.search).get('log');
  if (log) { FS.mkdirTree('/home/web_user'); FS.writeFile('/home/web_user/.b3d-console-log', log); }
});
// Program arguments from the page address: index.html?arg=/kicad/share/kicad/demos/ecc83/ecc83-pp.kicad_pro
Module.arguments = Module.arguments || new URLSearchParams(location.search).getAll('arg');
Module['onAbort'] = function (what) { console.error('ABORT ' + what + '\n' + new Error().stack.split('\n').slice(1, 40).map(function (l) { return l.trim(); }).join('\n')); };
// Test switch for the software drawing: <program>/?gl=off | fail | lose[:seconds]. The page passes it on to
// index.js's address, so the program's threads (where the OpenGL canvases are, as OffscreenCanvases) see it too.
//   off   no WebGL context at all: the WebGL2 check before the first OpenGL canvas fails
//   fail  the 1x1 check passes, every real canvas gets none: OpenGL fails to start
//   lose  real canvases work, then lose their context after the given seconds (default 40): the context is lost while drawing
// The console says "kicad: test switch gl=..." each time it acts. Nothing changes without the switch.
(function () {
  var m = (new URLSearchParams(location.search).get('gl') || '').match(/^(off|fail|lose)(?::(\d+))?$/);
  if (!m || typeof OffscreenCanvas === 'undefined') return;
  var mode = m[1], after = Number(m[2] || 40) * 1000, get = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function (type, attrs) {
    var gl = /^(webgl2?|experimental-webgl)$/.test(type), check = this.width === 1 && this.height === 1;
    if (gl && (mode === 'off' || (mode === 'fail' && !check))) {
      console.log('kicad: test switch gl=' + mode + ': no ' + type + ' context for a ' + this.width + 'x' + this.height + ' canvas');
      return null;
    }
    var ctx = get.call(this, type, attrs);
    if (gl && ctx && mode === 'lose' && !check && !ctx.b3dLoseSet) {
      ctx.b3dLoseSet = true;
      var w = this.width, h = this.height, lose = ctx.getExtension('WEBGL_lose_context');
      setTimeout(function () {
        console.log('kicad: test switch gl=lose: losing the ' + w + 'x' + h + ' canvas\'s context');
        if (lose) lose.loseContext();
      }, after);
    }
    return ctx;
  };
})();
