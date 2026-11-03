FROM b3d-emsdk:6.0.10
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends swig protobuf-compiler gperf bison flex pkg-config meson libpcre2-dev gettext && rm -rf /var/lib/apt/lists/*
