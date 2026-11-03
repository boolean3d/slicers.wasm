#!/bin/bash
# Refresh package/loading-art.js (the turning part over every loading screen: the slicers' credit.js, KiCad's kicad-credit.js)
# from the Boolean3d checkout it is written in (js/share/loadingArt.js, where the CAD editor draws the same part). Edit it there.
#   bash sync-loading-art.sh <Boolean3d checkout>
set -euo pipefail
FROM=$(cd "${1:?Boolean3d checkout}" && pwd)/js/share/loadingArt.js
HERE=$(cd "$(dirname "$0")" && pwd)
cp "$FROM" "$HERE/package/loading-art.js"
echo "synced package/loading-art.js from $FROM"
