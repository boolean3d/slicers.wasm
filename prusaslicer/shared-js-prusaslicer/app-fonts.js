// The slicer's own fonts as installed fonts of the page (--pre-js, every slicer). On the Linux desktop the app's
// resources/fonts (HarmonyOS Sans SC, its CJK fonts, Symbola) are known to fontconfig (AddPrivateFont, or the Flatpak
// installs them), so every wxFont naming them draws with them. The browser knew none of them: wx text fell back to
// another sans and measured differently. They are already in the preloaded data (/<app>/resources/fonts); here they
// become FontFaces of the document before the program starts (a run dependency holds main until they are parsed).
// Web views (iframes) are separate documents and keep the browser's fonts, as WebKitGTK keeps fontconfig's.
// /wx-fonts (shared/fonts, preloaded by every slicer) holds the system font, Noto Sans: on the desktop GTK draws
// menus, stock dialogs and plain controls with fontconfig's 'Sans' (Noto Sans); the port's wxFont asks for it first.
(function () {
  var FACES = {
    'HarmonyOS_Sans_SC_Regular.ttf': ['HarmonyOS Sans SC', '400'],
    'HarmonyOS_Sans_SC_Bold.ttf': ['HarmonyOS Sans SC', '700'],
    'NanumGothic-Regular.ttf': ['NanumGothic', '400'],
    'NanumGothic-Bold.ttf': ['NanumGothic', '700'],
    'SourceHanSansJP-Normal.otf': ['Source Han Sans JP Normal', '400'],
    'SourceHanSansJP-Bold.otf': ['Source Han Sans JP Normal', '700'],
    'NotoSansKR-Regular.ttf': ['Noto Sans KR', '400'],
    'NotoSansKR-Bold.ttf': ['Noto Sans KR', '700'],
    'Symbola.ttf': ['Symbola', '400'],
    'NotoSans-Regular.ttf': ['Noto Sans', '400'],
    'NotoSans-Bold.ttf': ['Noto Sans', '700'],
    'NotoSans-Italic.ttf': ['Noto Sans', '400', 'italic'],
    'NotoSans-BoldItalic.ttf': ['Noto Sans', '700', 'italic']
  };
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;   // workers
  Module.preRun = Module.preRun || [];
  if (!Array.isArray(Module.preRun)) Module.preRun = [Module.preRun];
  Module.preRun.push(function () {
    addRunDependency('app-fonts');
    var started = false;
    var start = function () {
      if (started) return;
      started = true;
      var jobs = [];
      var dirs = ['/wx-fonts'];
      FS.readdir('/').forEach(function (top) { dirs.push('/' + top + '/resources/fonts'); });
      dirs.forEach(function (dir) {
        var names;
        try { names = FS.readdir(dir); } catch (e) { return; }
        names.forEach(function (n) {
          var f = FACES[n];
          if (!f) return;
          try {
            var bytes = FS.readFile(dir + '/' + n);
            var face = new FontFace(f[0], bytes, { weight: f[1], style: f[2] || 'normal' });
            document.fonts.add(face);
            jobs.push(face.load().catch(function (e) { console.error('font ' + n + ': ' + e); }));
          } catch (e) { console.error('font ' + n + ': ' + e); }
        });
      });
      Promise.all(jobs).then(function () { removeRunDependency('app-fonts'); });
    };
    // the preloaded data is in the file system once only this dependency is left
    var monitor = Module.monitorRunDependencies;
    Module.monitorRunDependencies = function (left) {
      if (monitor) monitor(left);
      if (left === 1) setTimeout(start, 0);
    };
    if (runDependencies === 1) setTimeout(start, 0);
  });
})();
