# OpenCV 4.6.0 (Orca's own version, deps/OpenCV) for SkipPartCanvas: core, imgproc, imgcodecs (PNG only),
# into the engine's mt prefix with the same flags. b3d-emsdk:6.0.10, /w = build.sh's work dir.
# Source: /w/gdeps/opencv-4.6.0 (github.com/opencv/opencv/archive/refs/tags/4.6.0.tar.gz)
set -e
P=/w/ow/prefix-mt
FL="-O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1"
[ -f $P/lib/libopencv_core.a ] && { echo have-opencv; exit 0; }
cd /w/gdeps/opencv-4.6.0 && mkdir -p b && cd b
emcmake cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$P \
  -DCMAKE_C_FLAGS="$FL" -DCMAKE_CXX_FLAGS="$FL" -DBUILD_SHARED_LIBS=OFF -DBUILD_LIST=core,imgproc,imgcodecs \
  -DCPU_BASELINE= -DCPU_DISPATCH= -DCV_ENABLE_INTRINSICS=OFF -DCV_TRACE=OFF -DENABLE_PIC=FALSE \
  -DWITH_PTHREADS_PF=OFF -DWITH_IPP=OFF -DWITH_ITT=OFF -DWITH_OPENCL=OFF -DWITH_OPENMP=OFF -DWITH_TBB=OFF \
  -DWITH_EIGEN=OFF -DWITH_LAPACK=OFF -DWITH_PROTOBUF=OFF -DWITH_ADE=OFF -DWITH_QUIRC=OFF -DWITH_FFMPEG=OFF \
  -DWITH_GSTREAMER=OFF -DWITH_GTK=OFF -DWITH_V4L=OFF -DWITH_1394=OFF -DWITH_VTK=OFF -DWITH_JPEG=OFF -DWITH_TIFF=OFF \
  -DWITH_WEBP=OFF -DWITH_OPENJPEG=OFF -DWITH_JASPER=OFF -DWITH_OPENEXR=OFF -DWITH_IMGCODEC_HDR=OFF \
  -DWITH_IMGCODEC_SUNRASTER=OFF -DWITH_IMGCODEC_PXM=OFF -DWITH_IMGCODEC_PFM=OFF -DWITH_PNG=ON -DBUILD_PNG=ON -DBUILD_ZLIB=ON \
  -DBUILD_TESTS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_DOCS=OFF -DBUILD_opencv_apps=OFF \
  -DBUILD_opencv_python2=OFF -DBUILD_opencv_python3=OFF -DBUILD_JAVA=OFF -DOPENCV_GENERATE_PKGCONFIG=OFF \
  -DINSTALL_CREATE_DISTRIB=ON > cfg.log 2>&1 || { tail -40 cfg.log; exit 1; }
ninja > make.log 2>&1 || { grep -B2 -A8 "error:" make.log | head -60; exit 1; }
ninja install > inst.log
ls $P/lib | grep opencv; ls $P/lib/cmake/opencv4 2>/dev/null | head -3
