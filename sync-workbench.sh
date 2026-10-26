#!/bin/bash
# Refresh one app folder of this repository (bambu-studio/, orcaslicer/ or prusaslicer/) from the workbench the
# shipped build is made in, so the source we publish is the source of what we ship. Run it before packaging a build for upload, then rebuild from scratch
# (build.sh) to prove the refreshed folder reproduces it.
#
#   bash sync-workbench.sh bambu <workbench dir>
#   bash sync-workbench.sh orca <workbench dir>
#   bash sync-workbench.sh prusa <workbench dir>
#
# The workbench holds the edited source trees (wxWidgets in owx/ or, for PrusaSlicer, PrusaSlicer's wx 3.2 fork in pwx/;
# the slicer in bambu/, orca/ or prusa/; the engine in eng/ or eng-orca/) and the browser layer in spike/. From them this
# writes, under the workbench's working names first (below), then moved to this repository's plain names by
# rename-workbench-files.py (patches/bambustudio.patch becomes bambu-studio.patch, gui/ browser-build/, slicer-wx/
# shared/, wxgl/ wxwidgets-opengl/, ...):
#   <app>/patches/wxwidgets.patch    the wx tree against WX_COMMIT (the wasm port and every wx edit, flattened)
#   <app>/patches/<slicer>.patch     the slicer tree against its tag: the edits made in the tree itself (most of the
#                                    browser changes are made at build time by <app>/gui/cmake and leave the tree alone;
#                                    PrusaSlicer's tree must stay unchanged)
#   <app>/patches/engine.patch       the engine tree against ENG_COMMIT (its orca/ submodule stays as pinned); a tree
#                                    whose git link is gone is laid over a fresh clone of the commit to compare.
#                                    PrusaSlicer builds its own slicing core: no engine
#   <app>/{gui,wxgl,wxweb,wxgc,...}  spike/'s folders
#   <app>/slicer-wx/                 the shared wx kit (fonts, page scripts, C++), less its edit scripts and its copies
#                                    of wxgc/wxgl/wxweb (the same files as spike/'s, already above)
# The workbench's edit scripts (spike/edit*.py, slicer-wx/edits, slicer-wx/app-edits) are already in the patches and are
# left out, and so are its backup copies (*.before*, *.bak*, *.orig, *.rej).
set -euo pipefail
APP=$1; WB=$(cd "$2" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
WX_DIR=owx; WX_COMMIT=139e4f2; DIRS="gui wxgl wxweb wxgc"
case $APP in
  bambu) FOLDER=bambu-studio; SRC_DIR=bambu; SRC_TAG=v02.08.02.61; SRC_PATCH=bambustudio.patch; ENG_DIR=eng
         ENG_COMMIT=adaee71fcc81a851075867792bacd234d6bede35; NOT_THIS_APP=gui/orca-pre.js ;;
  orca)  FOLDER=orcaslicer; SRC_DIR=orca; SRC_TAG=v2.3.2; SRC_PATCH=orcaslicer.patch; ENG_DIR=eng-orca; ENG_COMMIT=cdd8195; NOT_THIS_APP=gui/bambu-pre.js ;;
  prusa) FOLDER=prusaslicer; SRC_DIR=prusa; SRC_TAG=version_2.9.6; SRC_PATCH=; ENG_DIR=; WX_DIR=pwx; WX_COMMIT=5462e7d7cf; NOT_THIS_APP=gui/bambu-pre.js
         DIRS="gui wxgl wxweb wxgc wxjs net" ;;
  *) echo "usage: sync-workbench.sh bambu|orca|prusa <workbench>"; exit 2 ;;
esac
ENG_URL=https://github.com/Muon-3D/muon3d-slicer-engine.git
# Written in a fresh folder under the workbench's names, then renamed, then put in place of the app folder.
DEST="$HERE/$FOLDER"; OUT=$(mktemp -d)/$APP; mkdir -p "$OUT"

# A release build of FFmpeg must not be --enable-nonfree (GPL builds with it cannot be published).
if grep -l -- '--enable-nonfree' "$WB"/spike/gui/*.sh; then
  echo "sync-workbench.sh: the workbench builds FFmpeg with --enable-nonfree (above); fix the workbench first"; exit 1
fi

# The tree's state against a commit, untracked files included, without touching the tree's own index.
tree_diff() {  # dir commit [pathspec excludes...]
  local dir=$1 base=$2; shift 2
  local idx; idx=$(mktemp)
  GIT_INDEX_FILE=$idx git -C "$dir" read-tree HEAD
  GIT_INDEX_FILE=$idx git -C "$dir" add -A -- . "$@"
  GIT_INDEX_FILE=$idx git -C "$dir" diff --cached --binary --ignore-submodules=all "$base" -- . "$@"
  rm -f "$idx"
}
# A tree whose .git points nowhere (copied from another machine): its files over a fresh clone of the commit.
overlay_diff() {  # dir url commit
  local dir=$1 url=$2 base=$3 tmp; tmp=$(mktemp -d)
  git clone -q "$url" "$tmp/c" && git -C "$tmp/c" checkout -q "$base"
  (cd "$dir" && tar cf - --exclude=./.git --exclude=./orca .) | (cd "$tmp/c" && tar xf -)
  git -C "$tmp/c" add -A -- . ':(exclude)orca'
  git -C "$tmp/c" diff --cached --binary --ignore-submodules=all "$base" -- . ':(exclude)orca'
  rm -rf "$tmp"
}
# Left out of the slicer tree's patch: the workbench's backup copies, and the vendor presets bundle (a build product:
# build.sh makes it again from the patched profiles with gui/bundle/p2-bundle.py)
TREE_EXCLUDES=(':(exclude)*.before*' ':(exclude)*.bak*' ':(exclude)*.orig' ':(exclude)*.rej' ':(exclude)resources/b3d-bundle')
mkdir -p "$OUT/patches"
tree_diff "$WB/$WX_DIR" $WX_COMMIT > "$OUT/patches/wxwidgets.patch"
if [ -n "$SRC_PATCH" ]; then
  tree_diff "$WB/$SRC_DIR" $SRC_TAG "${TREE_EXCLUDES[@]}" > "$OUT/patches/$SRC_PATCH"
  [ -s "$OUT/patches/$SRC_PATCH" ] || rm -f "$OUT/patches/$SRC_PATCH"
elif [ -n "$(tree_diff "$WB/$SRC_DIR" $SRC_TAG "${TREE_EXCLUDES[@]}")" ]; then
  echo "sync-workbench.sh: $WB/$SRC_DIR differs from $SRC_TAG; this app's slicer changes belong in gui/cmake"; exit 1
fi
if [ -z "$ENG_DIR" ]; then :
elif git -C "$WB/$ENG_DIR" rev-parse -q --verify HEAD > /dev/null 2>&1; then
  tree_diff "$WB/$ENG_DIR" $ENG_COMMIT ':(exclude)orca' > "$OUT/patches/engine.patch"
else
  overlay_diff "$WB/$ENG_DIR" $ENG_URL $ENG_COMMIT > "$OUT/patches/engine.patch"
fi

# The browser layer, as the workbench has it.
BACKUPS="--exclude=*.before* --exclude=*.bak* --exclude=*.orig --exclude=*.rej"
for d in $DIRS; do
  rm -rf "$OUT/$d"
  (cd "$WB/spike" && tar chf - --exclude=__pycache__ --exclude=build --exclude='gui/resources' --exclude='gui/shims' $BACKUPS \
     --exclude="$NOT_THIS_APP" --exclude='gui/build-wxweb.sh' \
     --exclude='gui/bed-mark-off.py' --exclude='gui/combo-thaw.py' "$d") | (cd "$OUT" && tar xf -)
done
# The vendor presets bundle's writer (from the off-thread recipe the workbench applies; RECIPE= names it): build.sh runs it
# on the patched tree. Its other edits (wxfs-bundle.js, CMake lines) are already in spike/.
if [ -n "$ENG_DIR" ]; then
  RECIPE=${RECIPE:-$WB/../off-thread-bambu/bulk/recipe}
  mkdir -p "$OUT/gui/bundle" && cp "$RECIPE/p2-bundle.py" "$RECIPE/wxfs-bundle.js" "$OUT/gui/bundle/"
fi
rm -rf "$OUT/slicer-wx"
(cd "$WB/spike" && tar chf - --exclude=__pycache__ --exclude='slicer-wx/edits' --exclude='slicer-wx/app-edits*' $BACKUPS \
   --exclude='slicer-wx/wxgc' --exclude='slicer-wx/wxgl' --exclude='slicer-wx/wxweb' --exclude='slicer-wx/*.py' slicer-wx) | (cd "$OUT" && tar xf -)

# The one place this repository's build differs from the workbench's: build.sh applies wxwidgets.patch, which already
# holds the wx edits the workbench runs as scripts.
sed -i -E 's#^\(cd \$\{SRCTREE\} && python3 /w/spike/edit(5|-filedlg)\.py.*#\# (the wx edits are already in patches/wxwidgets.patch)#' "$OUT/gui/build-wx.sh"
grep -q 'the wx edits are already in patches/wxwidgets.patch' "$OUT/gui/build-wx.sh" \
  || { echo "sync-workbench.sh: build-wx.sh's edit line changed; update this script"; exit 1; }
# PrusaSlicer's build-gui.sh runs the same edits again before its build
sed -i 's#^(cd /w/pwx && for e in /w/spike/slicer-edits/\*\.py.*#\# (the wx edits are already in patches/wxwidgets.patch)#' "$OUT/gui/build-gui.sh"
RUNS_EDITS=$(grep -n '/w/spike/edit\|slicer-wx/edits\|/w/spike/slicer-edits' "$OUT/gui"/*.sh | grep -v ':[0-9]*: *#' || true)
if [ -n "$RUNS_EDITS" ]; then
  echo "sync-workbench.sh: $OUT/gui still runs workbench edit scripts:"; echo "$RUNS_EDITS"; exit 1
fi
# CLEAN=<command>: run on the folder (as <command> <folder>) while it still has the workbench's names, e.g. to clear
# the workbench's own notes out of comments before check-public.sh reads them.
if [ -n "${CLEAN:-}" ]; then $CLEAN "$OUT"; fi
# The workbench's names -> this repository's, then the folder replaces the app folder.
python3 "$HERE/rename-workbench-files.py" $APP "$OUT"
# Every file the build names must be in the folder.
for f in $(grep -o -E '(CMAKE_CURRENT_SOURCE_DIR\}|/w/browser-port/browser-build)/[^ ";@)>]*' "$OUT/browser-build/CMakeLists.txt" | sed 's#^[^/]*/##; s#^w/browser-port/browser-build/##' | grep -v '\$' | sort -u); do
  [ "$f" = shims ] || [ -e "$OUT/browser-build/$f" ] || { echo "sync-workbench.sh: browser-build/CMakeLists.txt reads $f, not in the folder"; exit 1; }
done
rm -rf "$DEST" && mv "$OUT" "$DEST"
bash "$HERE/check-public.sh" || { echo "sync-workbench.sh: synced, but the files above must be cleaned in the workbench before a push"; exit 1; }
echo "synced $APP from $WB"
