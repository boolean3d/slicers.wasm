#!/bin/bash
# fix-build.sh: wx rebuild (shared edits, wx-rebuild.sh) then KiCad's three programs (build-gui.sh). Log: fix-build.log
cd "${WORK:-.}"
mkdir -p "${WORK:-.}/wait"; touch "${WORK:-.}/wait/kfix"
trap 'rm -f "${WORK:-.}/wait/kfix"' EXIT
if [ "$NOWX" != 1 ]; then bash spike/wx-rebuild.sh || { echo WX-FAILED; exit 1; }; fi
JOBS=${JOBS:-24} bash spike/bg.sh build build-gui.sh; sleep 5
while ! grep -q "^EXIT" build.run.log; do sleep 10; done; tail -3 build.run.log
