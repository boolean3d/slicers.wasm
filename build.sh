#!/bin/bash
# Builds one slicer for the browser from this repository, from scratch:
#   bash build.sh bambu|orca|prusa <work dir> [jobs]
# Needs Docker, git, curl, unzip and about 40 GB free in <work dir>. Takes about an hour on 24 cores.
# The work dir ends up laid out as the build expects it inside the container (mounted at /w):
#   /w/browser-port  this repository's bambu-studio/, orcaslicer/ or prusaslicer/ folder (browser-build/, shared/,
#                 wxwidgets-opengl/, wxwidgets-web/, wxwidgets-drawing/, patches/)
#   /w/owx        wxWidgets (OrcaSlicer's fork) with patches/wxwidgets.patch; for PrusaSlicer /w/pwx, PrusaSlicer's own
#                 wxWidgets 3.2 fork with prusaslicer/patches/wxwidgets.patch
#   /w/bambu, /w/orca or /w/prusa   the slicer's own source at its release tag (+ patches/bambu-studio.patch or orcaslicer.patch)
#   /w/eng or /w/eng-orca the Muon3D slicer engine at its pinned commit with patches/muon3d-engine.patch (PrusaSlicer builds
#                 its own slicing core and takes only the engine's library scripts, unchanged)
#   /w/ow         the engine's third-party libraries, built by the engine's own scripts
#   /w/gdeps      the GUI-only libraries (OpenSSL, curl, OpenCV, Draco; libharu and FFmpeg for Bambu Studio)
#   /w/occt       OCCT 7.6.0 for Bambu Studio's and OrcaSlicer's STEP import (shared/occt/build-occt.sh; seen in the
#                 container as /occt); PrusaSlicer
#                 builds its own pinned OCCT 7.6.1 into /w/prefix-occt, and its other libraries into the same /w/ow
# Output: <out>/<program>.{html,js,wasm,data} (program = bambustudio, orcaslicer or prusaslicer), wxwebview-sw.js,
# resources/ (out = /w/bgui; PrusaSlicer /w/pgui/prusa/src);
# package/package.mjs then makes the files a web host serves.
set -euo pipefail
APP=${1:?bambu or orca}; W=$(mkdir -p "${2:?work dir}" && cd "$2" && pwd); JOBS=${3:-24}
HERE=$(cd "$(dirname "$0")" && pwd)
WX_URL=https://github.com/SoftFever/Orca-deps-wxWidgets.git; WX_COMMIT=139e4f2; WX_DIR=owx
case $APP in
  bambu) FOLDER=bambu-studio; SRC_URL=https://github.com/bambulab/BambuStudio.git; SRC_TAG=v02.08.02.61; SRC_DIR=bambu; ENG_DIR=eng
         ENG_COMMIT=adaee71fcc81a851075867792bacd234d6bede35; OUT=bgui ;;
  orca)  FOLDER=orcaslicer; SRC_URL=https://github.com/OrcaSlicer/OrcaSlicer.git; SRC_TAG=v2.3.2; SRC_DIR=orca; ENG_DIR=eng-orca
         ENG_COMMIT=cdd8195; OUT=bgui ;;
  prusa) FOLDER=prusaslicer; SRC_URL=https://github.com/prusa3d/PrusaSlicer.git; SRC_TAG=version_2.9.6; SRC_DIR=prusa; ENG_DIR=eng
         ENG_COMMIT=adaee71fcc81a851075867792bacd234d6bede35; OUT=pgui/prusa/src
         WX_URL=https://github.com/prusa3d/wxWidgets.git; WX_COMMIT=5462e7d7cf; WX_DIR=pwx ;;
  *) echo "bambu, orca or prusa"; exit 1 ;;
esac
ENG_URL=https://github.com/Muon-3D/muon3d-slicer-engine.git
# The build image is named by its Dockerfile's content: a changed Dockerfile makes (and uses) a new image.
IMAGE=b3d-emsdk:6.0.10-$(sha256sum "$HERE/docker/Dockerfile" | cut -c1-12)
cd "$W"
docker image inspect $IMAGE > /dev/null 2>&1 || docker build -t $IMAGE "$HERE/docker"
run() { docker run --rm -e JOBS=$JOBS "$@" -v "$W":/w -w /w $IMAGE bash -c "$CMD" < /dev/null; }

# Sources, at their pins, with this repository's changes.
# A fresh copy (the container sees only /w); removed in the container, since earlier runs leave its files in there.
CMD="rm -rf /w/browser-port"; run
cp -r "$HERE/$FOLDER" browser-port
# PrusaSlicer's GUI libraries OpenSSL and curl are built by the same script as Bambu Studio's
if [ $APP = prusa ]; then cp "$HERE/bambu-studio/browser-build/build-gui-libraries.sh" browser-port/browser-build/; fi
if [ ! -d $WX_DIR ]; then
  git clone -q $WX_URL $WX_DIR && git -C $WX_DIR checkout -q $WX_COMMIT && git -C $WX_DIR apply --whitespace=nowarn "$HERE/$FOLDER/patches/wxwidgets.patch"
fi
# wxWidgets' submodules: its configure checks for them (3rdparty/catch) and build-wx.sh uses its own libpng and libjpeg.
[ -f $WX_DIR/3rdparty/catch/include/catch.hpp ] || git -C $WX_DIR submodule update -q --init --depth 1
if [ ! -d $SRC_DIR ]; then
  git clone -q --depth 1 --branch $SRC_TAG $SRC_URL $SRC_DIR
  for p in "$HERE/$FOLDER"/patches/{bambu-studio,orcaslicer}.patch; do if [ -f "$p" ]; then git -C $SRC_DIR apply --whitespace=nowarn "$p"; fi; done
fi
if [ ! -d $ENG_DIR ]; then
  git clone -q $ENG_URL $ENG_DIR && git -C $ENG_DIR checkout -q $ENG_COMMIT
  if [ $APP != prusa ]; then git -C $ENG_DIR apply "$HERE/$FOLDER/patches/muon3d-engine.patch"; fi
fi
[ -f $ENG_DIR/orca/cmake/modules/Findlibnoise.cmake ] || git -C $ENG_DIR submodule update -q --init --depth 1 orca

# GUI-only library sources (hash-checked).
mkdir -p gdeps && cd gdeps
fetch() {  # url file sha256 dir
  [ -d "$4" ] && return
  [ -f "$2" ] || curl -sfL -o "$2" "$1"
  echo "$3  $2" | sha256sum -c - > /dev/null
  case $2 in *.zip) unzip -q "$2" ;; *) tar xf "$2" ;; esac
}
fetch https://github.com/openssl/openssl/releases/download/openssl-3.0.15/openssl-3.0.15.tar.gz openssl-3.0.15.tar.gz \
  23c666d0edf20f14249b3d8f0368acaee9ab585b09e1de82107c66e1f3ec9533 openssl-3.0.15
fetch https://curl.se/download/curl-8.10.1.tar.gz curl-8.10.1.tar.gz \
  d15ebab765d793e2e96db090f0e172d127859d78ca6f6391d7eafecfd894bbc0 curl-8.10.1
fetch https://github.com/opencv/opencv/archive/refs/tags/4.6.0.tar.gz opencv-4.6.0.tar.gz \
  1ec1cba65f9f20fe5a41fda1586e01c70ea0c9a6d7b67c9e13edf0cfe2239277 opencv-4.6.0
[ $APP = orca ] && fetch https://github.com/google/draco/archive/refs/tags/1.5.7.zip draco-1.5.7.zip \
  27b72ba2d5ff3d0a9814ad40d4cb88f8dc89a35491c0866d952473f8f9416b77 draco-1.5.7
cd "$W"

# The engine's third-party libraries (Boost, oneTBB, CGAL, Eigen, ...), by the engine's own scripts, into /w/ow/prefix-mt.
# The scripts' smoke test reads cmake/modules (Findlibnoise, ...; it has no FindEigen3, so Eigen 5 is found by its own config) from the engine's own orca/
# submodule (Muon3D's OrcaSlicer fork), fetched above at the engine's pinned commit. The stamp is written only after the
# smoke test passes (initial-cache.cmake is written before it, so it cannot mark the step done).
CMD="export ORCA_WASM_ROOT=/w/ow ORCA_EMSDK=/emsdk VARIANT=mt; bash /w/$ENG_DIR/engine/deps/fetch-deps.sh && bash /w/$ENG_DIR/engine/deps/build-deps.sh && touch /w/ow/deps-ok"
[ -f ow/deps-ok ] || run

# Bambu Studio and PrusaSlicer include boost/stacktrace.hpp (Boost.Stacktrace, header-only; the engine's Boost build leaves it out).
# The GUI compiles it with BOOST_STACKTRACE_USE_NOOP (wasm has no unwinder), so the headers are all it needs.
if [ $APP != orca ]; then
  CMD="cp -r /w/ow/deps-src/boost-1.84.0/libs/stacktrace/include/boost/. /w/ow/prefix-mt/include/boost/"; run
fi
# PrusaSlicer: OpenSSL and curl, then the libraries only it uses (into /w/ow), its own Eigen 3.3.7 and OCCT 7.6.1,
# wxWidgets, then PrusaSlicer.
if [ $APP = prusa ]; then
  CMD="bash /w/browser-port/browser-build/build-gui-libraries.sh && bash /w/browser-port/browser-build/build-prusaslicer-libraries.sh | tee /w/pdeps.log && ! grep -q FAILED /w/pdeps.log"; run
  CMD="bash /w/browser-port/browser-build/build-eigen.sh"; [ -d prefix-eigen ] || run
  CMD="bash /w/browser-port/browser-build/build-occt-prusaslicer.sh"; [ -f prefix-occt/lib/cmake/opencascade/OpenCASCADEConfig.cmake ] || run
  CMD="bash /w/browser-port/browser-build/build-wxwidgets.sh"; run
  CMD="bash /w/browser-port/browser-build/build-slicer.sh | tee /w/pgui.run.log && grep -q BUILD-OK /w/pgui.run.log && ln -sfn ../../../prusa/resources /w/$OUT/resources && cp /w/browser-port/wxwidgets-web/js/wxwebview-sw.js /w/$OUT/"
  run -e TARGETS=PrusaSlicer
  echo "built: $W/$OUT/prusaslicer.html"; exit 0
fi

# The GUI-only libraries, OCCT, wxWidgets, then the slicer.
CMD="bash /w/browser-port/browser-build/build-gui-libraries.sh && bash /w/browser-port/browser-build/build-opencv.sh"; run
if [ $APP = bambu ]; then CMD="bash /w/browser-port/browser-build/build-gui-libraries-bambu.sh"; run; fi
# OCCT 7.6.0 (the version both slicers pin, with their 0001-OCCT-fix.patch) for STEP import: /w/occt/prefix-7.6.0, which
# browser-build/CMakeLists.txt reads at /occt.
CMD="OCCT_WORK=/w/occt SLICER_SRC=/w/$SRC_DIR bash /w/browser-port/shared/occt/build-occt.sh"
[ -f occt/prefix-7.6.0/lib/cmake/opencascade/OpenCASCADEConfig.cmake ] || run
CMD="bash /w/browser-port/browser-build/build-wxwidgets.sh"; run
# The vendor presets bundle: one file under resources/b3d-bundle that the program's worker serves the preset files from,
# made from the (patched) profiles; the build preloads it. Rewritten on every run; its js and CMake lines are in browser-port/.
CMD="python3 /w/browser-port/browser-build/presets-bundle/write-presets-bundle.py /w"; run
# Then what package.mjs reads next to the build: the slicer's resources/ (its web pages are fetched from the network)
# and the service worker that serves those pages to the in-tab browser. In the container: bgui/ is the container's.
# Bambu Studio's resources/images, web and hms come from browser-build/remove-maker-branding.py's copy (made at configure time into
# bgui/maker-free: no maker logo, no Bambu account sign-in, no store, no telemetry page), every other folder is the tree's.
# OrcaSlicer's maker-free image edits are in patches/orcaslicer.patch, so its resources/ is the tree's.
if [ $APP = bambu ]; then
  RES='rm -rf /w/bgui/resources && mkdir /w/bgui/resources && for r in /w/bambu/resources/*; do n=$(basename $r);
    if [ -d /w/bgui/maker-free/$n ]; then cp -r /w/bgui/maker-free/$n /w/bgui/resources/$n; else ln -s ../../bambu/resources/$n /w/bgui/resources/$n; fi; done'
else
  RES="ln -sfn ../$SRC_DIR/resources /w/bgui/resources"
fi
CMD="bash /w/browser-port/browser-build/build-slicer.sh && $RES && cp /w/browser-port/wxwidgets-web/js/wxwebview-sw.js /w/bgui/"
run -e TARGETS=${APP}_app -v "$W/occt/prefix-7.6.0":/occt:ro
echo "built: $W/bgui/$([ $APP = bambu ] && echo bambustudio || echo orcaslicer).html"
