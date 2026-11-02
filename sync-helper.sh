#!/bin/bash
# Refresh helper/ (the home printer helper the slicers in a tab talk to) from the Boolean3d checkout it is written in,
# so this repository carries exactly the files the helper's installer serves: farm-helper/FILES.txt (the one list the
# one-line install, the Pi image and the Klipper install copy), plus the desktop app's entry, the read-me, the guide to
# adding a printer driver and its template. MIT, Node only, no packages.
#   bash sync-helper.sh <Boolean3d checkout>
set -euo pipefail
FROM=$(cd "${1:?Boolean3d checkout}" && pwd)/farm-helper
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$HERE/helper"
{ grep -vE '^\s*(#|$)' "$FROM/FILES.txt"; printf '%s\n' bambu-home/app.mjs README.md DRIVERS.md LICENSE drivers/template.mjs; } |
while read -r f; do mkdir -p "$HERE/helper/$(dirname "$f")"; cp "$FROM/$f" "$HERE/helper/$f"; done
# The drivers' test and the PrusaLink stand-in it prints to, pointed at helper/ (DRIVERS.md step 5: node --test helper/test/).
mkdir -p "$HERE/helper/test"
sed -e 's#"farm-helper/#"helper/#g' -e 's#"scripts/farm/helper/standin-prusalink.mjs"#"helper/test/standin-prusalink.mjs"#' \
    "$FROM/../test/unit/helper-drivers.test.js" > "$HERE/helper/test/helper-drivers.test.cjs"
cp "$FROM/../scripts/farm/helper/standin-prusalink.mjs" "$HERE/helper/test/"
sed -i 's#test/unit/helper-drivers.test.js#helper/test/helper-drivers.test.cjs#g' "$HERE/helper/DRIVERS.md" "$HERE/helper/drivers/template.mjs"
bash "$HERE/check-public.sh"
echo "synced helper/ from $FROM"
