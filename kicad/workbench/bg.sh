#!/bin/bash
# bg.sh <name> <script in spike/gui> [ENV=VAL...]: run a build script in b3d-emsdk-kicad on the big box, detached; log <name>.run.log
# /w = the work dir; /w/ow = the slicers' engine deps prefix (Boost, curl, OpenSSL, expat, libjpeg, nanosvg: read-only, the slicers' deps work dir (ow))
# The box stops itself after 15 minutes without "busy" processes (cad-idle-check), and a container's compilers do not count
# (the box stopped mid-build, 10-25 03:55 UTC). The check's own signal for a job: a file "${WORK:-.}/wait/<live pid>".
# The detached shell writes its pid there while the container runs and removes it when the container ends.
N=$1; S=$2; shift 2; E=""; for kv in "$@"; do E="$E -e $kv"; done
cd "${WORK:-.}"
docker rm -f kicad-$N >/dev/null 2>&1
mkdir -p "${WORK:-.}/wait"
setsid nohup bash -c "trap 'rm -f wait/\$\$' EXIT; touch wait/\$\$; docker run --rm --name kicad-$N -u $(id -u):$(id -g) -e JOBS=${JOBS:-16} $E -v \$PWD:/w -v ${OW:?the slicers deps work dir}:/w/ow:ro -w /w b3d-emsdk-kicad:6.0.10 bash /w/spike/gui/$S < /dev/null > $N.run.log 2>&1; echo EXIT \$? >> $N.run.log" > /dev/null 2>&1 &
echo started $N
