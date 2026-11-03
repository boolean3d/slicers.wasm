# The programs in the tab and their browser link; included at the end of KiCad's top-level configure (after-project.cmake).
# --- the program in the tab ------------------------------------------------------------------------------------------
# KiCad's editors are plug-in libraries (*.kiface) that the project manager loads into its own process through KIWAY.
# A wasm program cannot load code that way, so the editors are linked into the project manager program (tree-patch13:
# KIWAY::KiFACE takes each editor's getter from a table, then starts it as a loaded face; the editors are not stand-alone,
# so Update PCB from Schematic, the footprint chooser and cross-probing work as on the desktop). On the desktop each kiface
# library keeps its own names; linked together, the names both editors define are given per editor here: the face getter
# (KIFACE_1) and Kiface(), and the 19 classes + 1 function + 2 globals both define with different bodies (found by comparing the
# defined symbols of the two editors' objects, research/kicad-gerbers/combined/scan.sh + dupclass.sh). The schematic
# editor's copies take a KISCH_ prefix; the board editor keeps the stock names.
set(_sch_renames Kiface=Kiface_sch KIFACE_1=KIFACE_1_sch)
foreach (n DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE DIALOG_SHAPE_PROPERTIES
        DIALOG_SHAPE_PROPERTIES_BASE DIALOG_TABLECELL_PROPERTIES DIALOG_TABLECELL_PROPERTIES_BASE DIALOG_TABLE_PROPERTIES
        DIALOG_TABLE_PROPERTIES_BASE DIALOG_TEXT_PROPERTIES DIALOG_TEXT_PROPERTIES_BASE FILEDLG_HOOK_SAVE_PROJECT
        FOOTPRINT_INFO_GENERATOR GROUP_SEARCH_HANDLER PANEL_SETUP_FORMATTING PANEL_SETUP_FORMATTING_BASE
        RECTANGLE_POINT_EDIT_BEHAVIOR TEXTBOX_POINT_EDIT_BEHAVIOR TEXT_SEARCH_HANDLER checkOverwriteDb
        g_excludedLayers allowedActions)
    list(APPEND _sch_renames "${n}=KISCH_${n}")
endforeach ()
set(_pcb_renames Kiface=Kiface_pcb KIFACE_1=KIFACE_1_pcb)
# KiCad 10 carries two netlist readers with the same class names: common/netlist_reader (in the common library: CvPcb's)
# and pcbnew/netlist_reader (pcb_netlist.h, in pcbcommon: the board editor's); on the desktop each kiface links one.
# The board editor's copies take a KIPCB_ prefix.
foreach (n CMP_READER COMPONENT COMPONENT_NET COMPONENT_VARIANT KICAD_NETLIST_PARSER KICAD_NETLIST_READER
        LEGACY_NETLIST_READER NETLIST NETLIST_GROUP NETLIST_READER)
    list(APPEND _pcb_renames "${n}=KIPCB_${n}")
endforeach ()
# the code only one editor links (its object library and the libraries no other part of the program uses)
target_compile_definitions(eeschema_kiface_objects PRIVATE ${_sch_renames})
target_compile_definitions(eeschema_navlib PRIVATE ${_sch_renames})
target_compile_definitions(pcbnew_kiface_objects PRIVATE ${_pcb_renames})
foreach (l 3d-viewer 3d-viewer_spacenav connectivity pcbcommon pnsrouter idf3 kicad_3dsg pcad2kicadpcb allegro2pcbnew
        altium2pcbnew cadstar2pcbnew easyeda easyedapro fabmaster ipc2581 odbpp pads2pcbnew allegro_convert)
    target_compile_definitions(${l} PRIVATE ${_pcb_renames})
endforeach ()
# each editor's face (eeschema.cpp, pcbnew.cpp: the kiface library's own file on the desktop) with its editor's settings
function(kicad_wasm_face name kiface_dir kiface_main objects renames)
    add_library(${name} OBJECT "${KICAD_SRC}/${kiface_dir}/${kiface_main}")
    target_compile_definitions(${name} PRIVATE ${renames} $<TARGET_PROPERTY:${objects},COMPILE_DEFINITIONS>)
    target_include_directories(${name} PRIVATE "${KICAD_SRC}/${kiface_dir}" $<TARGET_PROPERTY:${objects},INCLUDE_DIRECTORIES>)
    target_compile_options(${name} PRIVATE $<TARGET_PROPERTY:${objects},COMPILE_OPTIONS>)
    add_dependencies(${name} ${objects})   # generated headers (lexers) come from the editor's object library
    target_sources(kicad PRIVATE $<TARGET_OBJECTS:${name}>)
endfunction()
kicad_wasm_face(eeschema_face eeschema eeschema.cpp eeschema_kiface_objects "${_sch_renames}")
kicad_wasm_face(pcbnew_face pcbnew pcbnew.cpp pcbnew_kiface_objects "${_pcb_renames}")
get_target_property(_l eeschema_kiface LINK_LIBRARIES)
# ngspice is loaded at run time (sim/ngspice.cpp, wxDynamicLibrary); the configure-time stand-in is an empty file, not a library
list(REMOVE_ITEM _l "${NGSPICE_LIBRARY}" PRIVATE)
target_link_libraries(kicad ${_l})
get_target_property(_l pcbnew_kiface LINK_LIBRARIES)
list(REMOVE_ITEM _l PRIVATE)
target_link_libraries(kicad ${_l})
# The 3D view's model loaders (plugins/3d/vrml: .wrl, plugins/3d/oce: STEP) are plug-in libraries on the desktop. Here
# they are compiled again into the program with their exported names prefixed (KICAD_PLUGIN_BUILTIN, see
# include/plugins/kicad_plugin.h); plugins/ldr finds them in its table of built-in plugins. Object libraries, so every
# object is linked (the table's references are weak and would not pull archive members).
foreach (p vrml oce)
    get_target_property(_src s3d_plugin_${p} SOURCES)
    get_target_property(_dir s3d_plugin_${p} SOURCE_DIR)
    list(TRANSFORM _src PREPEND "${_dir}/")
    add_library(s3d_builtin_${p} OBJECT ${_src})
    target_compile_definitions(s3d_builtin_${p} PRIVATE "KICAD_PLUGIN_BUILTIN=${p}_" ${_pcb_renames}
        $<TARGET_PROPERTY:s3d_plugin_${p},COMPILE_DEFINITIONS>)
    target_include_directories(s3d_builtin_${p} PRIVATE $<TARGET_PROPERTY:s3d_plugin_${p},INCLUDE_DIRECTORIES>)
    target_compile_options(s3d_builtin_${p} PRIVATE $<TARGET_PROPERTY:s3d_plugin_${p},COMPILE_OPTIONS>)
    get_target_property(_ll s3d_plugin_${p} LINK_LIBRARIES)   # their usage requirements (include dirs, definitions)
    target_link_libraries(s3d_builtin_${p} PRIVATE ${_ll})
    target_sources(kicad PRIVATE $<TARGET_OBJECTS:s3d_builtin_${p}>)
endforeach ()
target_link_libraries(kicad kicad_3dsg)

# --- the browser link -------------------------------------------------------------------------------------------------
# Laid out in the tab as on Linux: /kicad/bin/<program>, data at /kicad/share/kicad (kicad-pre.js). Preloaded: KiCad's
# demo projects (the finish line opens one), its templates, the fonts and fontconfig's configuration, Python's library.
set(_preload "")
foreach (d ecc83 pic_programmer kit-dev-coldfire-xilinx_5213 complex_hierarchy)
    list(APPEND _preload "SHELL:--preload-file ${KICAD_SRC}/demos/${d}@/kicad/share/kicad/demos/${d}")
endforeach ()
list(APPEND _preload "SHELL:--preload-file ${KICAD_SRC}/resources/project_template/kicad.kicad_pro@/kicad/share/kicad/template/kicad.kicad_pro")
# KiCad's JSON schemas (installed together under share/kicad/schemas: the API's, the plugin manager's, the remote providers')
foreach (d api/schemas kicad/pcm/schemas resources/schemas)
    list(APPEND _preload "SHELL:--preload-file ${KICAD_SRC}/${d}@/kicad/share/kicad/schemas")
endforeach ()
# KiCad's icons: one archive made by its bitmap_archive_build target (resources/bitmaps_png), read at start
list(APPEND _preload "SHELL:--preload-file ${CMAKE_BINARY_DIR}/resources/images.tar.gz@/kicad/share/kicad/resources/images.tar.gz")
list(APPEND _preload "SHELL:--preload-file ${SPIKE_GUI}/../slicer-wx/fonts@/usr/share/fonts/noto")
list(APPEND _preload "SHELL:--preload-file ${KDEPS}/etc/fonts@/etc/fonts")
list(APPEND _preload "SHELL:--preload-file /w/prefix-py/lib/python3.12@/kicad/lib/python3.12")
# The 3D models the four demo boards use (kicad-packages3D 10.0.0, CC BY-SA 4.0 with exception; spike/models3d-list.txt)
list(APPEND _preload "SHELL:--preload-file /w/models3d@/kicad/share/kicad/3dmodels")
list(APPEND _preload "SHELL:--preload-file ${SPIKE_GUI}/ca-certificates.crt@/w/ow/prefix-mt/ssl/cert.pem")

foreach (t kicad)
    if (t STREQUAL kicad)
        set(_dir kicad)
    else ()
        string(REPLACE "_wasm" "" _dir "${t}")
    endif ()
    set_target_properties(${t} PROPERTIES OUTPUT_NAME "index" SUFFIX ".html" RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/web/${_dir}")
    add_dependencies(${t} bitmap_archive_build)
    set_property(TARGET ${t} APPEND PROPERTY LINK_DEPENDS "${CMAKE_BINARY_DIR}/resources/images.tar.gz")
    target_sources(${t} PRIVATE "${SPIKE_GUI}/stubs/gl_compat.c" "${SPIKE_GUI}/stubs/web_console_log.cpp"
        "${SPIKE_GUI}/stubs/web_debug.cpp" "${SPIKE_GUI}/stubs/pthread_name.c" "${SPIKE_GUI}/stubs/nanosvg_c.c")
    target_compile_definitions(${t} PRIVATE "KICAD_WASM_PROGRAM=\"${_dir}\"")
    # Python's static modules link their own helper libraries after libpython (CPython's Makefile does the same for its binary)
    # ... plus Python's bundled expat (PyExpat_-prefixed), wx's regex (PCRE2, 32-bit units), Boost.Log (a dependency of a library KiCad links), GLU's tessellator (build-glu.sh)
    set(_extra /w/prefix-py/lib/libmpdec.a /w/prefix-py/lib/libHacl_Hash_SHA2.a /w/prefix-py/lib/libpyexpat.a
        ${KDEPS}/lib/libpcre2-32.a /w/ow/prefix-mt/lib/libboost_log.a /w/ow/prefix-mt/lib/libboost_filesystem.a ${KDEPS}/lib/libglutess.a
        # OCCT toolkits KiCad's own list leaves out but TKXCAF's XCAFPrs_Driver needs (TPrsStd lives in TKVCAF)
        /w/prefix-occt/lib/libTKVCAF.a /w/prefix-occt/lib/libTKV3d.a /w/prefix-occt/lib/libTKService.a)
    if (t STREQUAL kicad)   # the stock target links with the plain signature; ours with the keyword one (CMake allows no mix)
        target_link_libraries(${t} ${_extra})
    else ()
        target_link_libraries(${t} PRIVATE ${_extra})
    endif ()
    # KiCad's C flags carry -fexceptions (JS exceptions), which emcc refuses next to wasm longjmp: the C stubs take the wasm model
    set_source_files_properties("${SPIKE_GUI}/stubs/gl_compat.c" "${SPIKE_GUI}/stubs/pthread_name.c" "${SPIKE_GUI}/stubs/nanosvg_c.c" TARGET_DIRECTORY ${t} PROPERTIES COMPILE_OPTIONS "-fwasm-exceptions")
    target_link_options(${t} PRIVATE
        # main() runs in a worker (PROXY_TO_PTHREAD): the page thread only composites, forwards input and answers the
        # program's proxied page calls (slicer-wx/js/wxpage.js, wxpage-web.js; page-extras.js is the page's own pre-js).
        -sJSPI -sPROXY_TO_PTHREAD -sOFFSCREENCANVAS_SUPPORT "-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=$GL"
        -sUSE_ZLIB=1 -sUSE_BZIP2=1 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sINITIAL_MEMORY=512MB -sSTACK_SIZE=16MB -sMALLOC=mimalloc
        "-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency,8)+48" -sPTHREAD_POOL_SIZE_STRICT=0 -sDEFAULT_PTHREAD_STACK_SIZE=8MB
        --emit-symbol-map -Wl,--error-limit=0 -Wl,--wrap=__cxa_throw
        # EM_ASM from a coroutine thread runs on the main thread (stubs/libcontext_threads.cpp)
        -Wl,--wrap=emscripten_asm_const_int -Wl,--wrap=emscripten_asm_const_double -Wl,--wrap=emscripten_asm_const_ptr
        -sUSE_WEBGL2=1 -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2 -sFULL_ES3=1
        -sEXPORTED_RUNTIME_METHODS=HEAP8,HEAPU8,HEAP32,HEAPF32,HEAPF64,FS,stringToNewUTF8 -sFORCE_FILESYSTEM=1
        # first links: list what is missing instead of stopping (the GL and dynamic-loading calls a tab has no home for)
        -sERROR_ON_UNDEFINED_SYMBOLS=0 -sWARN_ON_UNDEFINED_SYMBOLS=1
        "SHELL:--js-library ${SPIKE_GUI}/../slicer-wx/js/wxpage.js" "SHELL:--js-library ${SPIKE_GUI}/../slicer-wx/js/wxpage-web.js"
        # the program sees min(cores, 8) cores (the slicers' fix, slicer-wx/js/tab-cores.js): KiCad's thread pool is sized
        # by hardware_concurrency; at 80 cores its library loaders filled the tab's 4 GB (bad_alloc opening an editor)
        "SHELL:--js-library ${SPIKE_GUI}/../slicer-wx/js/tab-cores.js"
        "SHELL:--pre-js ${SPIKE_GUI}/../slicer-wx/js/page-extras.js" "SHELL:--pre-js ${WX_SRC}/build/wasm/wx.js"
        "SHELL:--pre-js ${SPIKE_GUI}/../wxgc/js/wxgc.js" "SHELL:--pre-js ${SPIKE_GUI}/kicad-pre.js"
        "SHELL:--pre-js ${SPIKE_GUI}/../net/net-worker.js" "SHELL:--pre-js ${SPIKE_GUI}/../wxjs/gl-no-context.js"
        "SHELL:--pre-js ${SPIKE_GUI}/../wxjs/pthread-spares.js"
        "-sEXPORTED_FUNCTIONS=_main,_malloc,_free"
        "SHELL:--shell-file ${WX_SRC}/build/wasm/template.html" ${_preload})
    set_property(TARGET ${t} APPEND PROPERTY LINK_DEPENDS "${WX_SRC}/build/wasm/wx.js" "${SPIKE_GUI}/../wxgc/js/wxgc.js"
        "${SPIKE_GUI}/kicad-pre.js" "${SPIKE_GUI}/../net/net-worker.js" "${SPIKE_GUI}/../wxjs/gl-no-context.js"
        "${SPIKE_GUI}/../wxjs/pthread-spares.js" "${SPIKE_GUI}/../slicer-wx/js/wxpage.js"
        "${SPIKE_GUI}/../slicer-wx/js/wxpage-web.js" "${SPIKE_GUI}/../slicer-wx/js/page-extras.js" "${SPIKE_GUI}/../slicer-wx/js/tab-cores.js"
        "${WX_SRC}/build/wasm/template.html")
endforeach ()
