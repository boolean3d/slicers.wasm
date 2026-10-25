# Configure + build Bambu Studio's GUI library / program (keep going past errors; collect them).
# b3d-emsdk:6.0.10, /w = build.sh's work dir. JOBS = compile jobs.
set -e
embuilder build zlib libpng-mt-legacysjlj > /dev/null 2>&1
B=${B:-/w/bgui}
if [ ! -f $B/build.ninja ]; then
  emcmake cmake -S /w/browser-port/browser-build -B $B -G Ninja -C /w/ow/prefix-mt/share/orcawasm/initial-cache.cmake \
    -DCMAKE_PREFIX_PATH=/w/ow/prefix-mt -DOPENSSL_ROOT_DIR=/w/ow/prefix-mt > $B.cfg.log 2>&1 || { grep -B2 -A12 "CMake Error" $B.cfg.log | head -60; exit 1; }
fi
cd $B
ninja -k 0 -j${JOBS:-24} ${TARGETS:-libslic3r_gui} > build.log 2>&1 && echo BUILD-OK || { echo BUILD-FAILED; grep -c "FAILED:" build.log; grep -m 20 -A3 "^FAILED:" build.log; exit 1; }
