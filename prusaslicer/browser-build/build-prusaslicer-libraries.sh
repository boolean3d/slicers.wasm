# PrusaSlicer 2.9.6's dependencies that the Bambu/Orca prefix (/w/ow/prefix-mt) lacks, built for wasm into it,
# at the versions PrusaSlicer's deps/ pins: heatshrink 0.4.1, LibBGCode 6f4ad7c, nlohmann_json 3.12.0, NanoSVG abcd277,
# z3 4.15.1, Blosc 8724c06, OpenEXR 2.5.5, OpenVDB (prusa3d 339ee88). b3d-emsdk:6.0.10, /w. ONLY=<name> builds one.
set -u
embuilder build zlib libpng-mt-legacysjlj > /dev/null 2>&1
P=/w/ow/prefix-mt; D=/w/pdeps; mkdir -p $D/src
IC="-C $P/share/orcawasm/initial-cache.cmake"
COMMON="-DCMAKE_INSTALL_PREFIX=$P -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5"
fetch() { # name url
  [ -d $D/src/$1 ] && return 0
  (cd $D/src && rm -rf x && mkdir x && cd x && wget -q -O a "$2" && (unzip -q a 2>/dev/null || tar xf a) && rm a && mv * ../$1 && cd .. && rmdir x)
}
build() { # name srcdir args...
  local n=$1 s=$2; shift 2
  [ -n "${ONLY:-}" ] && [ "$ONLY" != "$n" ] && return 0
  [ -f $D/$n.ok ] && { echo "$n: already"; return 0; }
  rm -rf $D/b-$n; mkdir -p $D/b-$n
  if emcmake cmake $IC -S $s -B $D/b-$n -G Ninja $COMMON "$@" > $D/$n.cfg.log 2>&1 && \
     ninja -C $D/b-$n -j${JOBS:-24} install > $D/$n.build.log 2>&1; then touch $D/$n.ok; echo "$n: OK"
  else echo "$n: FAILED"; grep -E "error|Error" $D/$n.cfg.log $D/$n.build.log | head -15; fi
}
fetch heatshrink https://github.com/atomicobject/heatshrink/archive/refs/tags/v0.4.1.zip
fetch libbgcode https://github.com/prusa3d/libbgcode/archive/6f4ad7ce6b0e638b760199d6611039a610a5a479.zip
fetch json https://github.com/nlohmann/json/archive/refs/tags/v3.12.0.zip
fetch nanosvg https://github.com/fltk/nanosvg/archive/abcd277ea45e9098bed752cf9c6875b533c0892f.zip
fetch z3 https://github.com/Z3Prover/z3/archive/refs/tags/z3-4.15.1.zip
fetch blosc https://github.com/Blosc/c-blosc/archive/8724c06e3da90f10986a253814af18ca081d8de0.zip
fetch openexr https://github.com/AcademySoftwareFoundation/openexr/archive/refs/tags/v2.5.5.zip
fetch curl https://github.com/curl/curl/releases/download/curl-8_10_1/curl-8.10.1.tar.gz
fetch openvdb https://github.com/prusa3d/openvdb/archive/339ee88230da33e3fefb133d8c1a9e16bef09144.zip
# heatshrink: PrusaSlicer's deps build it with libbgcode's own CMakeLists for it
[ -f $D/src/heatshrink/CMakeLists.txt ] || cp /w/prusa/deps/+heatshrink/CMakeLists.txt /w/prusa/deps/+heatshrink/Config.cmake.in $D/src/heatshrink/ 2>/dev/null
build heatshrink $D/src/heatshrink
build libbgcode $D/src/libbgcode -DLibBGCode_BUILD_TESTS=OFF -DLibBGCode_BUILD_CMD_TOOL=OFF
build json $D/src/json -DJSON_BuildTests=OFF
build nanosvg $D/src/nanosvg -DNANOSVG_BUILD_EXAMPLES=OFF
build z3 $D/src/z3 -DZ3_INCLUDE_GIT_HASH=OFF -DZ3_INCLUDE_GIT_DESCRIBE=OFF -DZ3_USE_LIB_GMP=OFF -DZ3_BUILD_LIBZ3_SHARED=OFF \
  -DZ3_ENABLE_EXAMPLE_TARGETS=OFF -DZ3_ALWAYS_BUILD_DOCS=OFF -DZ3_BUILD_EXECUTABLE=OFF -DZ3_BUILD_TEST_EXECUTABLES=OFF -DZ3_SINGLE_THREADED=OFF
# z3's Emscripten branch exports its own JS-build link flags on z3::libz3 (-Os, ALLOW_MEMORY_GROWTH, ASSERTIONS=0,
# DISABLE_EXCEPTION_CATCHING=0 which -fwasm-exceptions refuses, ERROR_ON_UNDEFINED_SYMBOLS): the program's link sets its own.
[ -z "${ONLY:-}" -o "${ONLY:-}" = z3 ] && sed -i 's/;\\\$<LINK_ONLY:-Os>;[^"]*"/"/' $P/lib/cmake/z3/Z3Targets.cmake
build blosc $D/src/blosc -DBUILD_SHARED=OFF -DBUILD_STATIC=ON -DBUILD_TESTS=OFF -DBUILD_BENCHMARKS=OFF -DPREFER_EXTERNAL_ZLIB=ON -DDEACTIVATE_SSE2=ON -DDEACTIVATE_AVX2=ON
build openexr $D/src/openexr -DPYILMBASE_ENABLE=OFF -DOPENEXR_VIEWERS_ENABLE=OFF -DOPENEXR_BUILD_UTILS=OFF -DBUILD_TESTING=OFF -DINSTALL_OPENEXR_EXAMPLES=OFF -DOPENEXR_BUILD_PYTHON_LIBS=OFF -DILMBASE_BUILD_BOTH_STATIC_SHARED=OFF -DOPENEXR_BUILD_BOTH_STATIC_SHARED=OFF
build openvdb $D/src/openvdb -DOPENVDB_BUILD_PYTHON_MODULE=OFF -DUSE_BLOSC=ON -DOPENVDB_CORE_SHARED=OFF -DOPENVDB_CORE_STATIC=ON \
  -DOPENVDB_ENABLE_RPATH=OFF -DTBB_STATIC=ON -DOPENVDB_BUILD_VDB_PRINT=OFF -DDISABLE_DEPENDENCY_VERSION_CHECKS=ON -DOPENVDB_BUILD_UNITTESTS=OFF \
  -DCMAKE_MODULE_PATH=$D/src/openvdb/cmake -DIlmBase_ROOT=$P -DBlosc_ROOT=$P -DTBB_ROOT=$P
# libcurl again (the prefix's 8.10.1, Orca's options) with PrusaSlicer's deps/+CURL certificate options: no built-in
# bundle or path, CA_FALLBACK (OpenSSL's default store, which SSL_CERT_FILE moves); OPENSSL_CERT_OVERRIDE (the
# compile definition its deps put on CURL::libcurl) is set for PrusaSlicer in prusaslicer-source-edits.cmake.
build curl $D/src/curl -DBUILD_CURL_EXE=OFF -DBUILD_TESTING=OFF -DCURL_USE_OPENSSL=ON -DOPENSSL_ROOT_DIR=$P \
  -DOPENSSL_USE_STATIC_LIBS=ON -DCURL_USE_LIBPSL=OFF -DCURL_USE_LIBSSH2=OFF -DUSE_NGHTTP2=OFF -DCURL_ZLIB=OFF \
  -DCURL_BROTLI=OFF -DCURL_ZSTD=OFF -DUSE_LIBIDN2=OFF -DENABLE_THREADED_RESOLVER=OFF -DCURL_DISABLE_LDAP=ON \
  -DCURL_CA_PATH=none -DCURL_CA_BUNDLE=none -DCURL_CA_FALLBACK=ON
# PrusaSlicer's deps patch: CURL::libcurl carries OPENSSL_CERT_OVERRIDE, so Http.cpp finds the distro's CA bundle
CC=$(ls $P/lib/cmake/CURL/CURLConfig.cmake 2>/dev/null || true)
[ -n "$CC" ] && ! grep -q OPENSSL_CERT_OVERRIDE $CC && echo 'set_property(TARGET CURL::libcurl_static APPEND PROPERTY INTERFACE_COMPILE_DEFINITIONS OPENSSL_CERT_OVERRIDE)' >> $CC   # 8.x: CURL::libcurl is an alias of it
# hidapi: no USB HID in a browser tab. PrusaSlicer's Linux build finds hidapi through pkg-config (hidapi-hidraw);
# here that package is the "no device" stub (browser-port/browser-build/stand-ins/hidapi_none.c) with PrusaSlicer's bundled hidapi.h.
if [ ! -f $P/lib/libhidapi-none.a ]; then
  mkdir -p $D/b-hidapi $P/include/hidapi && cp /w/prusa/bundled_deps/hidapi/include/hidapi.h $P/include/hidapi/ && \
  emcc -O2 -pthread -I$P/include/hidapi -c /w/browser-port/browser-build/stand-ins/hidapi_none.c -o $D/b-hidapi/hid.o && emar rcs $P/lib/libhidapi-none.a $D/b-hidapi/hid.o && \
  printf 'prefix=%s\nName: hidapi-hidraw\nDescription: no USB HID in a browser tab\nVersion: 0.14.0\nCflags: -I%s/include/hidapi\nLibs: %s/lib/libhidapi-none.a\n' $P $P $P > $P/lib/pkgconfig/hidapi-hidraw.pc && echo "hidapi: OK"
fi
echo PDEPS-DONE
