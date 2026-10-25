# The wasm wx port (Orca's wx 3.1.5 + the port, /w/owx) built for Orca's GUI, into /w/prefix6.
# Strings are wchar_t, as in the wx Orca ships on the desktop (no --enable-utf8): Orca's code is written for that.
# Everything Orca's GUI uses is switched on here, with the port's own backends: GL canvas (browser-port/wxwidgets-opengl),
# web view, tooltips and secret store (browser-port/wxwidgets-web); media control and web requests use wx's common code.
# b3d-emsdk:6.0.10, run from /w. JOBS = make jobs.
set -e
SRCTREE=${SRCTREE:-owx}; BDIR=${BDIR:-bwx-bambu}; PFX=${PFX:-/w/prefix6}
FL="${FL:--O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1}"
cd /w
embuilder build zlib > /dev/null
# the port's extra backends into the tree, and the edits that let wx use them
cp -f /w/browser-port/wxwidgets-opengl/include/wx/wasm/glcanvas.h /w/browser-port/wxwidgets-web/include/wx/wasm/*.h ${SRCTREE}/include/wx/wasm/
cp -f /w/browser-port/wxwidgets-opengl/src/wasm/glcanvas.cpp /w/browser-port/wxwidgets-web/src/wasm/*.cpp /w/browser-port/wxwidgets-drawing/src/wasm/graphics.cpp ${SRCTREE}/src/wasm/
grep -q WXWASM ${SRCTREE}/include/wx/glcanvas.h || sed -i 's|^#elif defined(__WXQT__)$|#elif defined(__WXWASM__)\n    #include "wx/wasm/glcanvas.h"\n#elif defined(__WXQT__)|' ${SRCTREE}/include/wx/glcanvas.h
# (the wx edits are already in patches/wxwidgets.patch)
# Expat for wxXML (wxRichTextCtrl needs it; Bambu builds wx with -DwxUSE_EXPAT=sys over its deps' expat). wx's
# builtin expat configure does not know the emscripten host, so wx's own copy is built with its CMake, as a dep.
GD=/w/ow/prefix-mt
if [ ! -f $GD/lib/libexpat.a ]; then
  rm -rf /w/gdeps/expat && mkdir -p /w/gdeps/expat && (cd /w/gdeps/expat && emcmake cmake /w/${SRCTREE}/src/expat/expat -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=$GD -DEXPAT_SHARED_LIBS=OFF -DEXPAT_BUILD_TOOLS=OFF -DEXPAT_BUILD_EXAMPLES=OFF -DEXPAT_BUILD_TESTS=OFF \
    -DEXPAT_BUILD_DOCS=OFF -DCMAKE_C_FLAGS="$FL" > cfg.log 2>&1 && emmake make -j${JOBS:-24} install > build.log 2>&1) || { tail -30 /w/gdeps/expat/*.log; exit 1; }
fi
rm -rf ${BDIR} ${PFX}; mkdir -p ${BDIR} ${PFX}; cd ${BDIR}
export CFLAGS="$FL" CXXFLAGS="$FL" LDFLAGS="$FL -sERROR_ON_UNDEFINED_SYMBOLS=0 -L$GD/lib" CPPFLAGS="-I$GD/include"
emconfigure ../${SRCTREE}/configure --host=emscripten --prefix=${PFX} --with-cxx=17 --enable-universal \
  --disable-shared --without-libtiff --disable-xlocale \
  --with-libpng=builtin --with-zlib=sys --with-libjpeg=builtin --with-expat=sys --disable-xrc --with-regex=builtin \
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
# wxGraphicsContext on the 2D canvas (browser-port/wxwidgets-drawing; JavaScript side graphics-context.js)
em++ $CXXF -c $S/src/wasm/graphics.cpp -o graphics_wasm.o
emar rs $L/libwx_wasmunivu_core-3.1-emscripten.a graphics_wasm.o
em++ $CXXF -c $S/src/wasm/utils_wasm.cpp -o utils_wasm.o
em++ $CXXF -c $S/src/wasm/filedlg.cpp -o filedlg_wasm.o
emar rs $L/libwx_wasmunivu_core-3.1-emscripten.a utils_wasm.o filedlg_wasm.o
em++ $CXXF -c $S/src/wasm/secretstore.cpp -o secretstore.o
emar rs $L/libwx_baseu-3.1-emscripten.a secretstore.o
ls $L | tr '\n' ' '
