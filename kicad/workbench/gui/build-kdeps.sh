# KiCad's own libraries for the browser build, beyond what the slicers' prefix (/w/ow/prefix-mt: Boost, curl, OpenSSL,
# expat, libjpeg, nanosvg) and the wx build give: zstd, GLM, FreeType, HarfBuzz, pixman, cairo, fontconfig, libgit2,
# protobuf (the wasm library; protoc is the image's 3.21.12, the same release), a libspnav stand-in (no 3D mouse in a
# tab), ngspice's header (KiCad loads the simulator library at run time; the file name is all the build wants).
# Into /w/prefix-kdeps. ONLY=<name> rebuilds one. b3d-emsdk-kicad:6.0.10, /w = the work dir.
set -e
P=/w/prefix-kdeps; D=/w/kdeps; mkdir -p $P/lib $P/include $D/dl $D/src; cd $D
F="-O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1"
J=${JOBS:-8}
export PKG_CONFIG_LIBDIR=$P/lib/pkgconfig:/w/ow/prefix-mt/lib/pkgconfig PKG_CONFIG_PATH=$P/lib/pkgconfig EM_PKG_CONFIG_PATH=$P/lib/pkgconfig:/w/ow/prefix-mt/lib/pkgconfig   # emconfigure resets PKG_CONFIG_*; EM_PKG_CONFIG_PATH survives
# autotools packages carry a config.sub too old to know emscripten: the one from CPython's tree (the python build fetches it) replaces it
fetch() { [ -f dl/$2 ] || curl -sfL -o dl/$2 "$1"; [ -d src/$3 ] || { tar xf dl/$2 -C src; }
  for f in $(find src/$3 -name config.sub); do cp src/Python-3.12.11/config.sub $f; cp src/Python-3.12.11/config.guess $(dirname $f)/config.guess; done; }
want() { [ -n "$ONLY" ] && [ "$ONLY" != "$1" ] && return 1; [ -z "$ONLY" ] && [ -f $P/.done-$1 ] && return 1; echo "== $1"; return 0; }
cm() { emcmake cmake -S "$1" -B "$2" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$P -DCMAKE_PREFIX_PATH="$P;/w/ow/prefix-mt" \
  -DCMAKE_FIND_ROOT_PATH="$P;/w/ow/prefix-mt" -DCMAKE_C_FLAGS="$F" -DCMAKE_CXX_FLAGS="$F" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 "${@:3}" > "$2".cfg.log 2>&1 || { tail -30 "$2".cfg.log; exit 1; }
  cmake --build "$2" -j $J > "$2".build.log 2>&1 || { grep -E "error|Error" "$2".build.log | head -20; exit 1; }
  cmake --install "$2" > "$2".install.log 2>&1; }

if want zstd; then
  fetch https://github.com/facebook/zstd/releases/download/v1.5.6/zstd-1.5.6.tar.gz zstd-1.5.6.tar.gz zstd-1.5.6
  cm src/zstd-1.5.6/build/cmake b-zstd -DZSTD_BUILD_SHARED=OFF -DZSTD_BUILD_PROGRAMS=OFF -DZSTD_BUILD_TESTS=OFF -DZSTD_MULTITHREAD_SUPPORT=ON
  touch $P/.done-zstd; fi
if want glm; then
  fetch https://github.com/g-truc/glm/archive/refs/tags/1.0.1.tar.gz glm-1.0.1.tar.gz glm-1.0.1
  cm src/glm-1.0.1 b-glm -DGLM_BUILD_LIBRARY=OFF -DGLM_BUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF -DGLM_BUILD_INSTALL=ON
  touch $P/.done-glm; fi
if want freetype; then
  fetch https://download.savannah.gnu.org/releases/freetype/freetype-2.13.2.tar.xz freetype-2.13.2.tar.xz freetype-2.13.2
  cm src/freetype-2.13.2 b-freetype -DBUILD_SHARED_LIBS=OFF -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BROTLI=ON -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON -DFT_DISABLE_ZLIB=ON
  touch $P/.done-freetype; fi
if want harfbuzz; then
  fetch https://github.com/harfbuzz/harfbuzz/releases/download/8.5.0/harfbuzz-8.5.0.tar.xz harfbuzz-8.5.0.tar.xz harfbuzz-8.5.0
  cm src/harfbuzz-8.5.0 b-harfbuzz -DBUILD_SHARED_LIBS=OFF -DHB_HAVE_FREETYPE=ON -DHB_BUILD_SUBSET=OFF -DHB_HAVE_GLIB=OFF -DHB_HAVE_ICU=OFF
  touch $P/.done-harfbuzz; fi
if want pixman; then
  fetch https://www.cairographics.org/releases/pixman-0.42.2.tar.gz pixman-0.42.2.tar.gz pixman-0.42.2
  (cd src/pixman-0.42.2 && CFLAGS="$F" emconfigure ./configure --host=wasm32-unknown-emscripten --prefix=$P --disable-shared --disable-gtk --disable-libpng \
     --disable-openmp --disable-arm-simd --disable-arm-neon --disable-arm-a64-neon --disable-mips-dspr2 --disable-vmx --disable-mmx --disable-sse2 --disable-ssse3 \
     --disable-loongson-mmi --disable-gnuplot > ../../b-pixman.cfg.log 2>&1 || { tail -20 ../../b-pixman.cfg.log; exit 1; }
   emmake make -j $J -C pixman > ../../b-pixman.build.log 2>&1 || { grep -E "error" ../../b-pixman.build.log | head; exit 1; }
   make -C pixman install > ../../b-pixman.install.log 2>&1 && cp pixman-1.pc $P/lib/pkgconfig/ 2>/dev/null || make install-pkgconfigDATA >> ../../b-pixman.install.log 2>&1)
  touch $P/.done-pixman; fi
if want cairo; then
  fetch https://www.cairographics.org/releases/cairo-1.16.0.tar.xz cairo-1.16.0.tar.xz cairo-1.16.0
  python3 /w/spike/gui/cairo-wasm-casts.py src/cairo-1.16.0   # two-argument callbacks behind three-argument casts trap on wasm
  # KiCad draws on image surfaces (its fallback graphics) and never asks cairo for PDF, PS, SVG or PNG files: those surfaces stay out
  (cd src/cairo-1.16.0 && ax_cv_c_float_words_bigendian=no CFLAGS="$F" emconfigure ./configure --host=wasm32-unknown-emscripten --prefix=$P --disable-shared \
     --enable-ft --disable-fc --disable-xlib --disable-xcb --disable-xlib-xrender --disable-egl --disable-glx --disable-wgl --disable-gobject --disable-trace \
     --disable-interpreter --disable-symbol-lookup --disable-valgrind --disable-pdf --disable-ps --disable-svg --disable-png --disable-script \
     --disable-gtk-doc --disable-full-testing > ../../b-cairo.cfg.log 2>&1 || { tail -30 ../../b-cairo.cfg.log; exit 1; }
   emmake make -j $J -C src > ../../b-cairo.build.log 2>&1 || { grep -E "error" ../../b-cairo.build.log | head; exit 1; }
   make -C src install > ../../b-cairo.install.log 2>&1; make install-pkgconfigDATA >> ../../b-cairo.install.log 2>&1 || true)
  touch $P/.done-cairo; fi
if want fontconfig; then
  fetch https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.15.0.tar.xz fontconfig-2.15.0.tar.xz fontconfig-2.15.0
  (cd src/fontconfig-2.15.0 && CFLAGS="$F" emconfigure ./configure --host=wasm32-unknown-emscripten --prefix=$P --sysconfdir=$P/etc --localstatedir=$P/var \
     --disable-shared --disable-docs --disable-nls --disable-cache-build --enable-libxml2=no --with-expat=/w/ow/prefix-mt \
     --with-default-fonts=/usr/share/fonts --with-add-fonts=no --with-cache-dir=/home/web_user/.cache/fontconfig > ../../b-fontconfig.cfg.log 2>&1 || { tail -30 ../../b-fontconfig.cfg.log; exit 1; }
   emmake make -j $J > ../../b-fontconfig.build.log 2>&1 || { grep -E "error" ../../b-fontconfig.build.log | head; exit 1; }
   make -k install > ../../b-fontconfig.install.log 2>&1 || true   # its install also makes the run-time cache dir, which is not here
   [ -f $P/lib/libfontconfig.a ] || { tail -5 ../../b-fontconfig.install.log; exit 1; })
  touch $P/.done-fontconfig; fi
if want libgit2; then
  fetch https://github.com/libgit2/libgit2/archive/refs/tags/v1.8.4.tar.gz libgit2-1.8.4.tar.gz libgit2-1.8.4
  # wasm32: size_t is unsigned long, 4 bytes; libgit2's overflow helpers pick the unsigned-int builtins and clang (an error since 16) objects to the pointer type
  # Emscripten's own zlib (the one wx, libpng and Python link), not libgit2's bundled copy: that copy is built without gzip
  # (NO_GZIP) and, being the only zlib in the program, left wx unable to open KiCad's images.tar.gz
  embuilder build zlib > /dev/null 2>&1; SR=/emsdk/upstream/emscripten/cache/sysroot
  F="$F -Wno-incompatible-pointer-types" cm src/libgit2-1.8.4 b-libgit2 -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTS=OFF -DBUILD_CLI=OFF -DUSE_SSH=OFF -DUSE_HTTPS=OFF -DUSE_NTLMCLIENT=OFF \
     -DUSE_BUNDLED_ZLIB=OFF -DZLIB_INCLUDE_DIR=$SR/include -DZLIB_LIBRARY=$SR/lib/wasm32-emscripten/libz.a \
     -DREGEX_BACKEND=builtin -DUSE_HTTP_PARSER=builtin -DUSE_THREADS=ON -DUSE_ICONV=OFF -DUSE_GSSAPI=OFF
  touch $P/.done-libgit2; fi
if want protobuf; then
  fetch https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protobuf-cpp-3.21.12.tar.gz protobuf-cpp-3.21.12.tar.gz protobuf-3.21.12
  cm src/protobuf-3.21.12 b-protobuf -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_BUILD_PROTOC_BINARIES=OFF -Dprotobuf_WITH_ZLIB=OFF -DBUILD_SHARED_LIBS=OFF -Dprotobuf_BUILD_LIBPROTOC=OFF
  touch $P/.done-protobuf; fi
if want spnav; then
  cat > $P/include/spnav.h <<'H'
/* libspnav stand-in for the browser build: a tab has no spacenavd; spnav_open() fails and KiCad goes on without a 3D mouse. */
#ifndef SPNAV_H_
#define SPNAV_H_
enum { SPNAV_EVENT_ANY = 0, SPNAV_EVENT_MOTION = 1, SPNAV_EVENT_BUTTON = 2 };
struct spnav_event_motion { int type; int x, y, z, rx, ry, rz; unsigned int period; int *data; };
struct spnav_event_button { int type; int press; int bnum; };
typedef union spnav_event { int type; struct spnav_event_motion motion; struct spnav_event_button button; } spnav_event;
#ifdef __cplusplus
extern "C" {
#endif
int spnav_open(void); int spnav_close(void); int spnav_fd(void); int spnav_poll_event(spnav_event *event); int spnav_wait_event(spnav_event *event);
int spnav_remove_events(int type); int spnav_sensitivity(double sens);
#ifdef __cplusplus
}
#endif
#endif
H
  cat > $D/spnav_stub.c <<'C'
#include <spnav.h>
int spnav_open(void) { return -1; } int spnav_close(void) { return -1; } int spnav_fd(void) { return -1; }
int spnav_poll_event(spnav_event *e) { (void)e; return 0; } int spnav_wait_event(spnav_event *e) { (void)e; return 0; }
int spnav_remove_events(int t) { (void)t; return 0; } int spnav_sensitivity(double s) { (void)s; return -1; }
C
  emcc $F -I$P/include -c $D/spnav_stub.c -o $D/spnav_stub.o && emar rcs $P/lib/libspnav.a $D/spnav_stub.o
  touch $P/.done-spnav; fi
if want ngspice; then
  mkdir -p $P/include/ngspice
  curl -sfL -o $P/include/ngspice/sharedspice.h "https://raw.githubusercontent.com/imr/ngspice/master/src/include/ngspice/sharedspice.h" \
    || curl -sfL -o $P/include/ngspice/sharedspice.h "https://sourceforge.net/p/ngspice/ngspice/ci/master/tree/src/include/ngspice/sharedspice.h?format=raw"
  grep -q ngSpice_Init $P/include/ngspice/sharedspice.h || { echo "no sharedspice.h"; exit 1; }
  touch $P/lib/libngspice.so.0   # find_library wants a file; KiCad dlopens the simulator at run time
  touch $P/.done-ngspice; fi
if want unixodbc; then
  # KiCad's database libraries go through nanodbc, which wants a driver manager; unixODBC's library builds for wasm (no drivers in a tab)
  fetch https://www.unixodbc.org/unixODBC-2.3.12.tar.gz unixODBC-2.3.12.tar.gz unixODBC-2.3.12
  (cd src/unixODBC-2.3.12 && CFLAGS="$F" emconfigure ./configure --host=wasm32-unknown-emscripten --prefix=$P --disable-shared --enable-static \
     --disable-gui --disable-drivers --enable-iconv=no --with-pic > ../../b-unixodbc.cfg.log 2>&1 || { tail -20 ../../b-unixodbc.cfg.log; exit 1; }
   emmake make -j $J -k > ../../b-unixodbc.build.log 2>&1 || true
   make -k install > ../../b-unixodbc.install.log 2>&1 || true
   [ -f $P/lib/libodbc.a ] && [ -f $P/include/uodbc_stats.h ] || { grep -E "error" ../../b-unixodbc.build.log | head; exit 1; })
  touch $P/.done-unixodbc; fi
if want pcre2; then
  # wx's wxRegEx (KiCad uses it widely) on PCRE2 with 32-bit code units (wchar_t strings), found by wx's configure through pkg-config
  fetch https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.42/pcre2-10.42.tar.bz2 pcre2-10.42.tar.bz2 pcre2-10.42
  cm src/pcre2-10.42 b-pcre2 -DBUILD_SHARED_LIBS=OFF -DPCRE2_BUILD_PCRE2_8=OFF -DPCRE2_BUILD_PCRE2_32=ON -DPCRE2_SUPPORT_UNICODE=ON -DPCRE2_SUPPORT_JIT=OFF \
     -DPCRE2_BUILD_PCRE2GREP=OFF -DPCRE2_BUILD_TESTS=OFF
  touch $P/.done-pcre2; fi
if want boostextra; then
  # Boost.PtrContainer (header-only; KiCad's jobs code) is not in the slicers' Boost 1.84 prefix: the same release's headers
  fetch https://github.com/boostorg/ptr_container/archive/refs/tags/boost-1.84.0.tar.gz ptr_container-1.84.0.tar.gz ptr_container-boost-1.84.0
  mkdir -p $P/include/boost && cp -r src/ptr_container-boost-1.84.0/include/boost/ptr_container $P/include/boost/
  ls $P/include/boost/ptr_container/ptr_vector.hpp
  touch $P/.done-boostextra; fi
if want nng; then
  # KiCad's IPC API (KICAD_IPC_API) wants nng; KiCad's plug-in manager code is written for it being on. The server itself stays off in a tab.
  fetch https://github.com/nanomsg/nng/archive/refs/tags/v1.9.0.tar.gz nng-1.9.0.tar.gz nng-1.9.0
  cm src/nng-1.9.0 b-nng -DBUILD_SHARED_LIBS=OFF -DNNG_TESTS=OFF -DNNG_TOOLS=OFF -DNNG_ENABLE_TLS=OFF -DNNG_ENABLE_NNGCAT=OFF -DNNG_ENABLE_DOC=OFF -DNNG_ENABLE_COVERAGE=OFF
  touch $P/.done-nng; fi
ls $P/lib | tr "\n" " "; echo; echo KDEPS-OK
