# found once (the GUI CMakeLists) and asked again by Snapmaker's src/slic3r/CMakeLists
if (TARGET noise::noise)
    set(libnoise_FOUND TRUE)
    return ()
endif ()
include("${ORCA_SRC}/cmake/modules/Findlibnoise.cmake")
