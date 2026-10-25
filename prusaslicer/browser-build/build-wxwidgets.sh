# The wasm wx port forward-ported onto PrusaSlicer's wx 3.2.6 fork (/w/pwx, git: base, prusa-fixes, port commit),
# into /w/prefix-wx. Strings are wchar_t (PrusaSlicer's Windows build; the port's code is written for that).
# Everything PrusaSlicer's GUI uses is switched on, with the port's own backends: GL canvas (browser-port/wxwidgets-opengl), web view,
# tooltips, secret store, browser file dialogs (browser-port/wxwidgets-web), wxGraphicsContext (browser-port/wxwidgets-drawing).
# b3d-emsdk:6.0.10, run from /w. JOBS = make jobs.
set -e
SRCTREE=${SRCTREE:-pwx}; BDIR=${BDIR:-bwx}; PFX=${PFX:-/w/prefix-wx}
FL="${FL:--O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1}"
cd /w
embuilder build zlib > /dev/null
# the port's extra backends into the tree (newer copies than the port commit), and the edits that let wx use them
cp -f /w/browser-port/wxwidgets-opengl/include/wx/wasm/glcanvas.h /w/browser-port/wxwidgets-web/include/wx/wasm/*.h ${SRCTREE}/include/wx/wasm/
cp -f /w/browser-port/wxwidgets-opengl/src/wasm/glcanvas.cpp /w/browser-port/wxwidgets-web/src/wasm/*.cpp /w/browser-port/wxwidgets-drawing/src/wasm/graphics.cpp ${SRCTREE}/src/wasm/
grep -q WXWASM ${SRCTREE}/include/wx/glcanvas.h || sed -i 's|^#elif defined(__WXQT__)$|#elif defined(__WXWASM__)\n    #include "wx/wasm/glcanvas.h"\n#elif defined(__WXQT__)|' ${SRCTREE}/include/wx/glcanvas.h
# then the shared layer's edits in name order (shared/edits, as Bambu/Orca run them; each skips when applied)
# (the wx edits are already in patches/wxwidgets.patch)
# Expat for wxXML (wxRichTextCtrl needs it; PrusaSlicer links the same library). wx's builtin expat configure does not
# know the emscripten host, so wx's own copy (src/expat, libexpat 2.4.8 in PrusaSlicer's fork) is built with its CMake,
# into the shared prefix (as the Bambu Studio build does). This copy reads its generated expat_config.h only when told
# (HAVE_EXPAT_CONFIG_H; without it the sources take macconfig.h, which wants wx/setup.h).
GD=/w/ow/prefix-mt
if [ ! -f $GD/lib/libexpat.a ]; then
  rm -rf /w/gdeps/expat && mkdir -p /w/gdeps/expat && (cd /w/gdeps/expat && emcmake cmake /w/${SRCTREE}/src/expat/expat -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=$GD -DEXPAT_SHARED_LIBS=OFF -DEXPAT_BUILD_TOOLS=OFF -DEXPAT_BUILD_EXAMPLES=OFF -DEXPAT_BUILD_TESTS=OFF \
    -DEXPAT_BUILD_DOCS=OFF -DCMAKE_C_FLAGS="$FL -DHAVE_EXPAT_CONFIG_H -I/w/gdeps/expat" > cfg.log 2>&1 && emmake make -j${JOBS:-24} install > build.log 2>&1) || { tail -n 30 /w/gdeps/expat/*.log; exit 1; }
fi
# RESUME=1: keep the configured tree and its objects (make picks up only what changed)
if [ "$RESUME" != 1 ]; then rm -rf ${BDIR} ${PFX}; fi; mkdir -p ${BDIR} ${PFX}; cd ${BDIR}
export CFLAGS="$FL" CXXFLAGS="$FL" LDFLAGS="$FL -sERROR_ON_UNDEFINED_SYMBOLS=0 -L$GD/lib" CPPFLAGS="-I$GD/include -I$GD/include/nanosvg"
[ "$RESUME" = 1 ] || emconfigure ../${SRCTREE}/configure --host=emscripten --prefix=${PFX} --with-cxx=17 --enable-universal --disable-utf8 \
  --disable-shared --without-libtiff --disable-xlocale \
  --with-libpng=builtin --with-zlib=sys --with-libjpeg=sys --with-expat=sys --disable-xrc --without-regex \
  --disable-webview --disable-mediactrl --disable-stc ${WXCONF} > configure.log 2>&1 || { tail -30 configure.log; exit 1; }
SETUP=$(ls -d lib/wx/include/*/wx/setup.h)
for f in TOOLTIPS SECRETSTORE WEBVIEW WEBREQUEST MEDIACTRL GLCANVAS OPENGL; do
  grep -q "^#define wxUSE_${f} 1" $SETUP || sed -i "s/^#define wxUSE_${f} .*/#define wxUSE_${f} 1/" $SETUP  # untouched when set: keeps RESUME incremental
  grep -q "^#define wxUSE_${f} 1" $SETUP || { echo "setup.h has no wxUSE_${f}"; exit 1; }
done
# NanoSVG from the deps prefix, as PrusaSlicer's own wx build (-DwxUSE_NANOSVG=sys -DwxUSE_NANOSVG_EXTERNAL=ON): its
# libslic3r carries the NanoSVG implementation, so wx's bundled copy would define every nsvg* symbol twice
grep -q "^#define wxUSE_NANOSVG_EXTERNAL 1" $SETUP || sed -i "s/^#define wxUSE_NANOSVG_EXTERNAL .*/#define wxUSE_NANOSVG_EXTERNAL 1/" $SETUP
grep -q "^#define wxUSE_NANOSVG_EXTERNAL 1" $SETUP || { echo "setup.h has no wxUSE_NANOSVG_EXTERNAL"; exit 1; }
emmake make -k -j${JOBS:-24} > make.log 2>&1 || { grep -n -A6 "error:" make.log | head -${TOP:-80}; exit 1; }
make install > install.log 2>&1
I=$(ls -d ${PFX}/include/wx-3.2/wx); L=${PFX}/lib; S=/w/${SRCTREE}
cp -n $S/include/wx/generic/*.h $I/generic/
mkdir -p $I/generic/private && cp -n $S/include/wx/generic/private/*.h $I/generic/private/
cp -f $S/include/wx/wasm/*.h $I/wasm/
for h in glcanvas.h webview.h tooltip.h chkconf.h tglbtn.h univ/tglbtn.h filedlg.h; do cp -f $S/include/wx/$h $I/$h; done
mkdir -p extra && cd extra
CXXF="$(${PFX}/bin/wx-config --cxxflags) -I$S/include $FL -DWXBUILDING -w"
em++ $CXXF -include /w/browser-port/wxwidgets-opengl/legacy-gl-shim.h -c $S/src/common/glcmn.cpp -o glcmn.o
em++ $CXXF -c $S/src/wasm/glcanvas.cpp -o glcanvas.o
emar rcs $L/libwx_wasmunivu_gl-3.2-emscripten.a glcmn.o glcanvas.o
for f in common/webview common/webviewarchivehandler common/webviewfshandler wasm/webview_wasm; do
  em++ $CXXF -c $S/src/$f.cpp -o wv_$(basename $f).o; done
emar rcs $L/libwx_wasmunivu_webview-3.2-emscripten.a wv_*.o
em++ $CXXF -c $S/src/common/webrequest.cpp -o webrequest.o
emar rcs $L/libwx_baseu_webrequest-3.2-emscripten.a webrequest.o
for f in tooltip graphics utils_wasm filedlg; do em++ $CXXF -c $S/src/wasm/$f.cpp -o ${f}_wasm.o; done
emar rs $L/libwx_wasmunivu_core-3.2-emscripten.a tooltip_wasm.o graphics_wasm.o utils_wasm_wasm.o filedlg_wasm.o
em++ $CXXF -c $S/src/wasm/secretstore.cpp -o secretstore.o
emar rs $L/libwx_baseu-3.2-emscripten.a secretstore.o
ls $L | tr '\n' ' '
echo WX-OK
