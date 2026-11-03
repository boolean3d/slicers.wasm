#!/bin/bash
# protoc with the well-known .proto files of the wasm protobuf prefix (KiCad gives protoc only its own proto path and
# relies on the system include path, where a desktop has libprotobuf-dev)
exec /usr/bin/protoc -I/w/prefix-kdeps/include "$@"
