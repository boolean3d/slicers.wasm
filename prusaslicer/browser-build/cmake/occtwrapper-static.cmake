# slicer-prusa-12: runs right after project(OCCTWrapper) in PrusaSlicer's src/occt_wrapper/CMakeLists.txt (CMAKE_PROJECT_
# OCCTWrapper_INCLUDE, set in ../CMakeLists.txt). That file makes the wrapper STATIC on APPLE and a dlopen'd MODULE
# elsewhere; a browser tab loads no shared libraries, so the browser build takes the macOS branch. APPLE is set in this
# directory's scope only (the file has no other APPLE branch; neither OpenCASCADEConfig nor GenerateExportHeader reads it).
set(APPLE ON)
