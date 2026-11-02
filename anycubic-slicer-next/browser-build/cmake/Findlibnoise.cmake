# Orca 2.3.1 cmake/modules/Findlibnoise.cmake (Anycubic tree) makes noise::noise without checking it exists;
# the engine and Orca's GUI list both find it. Same file, made once.
if (TARGET noise::noise)
    set(libnoise_FOUND TRUE)
    return()
endif ()
include("${ORCA_SRC}/cmake/modules/Findlibnoise.cmake")
