// The slicer's own fonts as installed fonts of the page (--pre-js, every slicer). On the Linux desktop the app's
// resources/fonts (HarmonyOS Sans SC, its CJK fonts, Symbola) are known to fontconfig (AddPrivateFont, or the Flatpak
// installs them), so every wxFont naming them draws with them. The browser knew none of them: wx text fell back to
// another sans and measured differently. They are already in the preloaded data (/<app>/resources/fonts); here they
// become FontFaces of the document before the program starts (a run dependency holds main until they are parsed).
// Web views (iframes) are separate documents and keep the browser's fonts, as WebKitGTK keeps fontconfig's.
// /wx-fonts (shared/fonts, preloaded by every slicer) holds the system font, Noto Sans: on the desktop GTK draws
// menus, stock dialogs and plain controls with fontconfig's 'Sans' (Noto Sans); the port's wxFont asks for it first.
// main() runs in a worker, which measures and draws text on its own OffscreenCanvas with its own font set
// (self.fonts): the bytes are kept (Module.wxFontFaces) and Module.wxPostFonts() posts copies of them to the
// program's thread as { wx: 'fonts', faces: [{ family, weight, style, data: ArrayBuffer }] } (transferred); the
// worker-side inbox (wx.js) makes its FontFaces and resolves the promise the C++ side awaits before the first paint.
// The page keeps its own FontFaces as before (document.fonts: web views, the page's own text).
// The lazy (non-start) fonts of package/install-and-lazy-load.js are page-only FontFaces by URL and are NOT posted yet (not in this build).
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
  Module.wxFontFaces = [];   // [{ family, weight, style, data: Uint8Array }], filled before main runs
  Module.wxPostFonts = function () {
    var faces = [], buffers = [];
    Module.wxFontFaces.forEach(function (f) {
      var copy = f.data.slice();   // the page keeps f.data; the copy's buffer is transferred
      faces.push({ family: f.family, weight: f.weight, style: f.style, data: copy.buffer });
      buffers.push(copy.buffer);
    });
    // the package's lazy fonts (install-and-lazy-load.js, by address with a unicode range; .load = the language's, wanted before the first paint)
    Module.wxPage.post({ wx: 'fonts-url', faces: Module.wxLazyFonts || [] });
    Module.wxPage.post({ wx: 'fonts', faces: faces }, buffers);   // an empty list is posted too: the worker's wait ends
    return faces.length;
  };
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
            var bytes = FS.readFile(dir + '/' + n);   // a fresh Uint8Array (not a heap view): safe to keep
            var face = new FontFace(f[0], bytes, { weight: f[1], style: f[2] || 'normal' });
            document.fonts.add(face);
            Module.wxFontFaces.push({ family: f[0], weight: f[1], style: f[2] || 'normal', data: bytes });
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
