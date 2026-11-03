# CPython 3.12 for the browser (KiCad embeds Python: pcbnew's scripting, built in since KiCad 7; no build switch takes it out).
# python.org's own Emscripten target (Tools/wasm), as a static library + headers + the standard library files, into /w/prefix-py.
# The build python is the image's 3.12.3 (same minor as the source). Threads on, as everything else in the tab.
set -e
P=/w/prefix-py; D=/w/kdeps; mkdir -p $D/dl $D/src $P; cd $D
V=3.12.11
[ -f dl/Python-$V.tar.xz ] || curl -sfL -o dl/Python-$V.tar.xz https://www.python.org/ftp/python/$V/Python-$V.tar.xz
[ -d src/Python-$V ] || tar xf dl/Python-$V.tar.xz -C src
cd src/Python-$V
mkdir -p build-wasm && cd build-wasm
F="-O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1"
if [ ! -f Makefile ]; then
  CONFIG_SITE=../Tools/wasm/config.site-wasm32-emscripten CFLAGS="$F" LDFLAGS="$F" emconfigure ../configure -C --host=wasm32-unknown-emscripten \
    --build=$(../config.guess) --with-emscripten-target=browser --enable-wasm-pthreads --disable-wasm-dynamic-linking \
    --with-build-python=/usr/bin/python3 --prefix=$P --disable-ipv6 --disable-test-modules --without-ensurepip > ../../../b-python.cfg.log 2>&1 \
    || { tail -40 ../../../b-python.cfg.log; exit 1; }
fi
emmake make -j ${JOBS:-8} libpython3.12.a > ../../../b-python.build.log 2>&1 || { grep -E "error" ../../../b-python.build.log | head -30; exit 1; }
# headers, the static library, the standard library (the parts a start needs; tests and tools left out)
mkdir -p $P/include/python3.12 $P/lib/python3.12
cp -r ../Include/* $P/include/python3.12/; cp pyconfig.h $P/include/python3.12/
cp libpython3.12.a $P/lib/
(cd ../Lib && tar cf - --exclude=test --exclude=tests --exclude=idlelib --exclude=tkinter --exclude=turtledemo --exclude=ensurepip --exclude=__pycache__ .) | (cd $P/lib/python3.12 && tar xf -)
ls -la $P/lib/libpython3.12.a; du -sh $P/lib/python3.12
echo PY-OK
# the static modules' own helper libraries (CPython links them into its binary, not into libpython)
cp Modules/_decimal/libmpdec/libmpdec.a Modules/_hacl/libHacl_Hash_SHA2.a $P/lib/   # + expat: build-pyexpat.sh
