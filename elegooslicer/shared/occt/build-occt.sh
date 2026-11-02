#!/bin/bash
# Shared wasm OCCT 7.6.0 for the browser Bambu Studio and OrcaSlicer (both pin V7_6_0 + the same 0001-OCCT-fix.patch,
# deps/OCCT/OCCT.cmake): STEP import (Format/STEP.cpp). Same CMake arguments as their deps (DataExchange only; OCCT pulls
# the toolkits it depends on), plus the browser build's flags (-pthread, wasm exceptions, wasm longjmp: browser-build/build-wxwidgets.sh)
# (legacy wasm exceptions too: emsdk 6 defaults to the new encoding, which does not link with the app)
# and no FreeType (only text shapes need it).
# Inside b3d-emsdk:6.0.10: OCCT_WORK (default /w/occt) gets the source (V7_6_0.zip, sha256 checked, + the slicer's
# 0001-OCCT-fix.patch from SLICER_SRC, default /w/bambu), the build, and prefix-7.6.0 (static libs + headers), which the GUI
# build reads at /occt. Outside the container it runs itself in one, in the folder OCCT_WORK names.
set -eo pipefail
if [ ! -d /emsdk ]; then
  W=$(cd "${OCCT_WORK:?the OCCT work dir}" && pwd); S=$(cd "${SLICER_SRC:?the Bambu Studio or OrcaSlicer source}" && pwd)
  exec docker run --rm --name occt-wasm-build -u $(id -u):$(id -g) -e JOBS -e OCCT_WORK=/w -e SLICER_SRC=/s -v "$W":/w -v "$S":/s:ro \
    -v "$(cd "$(dirname "$0")" && pwd)":/x:ro -w /w b3d-emsdk:6.0.10 bash /x/build-occt.sh
fi
W=${OCCT_WORK:-/w/occt}; SLICER_SRC=${SLICER_SRC:-/w/bambu}
mkdir -p "$W" && cd "$W"
F="-pthread -fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=1 -sSUPPORT_LONGJMP=wasm -O2"   # as the GUI initial-cache (ow/prefix-mt): legacy wasm exceptions
if [ ! -f src/.patched ]; then
  [ -f V7_6_0.zip ] || curl -sSL -o V7_6_0.zip https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V7_6_0.zip
  echo "28334f0e98f1b1629799783e9b4d21e05349d89e695809d7e6dfa45ea43e1dbc  V7_6_0.zip" | sha256sum -c -
  rm -rf src OCCT-7_6_0 && python3 -c "import zipfile;zipfile.ZipFile('V7_6_0.zip').extractall('.')" && mv OCCT-7_6_0 src
  (cd src && git apply --ignore-space-change --whitespace=fix "$SLICER_SRC/deps/OCCT/0001-OCCT-fix.patch") && touch src/.patched
fi
# OCCT appends -fexceptions (adm/cmake/occt_defs_flags.cmake) after our flags; under emcc that turns those objects to
# JS exceptions, and the app's link then fails in wasm-opt ("popping from empty stack"): our -fwasm-exceptions stays alone.
sed -i 's/ -fexceptions -fPIC/ -fPIC/' src/adm/cmake/occt_defs_flags.cmake
# OCC_CONVERT_SIGNALS (every non-MSVC build) makes OCC_CATCH_SIGNALS a setjmp inside the caller's try block
# (Standard_ErrorHandler.hxx). A browser has no signals to convert, and setjmp + try in one function under wasm
# exceptions + wasm longjmp breaks the app's link in wasm-opt ("popping from empty stack" in
# ShapeUpgrade_ShapeDivide::Perform). Without it OCC_CATCH_SIGNALS is empty and OCCT raises plain C++ exceptions.
sed -i 's/^  add_definitions(-DOCC_CONVERT_SIGNALS)$/  # add_definitions(-DOCC_CONVERT_SIGNALS)  (browser: no signals)/' src/adm/cmake/occt_defs_flags.cmake
emcmake cmake -S src -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$W/prefix-7.6.0 \
  -DCMAKE_C_FLAGS="$F" -DCMAKE_CXX_FLAGS="$F" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DBUILD_LIBRARY_TYPE=Static -DUSE_TK=OFF -DUSE_TBB=OFF -DUSE_FREETYPE=OFF -DUSE_FFMPEG=OFF -DUSE_VTK=OFF \
  -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_FREEIMAGE=OFF -DUSE_RAPIDJSON=OFF -DUSE_DRACO=OFF -DUSE_OPENVR=OFF \
  -DBUILD_DOC_Overview=OFF -DBUILD_SAMPLES_QT=OFF -DBUILD_Inspector=OFF \
  -DBUILD_MODULE_ApplicationFramework=OFF -DBUILD_MODULE_Draw=OFF -DBUILD_MODULE_FoundationClasses=OFF \
  -DBUILD_MODULE_ModelingAlgorithms=OFF -DBUILD_MODULE_ModelingData=OFF -DBUILD_MODULE_Visualization=OFF \
  -DBUILD_MODULE_DataExchange=ON > cfg.log 2>&1 || { tail -30 cfg.log; exit 1; }
cmake --build build -j ${JOBS:-20} > build.log 2>&1 || { grep -E 'error' build.log | head -30; exit 1; }
cmake --install build > install.log 2>&1
echo OCCT-BUILD-OK
