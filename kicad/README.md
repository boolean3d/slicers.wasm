# KiCad in a browser tab: the source of the copy served at slicers.boolean3d.com/kicad/

KiCad 10.0.7, made by the KiCad developers (https://gitlab.com/kicad/code/kicad, GPL-3.0-or-later), compiled to
WebAssembly with Emscripten 6.0.10. This browser copy is not made or endorsed by the KiCad team; "KiCad" is their name,
used only to say which program this is. This folder is the Corresponding Source of the served build 10.0.7-k40 (GPLv3
section 6), together with the pinned upstream sources named below.

| Here | What |
|---|---|
| `patches/kicad.patch` | Our changes to KiCad, against tag `10.0.7` (CMake plumbing for one static browser program, a browser platform layer, OpenGL through WebGL2, no 3D mouse, scripting without the Python module, file open and save in a tab) |
| `patches/wxwidgets.patch` | Our changes to wxWidgets: PrusaSlicer's wxWidgets 3.2.6 fork (https://github.com/prusa3d/wxWidgets, commit `5462e7d7cf`) with the wasm port by Adam Hilss carried onto it and our edits (wxWindows Library Licence 3.1) |
| `workbench/` | The build work folder as used (`/w/spike` in the build container): `gui/` build scripts, CMake additions, platform layer (`kiplatform-wasm/`), stand-ins, the page start-up script; `wxgl/`, `wxweb/`, `wxgc/`, `wxjs/`: the browser backends of wxWidgets; `slicer-wx/` and `slicer-edits/`: the browser layer shared with the slicers in this repository; `net/`: the network relay; `play/`: the package (`kicad-package.mjs`, loading screen `kicad-credit.js`, `SOURCE.txt`); `patches/kicad-wasm.patch` = `../patches/kicad.patch`. The `*.py` edit scripts are how the changes were made; their result is in the two patches |
| `docker/Dockerfile` | The build image: this repository's `b3d-emsdk:6.0.10` (`../docker/`) plus swig, protoc, gperf, bison, flex, meson |

## Build it

1. Build images: `docker build -t b3d-emsdk:6.0.10 ../docker` then `docker build -t b3d-emsdk-kicad:6.0.10 docker`.
2. A work folder `W` holding: `W/kicad` = KiCad tag `10.0.7` with `patches/kicad.patch` applied; `W/pwx` = the wxWidgets
   fork at `5462e7d7cf` with `patches/wxwidgets.patch` applied; `W/spike` = a copy of `workbench/`; `W/ow` = the
   slicers' library prefix (Boost, curl, OpenSSL, expat, libjpeg: built by `../build.sh` for OrcaSlicer, `ow/prefix-mt`).
3. In the container (`docker run -v W:/w -w /w b3d-emsdk-kicad:6.0.10`): the library scripts in `spike/gui/`
   (`build-occt.sh`, `build-kdeps.sh`, `build-python.sh`, `build-pyexpat.sh`, `build-glu.sh`, `build-wx.sh`; each one's
   header says what it reads and writes, and pins the sources it fetches), then KiCad itself with `build-gui.sh`.
   `spike/bg.sh <name> <script>` runs one in the background with a log.
4. Package: `node spike/play/kicad-package.mjs` (its header names the arguments).

## Licences

KiCad and our changes to it: GPL-3.0-or-later (`../LICENSES/`). wxWidgets and our changes to it: wxWindows Library
Licence 3.1. Built in: OpenCASCADE 7.6.1 (LGPL-2.1 with OCCT's exception), CPython 3.12.11 (PSF licence), cairo 1.16
(LGPL-2.1 / MPL-1.1), pixman 0.42 (MIT), freetype 2.13 (FTL), harfbuzz 8.5 (Old MIT), fontconfig 2.15 (MIT-like),
zstd 1.5.6 (BSD-3-Clause), glm 1.0.1 (MIT), libgit2 1.8.4 (GPL-2.0 with the linking exception), protobuf 3.21.12
(BSD-3-Clause), nng 1.9 (MIT), pcre2 10.42 (BSD-3-Clause), unixODBC (LGPL-2.1), Boost (BSL-1.0), GLU 9.0.3 (SGI Free
Software License B 2.0), Emscripten's runtime (MIT/UIUC). The demo projects come from KiCad's demos folder and the 3D
part models from kicad-packages3D 10.0.0 (https://gitlab.com/kicad/libraries/kicad-packages3D), both CC BY-SA 4.0
(the models with the KiCad libraries' exception).
