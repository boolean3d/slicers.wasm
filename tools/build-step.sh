#!/bin/bash
# The steps "slicers update" runs on the build machine, as plain words (no quoting through ssh):
#   build-step.sh start <app>     build.sh in the background (it outlives the connection), log in <BUILD_DIR>/build-<app>.log
#   build-step.sh wait <app>      waits for it; prints the last lines; exit code = the build's
#   build-step.sh package <app> <version> <out folder under the work dir> <source rev>
# Run from <BUILD_DIR>, which holds src-<app> (this repository, with .build-env: BUILD_CAP, JOBS, NODE_ENV) and w.
set -uo pipefail
STEP=$1; APP=$2; D=$(pwd); S=$D/src-$APP; LOG=$D/build-$APP.log
[ -f "$S/.build-env" ] && source "$S/.build-env"
case $STEP in
  start)
    rm -f "$LOG.exit"
    nohup setsid bash -c "export BUILD_CAP='${BUILD_CAP:-}'; bash '$S/build.sh' $APP '$D/w' ${JOBS:-12} > '$LOG' 2>&1; echo \$? > '$LOG.exit'" > /dev/null 2>&1 < /dev/null &
    echo "started, log $LOG" ;;
  wait)
    while [ ! -f "$LOG.exit" ]; do sleep 20; done
    tail -4 "$LOG"; rc=$(cat "$LOG.exit")
    [ "$rc" = 0 ] || { echo "--- first errors:"; grep -n -m 15 -E "error:|PATCH NO LONGER|FAILED:|CMake Error|did not match|Killed" "$LOG"; }
    exit "$rc" ;;
  package)
    eval "${NODE_ENV:-true}"
    rm -rf "$D/pkg-$APP"
    node "$S/package/package.mjs" --app $APP --src "$D/w/$4" --version "$3" --out "$D/pkg-$APP" --licence "$S/LICENSE" \
      --start "$S/package/$APP-start.txt" --source https://github.com/boolean3d/slicers.wasm --source-rev "$5" 2>&1 | tail -3
    [ -f "$D/pkg-$APP/$APP/$3/index.html" ] ;;
esac
