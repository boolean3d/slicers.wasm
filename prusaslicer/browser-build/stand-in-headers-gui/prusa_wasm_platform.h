// Force-included in PrusaSlicer's GUI sources (C++): what the desktop toolchains supply and Emscripten's does not.
#pragma once
// GLEW on the desktop includes GLU; Emscripten's GL/glew.h does not. GLEW first, as on the desktop: GL/glu.h pulls
// GL/gl.h, and a GL/gl.h seen before GLEW hides GLEW's entry points.
#include <GL/glew.h>
#include <GL/glu.h>
#include <wx/display.h> // BitmapCache.cpp: wxDisplay scale factors (the non-Linux branch; GTK headers bring it on the desktop)
#include <wx/crt.h>     // Secrets.cpp: wxPrintf / wxPuts (GTK headers bring it on the desktop)
