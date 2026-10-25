# Bambu Studio's GUI-only libraries that Orca's GUI has not: libharu (PDF of assembly steps; Bambu's own copy
# in deps/libharu) and FFmpeg n7.0.2 (camera stream decoder AVVideoDecoder; Bambu's deps/FFMPEG/FFMPEG.cmake
# configure line, for wasm: static, no asm). Into /w/ow/prefix-mt. b3d-emsdk:6.0.10, run from /w.
set -e
P=/w/ow/prefix-mt; J=${JOBS:-24}
FL="-O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sWASM_LEGACY_EXCEPTIONS=1"
embuilder build zlib libpng-mt-legacysjlj > /dev/null 2>&1
mkdir -p /w/gdeps && cd /w/gdeps
if [ ! -f $P/lib/libhpdf.a ]; then
  rm -rf haru && mkdir haru && cd haru
  emcmake cmake /w/bambu/deps/libharu/libharu -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$P \
    -DBUILD_SHARED_LIBS=OFF -DLIBHPDF_EXAMPLES=OFF -DCMAKE_C_FLAGS="$FL" -DCMAKE_PREFIX_PATH=$P > cfg.log 2>&1 || { tail -30 cfg.log; exit 1; }
  ninja -j$J install > build.log 2>&1 || { tail -30 build.log; exit 1; }
  cd ..
  echo HARU-OK
fi
if [ ! -f $P/lib/libavcodec.a ]; then
  [ -f n7.0.2.tar.gz ] || curl -sL -o n7.0.2.tar.gz https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n7.0.2.tar.gz
  echo "5eb46d18d664a0ccadf7b0adee03bd3b7fa72893d667f36c69e202a807e6d533  n7.0.2.tar.gz" | sha256sum -c -
  rm -rf FFmpeg-n7.0.2 && tar xf n7.0.2.tar.gz && cd FFmpeg-n7.0.2
  emconfigure ./configure --prefix=$P --enable-cross-compile --target-os=none --arch=x86_32 \
    --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm --disable-asm --disable-x86asm --disable-inline-asm \
    --disable-stripping --disable-programs --enable-static --disable-shared --extra-cflags="$FL" --extra-ldflags="$FL" \
    --disable-doc --enable-small --disable-outdevs --disable-filters \
    '--enable-filter=*null*,afade,*fifo,*format,*resample,aeval,allrgb,allyuv,atempo,pan,*bars,color,*key,crop,draw*,eq*,framerate,scale,volume,test*' \
    --disable-protocols --enable-protocol=file,fd,pipe,rtp,udp --disable-muxers --enable-muxer=rtp --disable-encoders --disable-decoders \
    '--enable-decoder=*aac*,h264*,mp3*,mjpeg,rv*' --disable-demuxers --enable-demuxer=h264,mp3,mov --disable-zlib --disable-avdevice \
    --enable-gpl --disable-network --disable-hwaccels --disable-vaapi --disable-vdpau --enable-pthreads > cfg.log 2>&1 || { tail -40 cfg.log; tail -40 ffbuild/config.log; exit 1; }
  emmake make -j$J > build.log 2>&1 || { grep -n -B2 -A6 "error" build.log | head -60; exit 1; }
  make install > install.log 2>&1
  echo FFMPEG-OK
fi
ls $P/lib/libhpdf.a $P/lib/libavcodec.a $P/lib/libswscale.a $P/lib/libavutil.a $P/lib/pkgconfig/libavcodec.pc
