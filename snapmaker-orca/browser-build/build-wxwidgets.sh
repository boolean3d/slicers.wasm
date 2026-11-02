# The wasm wx port (Orca's wx 3.1.5 + the port, /w/owx) built for Orca's GUI, into /w/prefix6.
# Strings are wchar_t, as in the wx Orca ships on the desktop (no --enable-utf8): Orca's code is written for that.
# Everything Orca's GUI uses is switched on here, with the port's own backends: GL canvas (browser-port/wxwidgets-opengl),
# web view, tooltips and secret store (browser-port/wxwidgets-web); media control and web requests use wx's common code.
# b3d-emsdk:6.0.10, run from /w. JOBS = make jobs.
set -e
SRCTREE=${SRCTREE:-owx}; BDIR=${BDIR:-bwx-orca}; PFX=${PFX:-/w/prefix6}
FL="${FL:--O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1}"
cd /w
embuilder build zlib > /dev/null
# the port's extra backends into the tree, and the edits that let wx use them
cp -f /w/browser-port/wxwidgets-opengl/include/wx/wasm/glcanvas.h /w/browser-port/wxwidgets-web/include/wx/wasm/*.h ${SRCTREE}/include/wx/wasm/
cp -f /w/browser-port/wxwidgets-opengl/src/wasm/glcanvas.cpp /w/browser-port/wxwidgets-web/src/wasm/*.cpp /w/browser-port/wxwidgets-drawing/src/wasm/graphics.cpp ${SRCTREE}/src/wasm/
grep -q WXWASM ${SRCTREE}/include/wx/glcanvas.h || sed -i 's|^#elif defined(__WXQT__)$|#elif defined(__WXWASM__)\n    #include "wx/wasm/glcanvas.h"\n#elif defined(__WXQT__)|' ${SRCTREE}/include/wx/glcanvas.h
# (the wx edits are already in patches/wxwidgets.patch)
rm -rf ${BDIR} ${PFX}; mkdir -p ${BDIR} ${PFX}; cd ${BDIR}
# JPEG: wx reads JPEGs with the app's own libjpeg-turbo (/w/ow/prefix-mt), as desktop Orca builds wx (wxUSE_LIBJPEG=sys).
# With wx's builtin libjpeg 9 the headers said 90 while the link took turbo's 80: every wxImage JPEG load failed in
# jpeg_create_decompress and wx's error path then called a null source manager (the camera crashed the slicer).
# Only the jpeg headers and library are put on the paths, so zlib and png stay as they were.
JI=/w/ow/jpeg-only; rm -rf $JI; mkdir -p $JI/include $JI/lib
for h in jpeglib.h jconfig.h jmorecfg.h jerror.h; do ln -s /w/ow/prefix-mt/include/$h $JI/include/$h; done
ln -s /w/ow/prefix-mt/lib/libjpeg.a $JI/lib/libjpeg.a
export CFLAGS="$FL" CXXFLAGS="$FL" LDFLAGS="$FL -sERROR_ON_UNDEFINED_SYMBOLS=0 -L$JI/lib" CPPFLAGS="-I$JI/include"
emconfigure ../${SRCTREE}/configure --host=emscripten --prefix=${PFX} --with-cxx=17 --enable-universal \
  --disable-shared --disable-richtext --without-libtiff --disable-xlocale \
  --with-libpng=builtin --with-zlib=sys --with-libjpeg=sys --without-expat --disable-xrc --with-regex=builtin \
  --disable-webview --disable-mediactrl --disable-stc > configure.log 2>&1 || { tail -30 configure.log; exit 1; }
# configure knows no wasm backends for these; the port has them (see above)
SETUP=$(ls -d lib/wx/include/*/wx/setup.h)
for f in TOOLTIPS SECRETSTORE WEBVIEW WEBREQUEST MEDIACTRL GLCANVAS OPENGL; do
  sed -i "s/^#define wxUSE_${f} .*/#define wxUSE_${f} 1/" $SETUP
  grep -q "^#define wxUSE_${f} 1" $SETUP || { echo "setup.h has no wxUSE_${f}"; exit 1; }
done
emmake make -j${JOBS:-40} > make.log 2>&1 || { grep -n -A6 "error:" make.log | head -60; exit 1; }
make install > install.log 2>&1
I=${PFX}/include/wx-3.1/wx; L=${PFX}/lib; S=/w/${SRCTREE}
# headers the univ install leaves out
cp -n $S/include/wx/generic/*.h $I/generic/
mkdir -p $I/generic/private && cp -n $S/include/wx/generic/private/*.h $I/generic/private/
cp -f $S/include/wx/wasm/*.h $I/wasm/
for h in glcanvas.h webview.h tooltip.h chkconf.h tglbtn.h univ/tglbtn.h; do cp -f $S/include/wx/$h $I/$h; done
# the extra backends and libraries
mkdir -p extra && cd extra
CXXF="$(${PFX}/bin/wx-config --cxxflags) -I$S/include $FL -DWXBUILDING -w"
em++ $CXXF -include /w/browser-port/wxwidgets-opengl/legacy-gl-shim.h -c $S/src/common/glcmn.cpp -o glcmn.o
em++ $CXXF -c $S/src/wasm/glcanvas.cpp -o glcanvas.o
emar rcs $L/libwx_wasmunivu_gl-3.1-emscripten.a glcmn.o glcanvas.o
for f in common/webview common/webviewarchivehandler common/webviewfshandler wasm/webview_wasm; do
  em++ $CXXF -c $S/src/$f.cpp -o wv_$(basename $f).o; done
emar rcs $L/libwx_wasmunivu_webview-3.1-emscripten.a wv_*.o
em++ $CXXF -c $S/src/common/mediactrlcmn.cpp -o media.o
emar rcs $L/libwx_wasmunivu_media-3.1-emscripten.a media.o
em++ $CXXF -c $S/src/common/webrequest.cpp -o webrequest.o
emar rcs $L/libwx_baseu_webrequest-3.1-emscripten.a webrequest.o
em++ $CXXF -c $S/src/wasm/tooltip.cpp -o tooltip.o
emar rs $L/libwx_wasmunivu_core-3.1-emscripten.a tooltip.o
em++ $CXXF -c $S/src/wasm/utils_wasm.cpp -o utils_wasm.o
# wxGraphicsContext on the 2D canvas (shared/wxwidgets-drawing; JavaScript side graphics-context.js)
em++ $CXXF -c $S/src/wasm/graphics.cpp -o graphics_wasm.o
emar rs $L/libwx_wasmunivu_core-3.1-emscripten.a graphics_wasm.o
em++ $CXXF -c $S/src/wasm/filedlg.cpp -o filedlg_wasm.o
emar rs $L/libwx_wasmunivu_core-3.1-emscripten.a utils_wasm.o filedlg_wasm.o
em++ $CXXF -c $S/src/wasm/secretstore.cpp -o secretstore.o
emar rs $L/libwx_baseu-3.1-emscripten.a secretstore.o
ls $L | tr '\n' ' '
