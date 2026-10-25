# Which licence covers which file

| Path | Whose | Licence |
|---|---|---|
| `*/browser-build/` (CMake, build scripts, start-up scripts, `stand-ins/`, `stand-in-headers-*/`, `printer-link/`, `presets-bundle/`, `script-door/`, `prusaslicer-source-edits.cmake`) | Boolean3d | AGPL-3.0-or-later (`LICENSE`): built into Bambu Studio / OrcaSlicer / PrusaSlicer |
| `bambu-studio/browser-build/webgl-shaders/`, `orcaslicer/browser-build/webgl-shaders/` | Prusa Research, copied unchanged from PrusaSlicer 2.9.0 `resources/shaders/ES` | AGPL-3.0-or-later |
| `*/browser-build/stand-in-headers-cgal/` | Boolean3d (stand-ins for headers of CGAL and Eigen, no code copied) | AGPL-3.0-or-later |
| `prusaslicer/browser-build/cmake-find-files/` | Boolean3d (CMake find files that point PrusaSlicer's build at the browser builds of wxWidgets, GLEW, OpenGL) | AGPL-3.0-or-later |
| `prusaslicer/shared-js-prusaslicer/` | Boolean3d (the page scripts the PrusaSlicer build still reads in their earlier form) | AGPL-3.0-or-later |
| `bambu-studio/patches/bambu-studio.patch`, `orcaslicer/patches/orcaslicer.patch` | Boolean3d's changes to Bambu Studio and to OrcaSlicer (and to the Bambu images OrcaSlicer carries) | AGPL-3.0 (as the slicers) |
| `*/patches/muon3d-engine.patch` | Boolean3d's change to the Muon3D engine; the Bambu one also adds Expat (`engine/thirdparty/expat`, its own `COPYING`) | AGPL-3.0-only (as the engine); Expat: MIT |
| `*/patches/wxwidgets.patch` | Adam Hilss's wasm port (files under `src/wasm`, `include/wx/wasm`, `build/wasm` marked "Copyright (c) 2022 Adam Hilss, Licence: LGPL v2") and Boolean3d's additions to it and to wxWidgets; `prusaslicer/` carries the same port onto PrusaSlicer's wxWidgets 3.2 fork | Adam Hilss's files: LGPL-2.0 (`LICENSES/LGPL-2.0.txt`); the rest: wxWindows Library Licence 3.1 (`LICENSES/wxWindows-3.1.txt`) |
| `*/wxwidgets-opengl/`, `*/wxwidgets-web/`, `*/wxwidgets-drawing/` | Boolean3d (browser backends for wxWidgets; the same files are also inside the patch) | wxWindows Library Licence 3.1 |
| `*/shared/js/`, `net/`, `cpp/`, `cmake/`, `occt/` | Boolean3d (page fonts, network relay, slicing thread cap, display scaling, the OCCT build script) | AGPL-3.0-or-later (`LICENSE`): built into Bambu Studio / OrcaSlicer / PrusaSlicer |
| `*/shared/net/ca-certificates.crt` | Mozilla's root certificate list as Debian ships it (ca-certificates), unchanged | Mozilla Public License 2.0 (data file, shipped as is) |
| `*/shared/fonts/` | Google: Noto Sans, unchanged (its `README.txt`) | SIL Open Font License 1.1 (`OFL.txt` beside it) |
| `sync-workbench.sh`, `rename-workbench-files.py`, `sync-helper.sh`, `check-public.sh` | Boolean3d | AGPL-3.0-or-later |
| `helper/` (the printer helper) | Expresslane Equity LLC (Boolean3d); facts about the printers' LAN protocol from MIT tools credited in `helper/bambu.mjs` (ha-bambulab, bambulabs_api), no Bambu code | MIT (`helper/LICENSE`) |
| `package/` | Boolean3d | AGPL-3.0-or-later |
| `docker/`, `build.sh`, the .md files | Boolean3d | AGPL-3.0-or-later |

The licences of the libraries a build downloads are listed in `SOURCE.md`. Every one of them may be combined
with AGPL-3.0 code: the GPL and LGPL ones are version 2-or-later or version 3, the rest are permissive.

## Not settled

1. **Adam Hilss's port says "LGPL v2"** with no "or later". The Library GPL 2.0 lets anyone apply the
   ordinary GNU GPL, version 2 or any later version, instead (section 3), which is how it combines with
   AGPL-3.0. Asking the author to confirm "LGPL-2.0-or-later" or the wxWindows licence would remove the doubt.
   **Recommended:** publish as is (section 3 covers it) and ask Adam Hilss to confirm "or later" in an issue on his repository.
2. **Licence of our own wxWidgets additions**: wxWindows Library Licence chosen so the port stays usable by
   any wx program, as wxWidgets itself. AGPL would also be allowed.
   **Recommended:** wxWindows Library Licence.
3. **Our own files: "AGPL-3.0-or-later"** (as PrusaSlicer) rather than "AGPL-3.0-only". Either works with
   Bambu Studio and OrcaSlicer.
   **Recommended:** AGPL-3.0-or-later.
4. **Names and logos**: the AGPL covers code, not trademarks. Settled: the programs keep their own names inside
   (menus, wizard, About, dialogs), Bambu Lab's logos are taken out of the Bambu Studio build and of the Bambu images
   OrcaSlicer carries, OrcaSlicer's and PrusaSlicer's own screens stay as they are; our pages and the loading screen
   name the programs in plain text only, never with a logo, never as official, with the not-endorsed line.
5. **FFmpeg** was first configured as Bambu Studio's desktop build does it (`--enable-nonfree`, which
   marks the binary "nonfree and unredistributable"). The build here leaves that switch out (no non-free
   part was selected, so the decoders are the same) and is GPL-2.0-or-later.
   **Recommended:** nothing to decide; serve only builds made this way.
