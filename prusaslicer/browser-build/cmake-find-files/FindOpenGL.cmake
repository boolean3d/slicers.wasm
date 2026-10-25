# WebGL2 through Emscripten (-sUSE_WEBGL2 -sFULL_ES3 at the link): no library to find.
set(OPENGL_FOUND TRUE)
set(OpenGL_FOUND TRUE)
set(OPENGL_LIBRARIES "")
if (NOT TARGET OpenGL::GL)
    add_library(OpenGL::GL INTERFACE IMPORTED GLOBAL)
endif ()
