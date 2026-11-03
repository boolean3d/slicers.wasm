# The browser build's edits to the KiCad 10.0.7 tree (applied once to the clone, committed there; spike/patches/kicad-wasm.patch = git diff).
import re, pathlib, sys
root = pathlib.Path(sys.argv[1])
def edit(rel, old, new, count=1):
    p = root / rel; s = p.read_text()
    if new in s: print("ok   ", rel); return
    assert old in s, (rel, old[:60]); s = s.replace(old, new, count); p.write_text(s); print("edit ", rel)
# 1. find modules of the browser build first in line
edit("CMakeLists.txt", 'set( CMAKE_MODULE_PATH       "${KICAD_CMAKE_MODULE_PATH}" )',
     'set( CMAKE_MODULE_PATH       ${KICAD_WASM_MODULE_PATH} "${KICAD_CMAKE_MODULE_PATH}" )   # browser build: its find modules first')
# 2. the wx port is given, not detected
edit("CMakeLists.txt", 'if( wxWidgets_FIND_STYLE STREQUAL "win32" )\n    string(REGEX MATCH "(msw|qt|gtk)" KICAD_WX_PORT "${WX_CONFIGURATION}")',
     'if( KICAD_WX_PORT )\n    # given (browser build: wasm)\nelseif( wxWidgets_FIND_STYLE STREQUAL "win32" )\n    string(REGEX MATCH "(msw|qt|gtk)" KICAD_WX_PORT "${WX_CONFIGURATION}")')
# 3. one static program: the libraries KiCad builds shared become static when KICAD_SHARED_LIB_TYPE says so
edit("CMakeLists.txt", 'set( KICAD_CMAKE_MODULE_PATH "${PROJECT_SOURCE_DIR}/cmake" )',
     'set( KICAD_CMAKE_MODULE_PATH "${PROJECT_SOURCE_DIR}/cmake" )\nif( NOT KICAD_SHARED_LIB_TYPE )\n    set( KICAD_SHARED_LIB_TYPE SHARED )\nendif()')
edit("common/CMakeLists.txt", 'add_library( kicommon SHARED', 'add_library( kicommon ${KICAD_SHARED_LIB_TYPE}')
edit("common/gal/CMakeLists.txt", 'add_library( gal SHARED ${GAL_SRCS} )', 'add_library( gal ${KICAD_SHARED_LIB_TYPE} ${GAL_SRCS} )')
edit("api/CMakeLists.txt", 'add_library( kiapi SHARED', 'add_library( kiapi ${KICAD_SHARED_LIB_TYPE}')
# 4. the platform layer for the wasm port
edit("libs/kiplatform/CMakeLists.txt", 'elseif( KICAD_WX_PORT STREQUAL gtk )\n    set( PLATFORM_SRCS',
     'elseif( KICAD_WX_PORT STREQUAL wasm )\n    set( PLATFORM_SRCS\n        ${KICAD_WASM_PLATFORM_DIR}/ui.cpp\n        ${KICAD_WASM_PLATFORM_DIR}/webview.cpp\n        )\nelseif( KICAD_WX_PORT STREQUAL gtk )\n    set( PLATFORM_SRCS')
edit("libs/kiplatform/CMakeLists.txt", 'elseif( UNIX )\n    list( APPEND PLATFORM_SRCS\n        os/unix/app.cpp',
     'elseif( KICAD_WX_PORT STREQUAL wasm )\n    list( APPEND PLATFORM_SRCS\n        ${KICAD_WASM_PLATFORM_DIR}/app.cpp\n        os/unix/drivers.cpp\n        ${KICAD_WASM_PLATFORM_DIR}/environment.cpp\n        os/unix/io.cpp\n        os/unix/policy.cpp\n        ${KICAD_WASM_PLATFORM_DIR}/secrets.cpp\n        os/unix/sysinfo.cpp\n        ${KICAD_WASM_PLATFORM_DIR}/printing.cpp\n        )\nelseif( UNIX )\n    list( APPEND PLATFORM_SRCS\n        os/unix/app.cpp')
print("TREE-PATCH-OK")
