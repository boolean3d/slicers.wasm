#!/bin/bash
# wasm OCCT for the browser PrusaSlicer's STEP import, built as PrusaSlicer's deps/+OCCT/OCCT.cmake does:
# V7_6_1 (sha256 b7cf6543..., Prusa pins it: newer ones triangulate chamfers wrong, SPE-2257) with Prusa's occt_toolkit.cmake
# copied into adm/cmake, the same CMake arguments, plus the browser build's compile flags (ow/prefix-mt initial-cache: -pthread,
# wasm exceptions in the legacy encoding, wasm longjmp). Same pattern as shared/occt/build-occt.sh (Bambu Studio's).
# In the Prusa work dir so the GUI build finds it at the same paths (/w): source /w/occt-src (V7_6_1.zip, sha256 checked,
# + occt_toolkit.cmake), build /w/occt-build, install /w/prefix-occt.
# Inside b3d-emsdk:6.0.10 with the work dir at /w (as build.sh runs it); outside the container it runs itself in one,
# from the work dir $PRUSA_WORK.
set -eo pipefail
if [ ! -d /emsdk ]; then
  cd "${PRUSA_WORK:?the Prusa work dir}"
  exec docker run --rm --name occt-prusa-build -u $(id -u):$(id -g) -e JOBS -v $PWD:/w -w /w b3d-emsdk:6.0.10 bash /w/browser-port/browser-build/build-occt-prusaslicer.sh
fi
cd /w
F="-pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1 -O2"
if [ ! -f occt-src/adm/cmake/occt_toolkit.cmake.prusa ]; then
  Z=occt-V7_6_1.zip
  [ -f $Z ] || curl -sSL -o $Z https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V7_6_1.zip
  echo "b7cf65430d6f099adc9df1749473235de7941120b5b5dd356067d12d0909b1d3  $Z" | sha256sum -c -
  rm -rf occt-src OCCT-7_6_1 && python3 -c "import zipfile;zipfile.ZipFile('$Z').extractall('.')" && mv OCCT-7_6_1 occt-src
  cp /w/prusa/deps/+OCCT/occt_toolkit.cmake occt-src/adm/cmake/ && touch occt-src/adm/cmake/occt_toolkit.cmake.prusa
fi
# Two link fixes (as shared/occt/build-occt.sh): OCCT appends -fexceptions after our flags (JS
# exceptions under emcc), and OCC_CONVERT_SIGNALS puts a setjmp inside try blocks; both break the app's link in wasm-opt
# ("popping from empty stack"). A browser has no signals to convert: OCC_CATCH_SIGNALS becomes empty, plain C++ exceptions.
sed -i 's/ -fexceptions -fPIC/ -fPIC/' occt-src/adm/cmake/occt_defs_flags.cmake
sed -i 's/^  add_definitions(-DOCC_CONVERT_SIGNALS)$/  # add_definitions(-DOCC_CONVERT_SIGNALS)  (browser: no signals)/' occt-src/adm/cmake/occt_defs_flags.cmake
rm -rf occt-build prefix-occt
emcmake cmake -S occt-src -B occt-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/w/prefix-occt \
  -DCMAKE_C_FLAGS="$F" -DCMAKE_CXX_FLAGS="$F" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DINSTALL_DIR_LAYOUT=Unix -DBUILD_LIBRARY_TYPE=Static -DUSE_TK=OFF -DUSE_TBB=OFF -DUSE_FREETYPE=OFF -DUSE_FFMPEG=OFF -DUSE_VTK=OFF \
  -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_FREEIMAGE=OFF -DUSE_RAPIDJSON=OFF -DUSE_DRACO=OFF -DUSE_OPENVR=OFF \
  -DBUILD_DOC_Overview=OFF -DBUILD_SAMPLES_QT=OFF -DBUILD_Inspector=OFF \
  -DBUILD_MODULE_ApplicationFramework=OFF -DBUILD_MODULE_Draw=OFF -DBUILD_MODULE_FoundationClasses=OFF \
  -DBUILD_MODULE_ModelingAlgorithms=OFF -DBUILD_MODULE_ModelingData=OFF -DBUILD_MODULE_Visualization=OFF > occt-cfg.log 2>&1 || { tail -30 occt-cfg.log; exit 1; }
cmake --build occt-build -j ${JOBS:-20} > occt-build.log 2>&1 || { grep -E 'error' occt-build.log | head -30; exit 1; }
cmake --install occt-build > occt-install.log 2>&1
echo OCCT-BUILD-OK
