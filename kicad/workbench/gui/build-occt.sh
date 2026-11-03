# OCCT 7.6.1 (PrusaSlicer's pin, copy of prusa-ui-wasm/occt-src with its two flag edits already made) with every toolkit KiCad's
# cmake/FindOCC.cmake asks for (TKFillet, TKOffset, TKFeat, TKXMesh, TKTObj...: ModelingAlgorithms, Visualization and
# ApplicationFramework on, which the slicers' build left off). Same flags as the slicers' OCCT (slicer-wx/occt/build-occt.sh).
set -e
F="-pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1 -O2"
cd /w
grep -q "fexceptions -fPIC" occt-src/adm/cmake/occt_defs_flags.cmake && { echo "occt-src lacks the slicers' flag edits"; exit 1; }
rm -rf occt-build prefix-occt
emcmake cmake -S occt-src -B occt-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/w/prefix-occt \
  -DCMAKE_C_FLAGS="$F" -DCMAKE_CXX_FLAGS="$F" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DINSTALL_DIR_LAYOUT=Unix -DBUILD_LIBRARY_TYPE=Static -DUSE_TK=OFF -DUSE_TBB=OFF -DUSE_FREETYPE=OFF -DUSE_FFMPEG=OFF -DUSE_VTK=OFF \
  -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_FREEIMAGE=OFF -DUSE_RAPIDJSON=OFF -DUSE_DRACO=OFF -DUSE_OPENVR=OFF \
  -DBUILD_DOC_Overview=OFF -DBUILD_SAMPLES_QT=OFF -DBUILD_Inspector=OFF \
  -DBUILD_MODULE_ApplicationFramework=ON -DBUILD_MODULE_Draw=OFF -DBUILD_MODULE_FoundationClasses=ON \
  -DBUILD_MODULE_ModelingAlgorithms=ON -DBUILD_MODULE_ModelingData=ON -DBUILD_MODULE_Visualization=ON \
  -DBUILD_MODULE_DataExchange=ON > occt-cfg.log 2>&1 || { tail -30 occt-cfg.log; exit 1; }
cmake --build occt-build -j ${JOBS:-16} > occt-build.log 2>&1 || { grep -E "error" occt-build.log | head -30; exit 1; }
cmake --install occt-build > occt-install.log 2>&1
ls prefix-occt/lib | tr "\n" " "
echo OCCT-BUILD-OK
