# The wasm wx port's prefix (browser-build/build-wxwidgets.sh). wx-config gives the compile flags; the libraries are listed here,
# because the port's GL canvas and web view libraries are built outside wx's configure (wx-config does not know them).
set(_wxl "${WX_PREFIX}/lib")
execute_process(COMMAND "${WX_PREFIX}/bin/wx-config" --cxxflags OUTPUT_VARIABLE _wxcf OUTPUT_STRIP_TRAILING_WHITESPACE)
separate_arguments(_wxcf UNIX_COMMAND "${_wxcf}")
set(wxWidgets_INCLUDE_DIRS "")
set(wxWidgets_DEFINITIONS "")
set(wxWidgets_CXX_FLAGS "")
foreach (f IN LISTS _wxcf)
    if (f MATCHES "^-I(.*)")
        list(APPEND wxWidgets_INCLUDE_DIRS "${CMAKE_MATCH_1}")
    elseif (f MATCHES "^-D(.*)")
        list(APPEND wxWidgets_DEFINITIONS "${CMAKE_MATCH_1}")
    else ()
        list(APPEND wxWidgets_CXX_FLAGS "${f}")
    endif ()
endforeach ()
set(wxWidgets_LIBRARIES
    "${_wxl}/libwx_wasmunivu_webview-3.2-emscripten.a" "${_wxl}/libwx_baseu_webrequest-3.2-emscripten.a")
foreach (c gl html aui adv propgrid richtext core)
    if (EXISTS "${_wxl}/libwx_wasmunivu_${c}-3.2-emscripten.a")
        list(APPEND wxWidgets_LIBRARIES "${_wxl}/libwx_wasmunivu_${c}-3.2-emscripten.a")
    endif ()
endforeach ()
list(APPEND wxWidgets_LIBRARIES "${_wxl}/libwx_baseu_net-3.2-emscripten.a" "${_wxl}/libwx_baseu_xml-3.2-emscripten.a"
    "${_wxl}/libwx_baseu-3.2-emscripten.a" "${_wxl}/libwxpng-3.2-emscripten.a" "/w/ow/prefix-mt/lib/libjpeg.a"
    "/w/ow/prefix-mt/lib/libexpat.a")
set(wxWidgets_FOUND TRUE)
set(wxWidgets_USE_FILE "${CMAKE_CURRENT_LIST_DIR}/UsewxWidgets.cmake")
