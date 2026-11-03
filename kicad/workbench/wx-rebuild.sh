#!/bin/bash
# Rebuild the KiCad spike's wx on the big box after an edit to pwx (RESUME=1: only what changed), keeping the modification
# times of headers whose content did not change, so KiCad's objects (which depend on every wx header) are not all rebuilt.
set -e
cd "${WORK:-.}"
rm -rf .inc-before && cp -a prefix-wx/include .inc-before
SETUP=$(ls prefix-wx/lib/wx/include/*/wx/setup.h); cp -a $SETUP .setup-before   # setup.h lives under lib/: make install rewrites it and every KiCad object depends on it (a new mtime = full rebuild, 10-25)
JOBS=${JOBS:-14} bash spike/bg.sh wx build-wx.sh RESUME=1; sleep 5
while ! grep -q "^EXIT" wx.run.log; do sleep 10; done; tail -1 wx.run.log
grep -q "^EXIT 0" wx.run.log || { echo "WX BUILD FAILED (an edit script or the compile): nothing installed, KiCad would relink the old library"; grep -B3 "Error\|error:" wx.run.log | tail -12; rm -rf .inc-before .setup-before; exit 1; }
n=0; while IFS= read -r -d "" f; do o=.inc-before/${f#prefix-wx/include/}; if [ -f "$o" ] && cmp -s "$f" "$o"; then touch -r "$o" "$f"; else n=$((n+1)); echo "changed: $f"; fi; done < <(find prefix-wx/include -type f -print0)
if cmp -s $SETUP .setup-before; then touch -r .setup-before $SETUP; else n=$((n+1)); echo "changed: $SETUP"; fi; rm -f .setup-before
echo "headers changed: $n"; rm -rf .inc-before
