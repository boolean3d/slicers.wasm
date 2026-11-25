#!/bin/bash
# The steps "slicers update" runs on the build machine, as plain words (no quoting through ssh):
#   build-step.sh build <app>     build.sh, log in <BUILD_DIR>/build-<app>.log; prints its last lines and first errors;
#                                 a dropped connection ends it, and running it again goes on from what is built
#   build-step.sh package <app> <version> <out folder under the work dir> <source rev>
# Run from <BUILD_DIR>, which holds src-<app> (this repository, with .build-env: BUILD_CAP, JOBS, NODE_ENV) and w.
set -uo pipefail
STEP=$1; APP=$2; D=$(pwd); S=$D/src-$APP; LOG=$D/build-$APP.log
[ -f "$S/.build-env" ] && source "$S/.build-env"
case $STEP in
  build)
    BUILD_CAP="${BUILD_CAP:-}" bash "$S/build.sh" $APP "$D/w" ${JOBS:-12} > "$LOG" 2>&1; rc=$?
    tail -4 "$LOG"
    [ $rc = 0 ] || { echo "--- first errors:"; grep -n -m 15 -E "error:|PATCH NO LONGER|FAILED:|CMake Error|did not match|Killed" "$LOG"; }
    exit $rc ;;
  package)
    eval "${NODE_ENV:-true}"
    rm -rf "$D/pkg-$APP"
    node "$S/package/package.mjs" --app $APP --src "$D/w/$4" --version "$3" --out "$D/pkg-$APP" --licence "$S/LICENSE" \
      --start "$S/package/$APP-start.txt" --source https://github.com/boolean3d/slicers.wasm --source-rev "$5" 2>&1 | tail -3
    [ -f "$D/pkg-$APP/$APP/$3/index.html" ] ;;
esac
