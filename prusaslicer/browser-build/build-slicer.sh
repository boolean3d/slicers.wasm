# Configure + build PrusaSlicer's GUI program (keep going past errors; collect them).
# b3d-emsdk:6.0.10, /w = the work dir. JOBS = compile jobs.
set -e
embuilder build zlib libpng-mt-legacysjlj > /dev/null 2>&1
B=${B:-/w/pgui}
if [ ! -f $B/build.ninja ]; then
  emcmake cmake -S /w/browser-port/browser-build -B $B -G Ninja -C /w/ow/prefix-mt/share/orcawasm/initial-cache.cmake \
    -DCMAKE_PREFIX_PATH="/w/prefix-eigen;/w/ow/prefix-mt" -DCMAKE_FIND_ROOT_PATH="/w/prefix-eigen;/w/ow/prefix-mt" -DOPENSSL_ROOT_DIR=/w/ow/prefix-mt > $B.cfg.log 2>&1 || { grep -B2 -A12 "CMake Error" $B.cfg.log | head -60; exit 1; }
fi
# shared look/behaviour edits (shared/edits, as browser-port/slicer-edits) on the wx tree; the pre-js
# files are LINK_DEPENDS (CMakeLists.txt), so a changed one relinks
# (the wx edits are already in patches/wxwidgets.patch)
cd $B
ninja -k 0 -j${JOBS:-24} ${TARGETS:-PrusaSlicer} > build.log 2>&1 && echo BUILD-OK || { echo BUILD-FAILED; grep -c "FAILED:" build.log; }
