# OpenSSL 3.0.15 + libcurl 8.10.1 for Orca's GUI, into the engine's mt prefix (same flags). Runs in b3d-emsdk:6.0.10, /w = build.sh's work dir
set -e
P=/w/ow/prefix-mt; export EM_CACHE=/w/ow/em-cache
FL="-O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1"
if [ ! -f $P/lib/libssl.a ]; then
  cd /w/gdeps/openssl-3.0.15
  emconfigure ./Configure linux-generic32 no-asm no-shared no-dso no-engine no-afalgeng no-tests no-ui-console no-sock --prefix=$P --libdir=lib CFLAGS="$FL" > cfg.log 2>&1
  sed -i 's/^CROSS_COMPILE=.*/CROSS_COMPILE=/' Makefile
  emmake make -j20 build_libs > make.log 2>&1 || { tail -30 make.log; exit 1; }
  make install_dev > inst.log 2>&1
fi
cd /w/gdeps/curl-8.10.1
# Certificates as the desktop deps (deps/CURL/CURL.cmake): no built-in bundle or path, OpenSSL's default store
# (CA_FALLBACK). A libcurl built before that is rebuilt.
[ -d /w/gdeps/curl-8.10.1 ] || { mkdir -p /w/gdeps && cd /w/gdeps && curl -sL https://github.com/curl/curl/releases/download/curl-8_10_1/curl-8.10.1.tar.gz | tar xzf -; }
cd /w/gdeps/curl-8.10.1
grep -q "CURL_CA_FALLBACK:BOOL=ON" b/CMakeCache.txt 2>/dev/null || rm -rf b $P/lib/libcurl.a
if [ ! -f $P/lib/libcurl.a ]; then
  mkdir -p b && cd b
  emcmake cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$P -DCMAKE_C_FLAGS="$FL" \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_CURL_EXE=OFF -DBUILD_TESTING=OFF -DCURL_USE_OPENSSL=ON -DOPENSSL_ROOT_DIR=$P \
    -DOPENSSL_USE_STATIC_LIBS=ON -DCURL_USE_LIBPSL=OFF -DCURL_USE_LIBSSH2=OFF -DUSE_NGHTTP2=OFF -DCURL_ZLIB=OFF \
    -DCURL_BROTLI=OFF -DCURL_ZSTD=OFF -DUSE_LIBIDN2=OFF -DENABLE_THREADED_RESOLVER=OFF -DCURL_DISABLE_LDAP=ON \
    -DCURL_CA_BUNDLE=none -DCURL_CA_PATH=none -DCURL_CA_FALLBACK=ON -DCMAKE_FIND_ROOT_PATH=$P > cfg.log 2>&1 || { tail -30 cfg.log; exit 1; }
  ninja > make.log 2>&1 || { grep -A5 error: make.log | head -40; exit 1; }
  ninja install > inst.log
fi
ls $P/lib | grep -E "ssl|crypto|curl"
