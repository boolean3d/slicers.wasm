# The wasm wx port on wxWidgets 3.3 (SoftFever/Orca-deps-wxWidgets v3.3.2 + the port and every wx edit: patches/wxwidgets.patch), for the
# programs that build on Orca 2.4's wx (ElegooSlicer 1.5.3, Creality Print 7.3). build.sh lays the patched tree out at
# /w/owx and runs this from /w. Derived from Orca's browser-port/browser-build/build-wxwidgets.sh
# (edit chain, jpeg, extra libraries) with Prusa's 3.2 changes (no builtin regex: 3.x's PCRE2 configure knows no
# emscripten; library names read from the installed version, not 3.1).
# Strings are wchar_t, as the desktop builds of these programs (no --enable-utf8).
# b3d-emsdk:6.0.10, run from /w. JOBS = make jobs. RESUME=1 keeps the configured tree (incremental).
set -e
SRCTREE=${SRCTREE:-owx}; BDIR=${BDIR:-bwx-orca}; PFX=${PFX:-/w/prefix6}
FL="${FL:--O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1}"
cd /w
embuilder build zlib > /dev/null
# the port's extra backends into the tree, and the edits that let wx use them
cp -f /w/browser-port/wxwidgets-opengl/include/wx/wasm/glcanvas.h /w/browser-port/wxwidgets-web/include/wx/wasm/*.h ${SRCTREE}/include/wx/wasm/
cp -f /w/browser-port/wxwidgets-opengl/src/wasm/glcanvas.cpp /w/browser-port/wxwidgets-web/src/wasm/*.cpp /w/browser-port/wxwidgets-drawing/src/wasm/graphics.cpp ${SRCTREE}/src/wasm/
grep -q WXWASM ${SRCTREE}/include/wx/glcanvas.h || sed -i 's|^#elif defined(__WXQT__)$|#elif defined(__WXWASM__)\n    #include "wx/wasm/glcanvas.h"\n#elif defined(__WXQT__)|' ${SRCTREE}/include/wx/glcanvas.h
# the shared edits only (Orca's spike edit5-14 are in the port-owned files already); they take 3.3 spellings via edits/_wxforms.py
# (the wx edits are already in patches/wxwidgets.patch)
if [ "$RESUME" != 1 ]; then rm -rf ${BDIR} ${PFX}; fi; mkdir -p ${BDIR} ${PFX}; cd ${BDIR}
# JPEG: the app's own libjpeg-turbo (see Orca's build-wxwidgets.sh: wx's builtin libjpeg 9 broke every JPEG load)
JI=/w/ow/jpeg-only; rm -rf $JI; mkdir -p $JI/include $JI/lib
for h in jpeglib.h jconfig.h jmorecfg.h jerror.h; do ln -s /w/ow/prefix-mt/include/$h $JI/include/$h; done
ln -s /w/ow/prefix-mt/lib/libjpeg.a $JI/lib/libjpeg.a
export CFLAGS="$FL" CXXFLAGS="$FL" LDFLAGS="$FL -sERROR_ON_UNDEFINED_SYMBOLS=0 -L$JI/lib" CPPFLAGS="-I$JI/include"
[ "$RESUME" = 1 ] || emconfigure ../${SRCTREE}/configure --host=emscripten --prefix=${PFX} --with-cxx=17 --enable-universal \
  --disable-shared --disable-richtext --without-libtiff --disable-xlocale \
  --with-libpng=builtin --with-zlib=sys --with-libjpeg=sys --without-expat --disable-xrc --without-regex \
  --disable-webview --disable-mediactrl --disable-stc ${WXCONF} > configure.log 2>&1 || { tail -30 configure.log; exit 1; }
SETUP=$(ls -d lib/wx/include/*/wx/setup.h)
for f in TOOLTIPS SECRETSTORE WEBVIEW WEBREQUEST MEDIACTRL GLCANVAS OPENGL FSWATCHER; do   # FSWATCHER: z65's watcher (Elegoo watches preset folders)
  grep -q "^#define wxUSE_${f} 1" $SETUP || sed -i "s/^#define wxUSE_${f} .*/#define wxUSE_${f} 1/" $SETUP   # untouched when set: RESUME stays incremental
  grep -q "^#define wxUSE_${f} 1" $SETUP || { echo "setup.h has no wxUSE_${f}"; exit 1; }
done
# NanoSVG off, as Orca 2.4's deps build wx (deps/wxWidgets -DwxUSE_NANOSVG=OFF): the program compiles its own nanosvg
# (BitmapCache.cpp), and wx's copy in bmpsvg.cpp would define every nsvg* symbol twice
grep -q "^#define wxUSE_NANOSVG 0" $SETUP || sed -i "s/^#define wxUSE_NANOSVG .*/#define wxUSE_NANOSVG 0/" $SETUP
emmake make -k -j${JOBS:-14} > make.log 2>&1 || { grep -n -A6 "error:" make.log | head -${TOP:-80}; exit 1; }
make install > install.log 2>&1
I=$(ls -d ${PFX}/include/wx-3.*/wx); V=$(basename $(dirname $I)); V=${V#wx-}; L=${PFX}/lib; S=/w/${SRCTREE}
# headers the univ install leaves out
cp -n $S/include/wx/generic/*.h $I/generic/
mkdir -p $I/generic/private && cp -n $S/include/wx/generic/private/*.h $I/generic/private/
mkdir -p $I/private && cp -n $S/include/wx/private/*.h $I/private/   # Orca 2.4 uses private headers (its deps copy them too)
cp -f $S/include/wx/wasm/*.h $I/wasm/
mkdir -p $I/wasm/private && cp -f $S/include/wx/wasm/private/*.h $I/wasm/private/
cp -f $S/include/wx/fswatcher.h $I/fswatcher.h; cp -f $S/include/wx/private/fswatcher.h $I/private/fswatcher.h   # z65 (cp -n above keeps old copies)
for h in glcanvas.h webview.h tooltip.h chkconf.h tglbtn.h univ/tglbtn.h filedlg.h; do cp -f $S/include/wx/$h $I/$h; done
# the extra backends and libraries
mkdir -p extra && cd extra
CXXF="$(${PFX}/bin/wx-config --cxxflags) -I$S/include $FL -DWXBUILDING -w"
em++ $CXXF -include /w/browser-port/wxwidgets-opengl/legacy-gl-shim.h -c $S/src/common/glcmn.cpp -o glcmn.o
em++ $CXXF -c $S/src/wasm/glcanvas.cpp -o glcanvas.o
emar rcs $L/libwx_wasmunivu_gl-$V-emscripten.a glcmn.o glcanvas.o
for f in common/webview common/webviewarchivehandler common/webviewfshandler wasm/webview_wasm; do
  em++ $CXXF -c $S/src/$f.cpp -o wv_$(basename $f).o; done
emar rcs $L/libwx_wasmunivu_webview-$V-emscripten.a wv_*.o
em++ $CXXF -c $S/src/common/mediactrlcmn.cpp -o media.o
emar rcs $L/libwx_wasmunivu_media-$V-emscripten.a media.o
em++ $CXXF -c $S/src/common/webrequest.cpp -o webrequest.o
emar rcs $L/libwx_baseu_webrequest-$V-emscripten.a webrequest.o
for f in tooltip graphics utils_wasm filedlg; do em++ $CXXF -c $S/src/wasm/$f.cpp -o ${f}_wasm.o; done
emar rs $L/libwx_wasmunivu_core-$V-emscripten.a tooltip_wasm.o graphics_wasm.o utils_wasm_wasm.o filedlg_wasm.o
em++ $CXXF -c $S/src/wasm/secretstore.cpp -o secretstore.o
em++ $CXXF -c $S/src/wasm/fswatcher.cpp -o fswatcher_wasm.o
emar rs $L/libwx_baseu-$V-emscripten.a secretstore.o fswatcher_wasm.o
ls $L | tr '\n' ' '
echo WX-OK
