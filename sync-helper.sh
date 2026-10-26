#!/bin/bash
# Refresh helper/ (the printer helper Bambu Studio in a tab talks to) from the Boolean3d checkout it is written in,
# so this repository carries the same files the helper's installer serves. MIT, Node only, no packages.
#   bash sync-helper.sh <Boolean3d checkout>
set -euo pipefail
FROM=$(cd "${1:?Boolean3d checkout}" && pwd)/farm-helper
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$HERE/helper/bambu-home" "$HERE/helper/bambu.mjs" "$HERE/helper/prusalink.mjs"
mkdir -p "$HERE/helper/bambu-home"
cp "$FROM/bambu.mjs" "$FROM/prusalink.mjs" "$HERE/helper/"
for f in helper lan tablink pairing autostart app ws tunnel; do cp "$FROM/bambu-home/$f.mjs" "$HERE/helper/bambu-home/"; done
cp "$FROM/bambu-home/LICENSE" "$HERE/helper/bambu-home/"
cp "$FROM/bambu-home/LICENSE" "$HERE/helper/LICENSE"
bash "$HERE/check-public.sh"
echo "synced helper/ from $FROM"
