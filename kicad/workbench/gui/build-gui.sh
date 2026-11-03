# Configure + build KiCad's programs for the browser (keep going past errors; collect them).
# b3d-emsdk-kicad:6.0.10, /w = the work dir. TARGETS: kicad (the project manager with both editors linked in, tree-patch13).
set -e
embuilder build zlib libpng-mt-legacysjlj bzip2 > /dev/null 2>&1 || true   # bzip2: Python's _bz2 (-sUSE_BZIP2 at link)
B=${B:-/w/kgui}
# lemon (KiCad's parser generator) runs during the build: a host program, made with the toolchain's own native clang
mkdir -p /w/kgui-host
[ -x /w/kgui-host/lemon ] || /emsdk/upstream/bin/clang -O2 -w -o /w/kgui-host/lemon /w/kicad/thirdparty/lemon/lemon.c || { echo "host lemon failed"; exit 1; }
if [ "$FRESH" = 1 ]; then rm -rf $B; fi
if [ ! -f $B/build.ninja ] || [ "$RECONF" = 1 ]; then   # RECONF=1: run cmake again on the kept build dir (cache changes)
  # KiCad's own top-level CMake is the project (it uses CMAKE_SOURCE_DIR as its root); the browser build's additions come in
  # through its cache (kicad-wasm-cache.cmake) and an include right after project() (after-project.cmake -> programs.cmake)
  emcmake cmake -S /w/kicad -B $B -G Ninja -C /w/ow/prefix-mt/share/orcawasm/initial-cache.cmake -C /w/spike/gui/kicad-wasm-cache.cmake \
    -DCMAKE_PROJECT_kicad_INCLUDE=/w/spike/gui/after-project.cmake \
    -DCMAKE_PREFIX_PATH="/w/ow/prefix-mt" -DCMAKE_FIND_ROOT_PATH="/w/ow/prefix-mt" -DOPENSSL_ROOT_DIR=/w/ow/prefix-mt > $B.cfg.log 2>&1 \
    || { grep -B2 -A12 "CMake Error" $B.cfg.log | head -${TOP:-80}; echo CONFIGURE-FAILED; exit 1; }
  echo CONFIGURE-OK
fi
[ "$CONFIGURE_ONLY" = 1 ] && exit 0
cd $B
ninja -k 0 -j${JOBS:-16} ${TARGETS:-kicad} > build.log 2>&1 && echo BUILD-OK || { echo BUILD-FAILED; grep -c "FAILED:" build.log; grep -h "error:" build.log | sort | uniq -c | sort -rn | head -40; }
