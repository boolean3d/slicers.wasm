// Creality Print loads OpenGL through glad (src/glad). In the tab, wx's GL canvas header (wx/wasm/glcanvas.h)
// brings in the browser's GLES3/gl3.h; after glad that header would declare glClear & co. a second time under
// glad's names (glad #defines glClear glad_glClear). glad's own header already declares every function and constant
// the program uses, so once glad is in, GLES3/gl3.h counts as included (its guard), as glad does for GL/gl.h.
// Searched before src/glad/include, for the GUI library and the program only.
#pragma once
#include_next <glad/gl.h>
#ifdef __EMSCRIPTEN__
#ifndef __gles2_gl3_h_
#define __gles2_gl3_h_ 1
#endif
#endif
