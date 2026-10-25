# Emscripten ships GL/glew.h and implements glewInit in its own GL library: nothing to link.
set(GLEW_FOUND TRUE)
if (NOT TARGET GLEW::GLEW)
    add_library(GLEW::GLEW INTERFACE IMPORTED GLOBAL)
endif ()
