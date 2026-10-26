# Source of the browser slicers

Whoever receives a browser copy of Bambu Studio, OrcaSlicer or PrusaSlicer from us (the `index.wasm`, `index.js`,
`index.data` and web pages a browser downloads) is owed its Corresponding Source under the GNU AGPL-3.0.
This file says what that source is. `build.sh` fetches and builds all of it.

## Pinned upstream sources

| Part | Version | Where |
|---|---|---|
| Bambu Studio | tag `v02.08.02.61` (926a719) | https://github.com/bambulab/BambuStudio, our change: `bambu-studio/patches/bambu-studio.patch` (2 lines) |
| OrcaSlicer | tag `v2.3.2` (c724a3f5) | https://github.com/OrcaSlicer/OrcaSlicer, unchanged in the tree; build-time edits in `orcaslicer/browser-build/CMakeLists.txt` (the `orca_gui_patch` lines) and `orcaslicer/patches/orcaslicer.patch` |
| wxWidgets (OrcaSlicer's fork) | commit `139e4f2` | https://github.com/SoftFever/Orca-deps-wxWidgets, our change (with Adam Hilss's wasm port in it): `<slicer>/patches/wxwidgets.patch` |
| Muon3D slicer engine (Bambu build) | tag `v0.6.1` = `adaee71fcc81a851075867792bacd234d6bede35` | https://github.com/Muon-3D/muon3d-slicer-engine, our change: `bambu-studio/patches/muon3d-engine.patch` |
| Muon3D slicer engine (Orca build) | commit `cdd8195` | same repository, our change: `orcaslicer/patches/muon3d-engine.patch` |
| PrusaSlicer | tag `version_2.9.6` | https://github.com/prusa3d/PrusaSlicer, unchanged in the tree; build-time edits in `prusaslicer/browser-build/prusaslicer-source-edits.cmake` (patched copies made in the build tree) |
| wxWidgets (PrusaSlicer's fork, 3.2.6) | commit `5462e7d7cf` | https://github.com/prusa3d/wxWidgets, our change (with Adam Hilss's wasm port carried onto it): `prusaslicer/patches/wxwidgets.patch` |
| Muon3D slicer engine (PrusaSlicer build) | tag `v0.6.1` | only its library build scripts (`engine/deps`), unchanged; PrusaSlicer builds its own slicing core |

## Libraries built into the slicers

| Library | Version | Licence | How it is fetched |
|---|---|---|---|
| Boost | 1.84.0 | BSL-1.0 | engine `engine/deps/fetch-deps.sh`, hash-checked against its `SHA256SUMS` |
| oneTBB | 2021.12.0 | Apache-2.0 | same |
| CGAL (headers) | 5.6.3 | GPL-3.0-or-later / LGPL-3.0-or-later | same |
| Eigen | 5.0.1 | MPL-2.0 | same |
| cereal | 1.3.0 | BSD-3-Clause | same |
| NLopt | 2.5.0 | LGPL-2.1-or-later / MIT | same |
| libnoise | 1.0 | LGPL-2.1-or-later | same |
| Qhull | 8.0.2 | Qhull | same |
| libjpeg-turbo | 3.0.1 | IJG / BSD-3-Clause / Zlib | same |
| OpenSSL | 3.0.15 | Apache-2.0 | `build.sh`, sha256 `23c666d0…9533` |
| curl | 8.10.1 | curl | `build.sh`, sha256 `d15ebab7…bbc0` |
| OpenCV (core, imgproc, imgcodecs) | 4.6.0 | Apache-2.0 | `build.sh`, sha256 `1ec1cba6…9277` |
| Draco (OrcaSlicer only) | 1.5.7 | Apache-2.0 | `build.sh`, sha256 `27b72ba2…6b77` |
| FFmpeg (Bambu Studio only; camera view) | n7.0.2 | GPL-2.0-or-later as configured | `bambu-studio/browser-build/build-gui-libraries-bambu.sh`, sha256 `5eb46d18…d533` |
| libharu (Bambu Studio only) | Bambu Studio's copy in `deps/libharu` | Zlib | in the Bambu Studio tree |
| Expat | wxWidgets' copy (`src/expat`), and the engine patch's copy for the Bambu build | MIT | in the trees |
| OCCT (Bambu Studio, OrcaSlicer; STEP import) | 7.6.0 + the slicers' own `deps/OCCT/0001-OCCT-fix.patch` | LGPL-2.1 with the Open CASCADE exception | `<slicer>/shared/occt/build-occt.sh`, sha256 `28334f0e…1dbc` |
| zlib, libpng | Emscripten 6.0.10 ports | Zlib / libpng | fetched by Emscripten, pinned by its `tools/ports` hashes |

### PrusaSlicer only

PrusaSlicer builds its own slicing core, so it takes from the engine only the library scripts above (Boost, oneTBB,
CGAL, Eigen 5 for those libraries, cereal, NLopt, libnoise, Qhull, libjpeg-turbo, hash-checked) and adds its own:

| Library | Version | Licence | How it is fetched |
|---|---|---|---|
| Eigen (PrusaSlicer's own pin) | 3.3.7 | MPL-2.0 | `prusaslicer/browser-build/build-eigen.sh`, sha256 `4815118c…2c4b` |
| OCCT (PrusaSlicer's own pin; STEP import) | 7.6.1 with PrusaSlicer's `occt_toolkit.cmake` | LGPL-2.1 with the Open CASCADE exception | `prusaslicer/browser-build/build-occt-prusaslicer.sh`, sha256 `b7cf6543…b1d3` |
| OpenSSL, curl | 3.0.15, 8.10.1 | Apache-2.0, curl | `bambu-studio/browser-build/build-gui-libraries.sh` (the same script), hash-checked |
| libbgcode | commit `6f4ad7ce` | AGPL-3.0 | `prusaslicer/browser-build/build-prusaslicer-libraries.sh`, by commit, no hash |
| heatshrink | 0.4.1 | ISC | same, by tag, no hash |
| nlohmann/json | 3.12.0 | MIT | same, by tag, no hash |
| nanosvg (fltk fork) | commit `abcd277e` | Zlib | same, by commit, no hash |
| Z3 | 4.15.1 | MIT | same, by tag, no hash |
| c-blosc | commit `8724c06e` | BSD-3-Clause | same, by commit, no hash |
| OpenEXR | 2.5.5 | BSD-3-Clause | same, by tag, no hash |
| OpenVDB (prusa3d fork) | commit `339ee882` | MPL-2.0 | same, by commit, no hash |
| hidapi | none (a stand-in `.pc` file: no USB HID in a browser tab) | — | written by `build-pdeps.sh` |
| Expat | wxWidgets' copy in PrusaSlicer's fork (`src/expat`, libexpat 2.4.8) | MIT | `prusaslicer/browser-build/build-wxwidgets.sh` builds it into the shared prefix |

The libraries fetched by commit or tag without a hash come from git archives at a fixed commit; a changed archive
would show as a different tree, not as a silent change of bytes. Hashes for them are still to be added.

The PrusaSlicer builds served as 2.9.6-b21 and -b22 were linked with Expat 2.2.10 from OrcaSlicer's wxWidgets copy (the shared
library prefix of the build machine); a build from this repository takes the 2.4.8 copy in PrusaSlicer's own
wxWidgets fork. Both are MIT; the next served PrusaSlicer build is made from this repository.

The toolchain is used unmodified and is not part of the Corresponding Source: Emscripten 6.0.10 in the
`emscripten/emsdk:6.0.10` container (`docker/Dockerfile` adds Ninja and autotools), Docker, git, Node.js 22.

## Keeping this source the source of what is served

`sync-workbench.sh bambu|orca|prusa <workbench>` rewrites a slicer's folder (patches and browser layer) from the workbench a
build is made in. The workbench uses short working names; `rename-workbench-files.py` moves the copy to the plain
names used here and rewrites every reference to them. It is run before every package that goes to the web host, and `build.sh` from scratch then shows
the folder reproduces the build.

## The package

`package/package.mjs` turns a build into what a web host serves (brotli-compressed files and a manifest of
headers) and adds the loading screen (`package/credit.js`), the lazy loader (`package/install-and-lazy-load.js`: files the program
has not read yet are fetched when it first reads them) and the part opener (`package/open-part-from-link.js`).
