// OpenGL entry points Orca's GUI names that WebGL2 (OpenGL ES 3.0) does not have under those names.
//  * EXT_framebuffer_object / _blit / _multisample: the same calls are core in ES 3.0, so the EXT names
//    forward to them (Orca picks EXT when GLEW reports the extension; Emscripten's GLEW may).
//  * Fixed-function calls left outside Orca's SLIC3R_OPENGL_ES guards (SkipPartCanvas, the printer's
//    skip-objects view; GLTexture's glTexEnvi; PartPlate's glColor4fv) have nothing to call in ES: they
//    do nothing, so those few things are not drawn.
#include <GLES3/gl3.h>
#include <GLFW/glfw3.h>

void glBindFramebufferEXT(GLenum t, GLuint f) { glBindFramebuffer(t, f); }
void glGenFramebuffersEXT(GLsizei n, GLuint *f) { glGenFramebuffers(n, f); }
void glDeleteFramebuffersEXT(GLsizei n, const GLuint *f) { glDeleteFramebuffers(n, f); }
GLenum glCheckFramebufferStatusEXT(GLenum t) { return glCheckFramebufferStatus(t); }
void glFramebufferTexture2DEXT(GLenum t, GLenum a, GLenum tt, GLuint tex, GLint l) { glFramebufferTexture2D(t, a, tt, tex, l); }
void glFramebufferRenderbufferEXT(GLenum t, GLenum a, GLenum rt, GLuint rb) { glFramebufferRenderbuffer(t, a, rt, rb); }
void glGenRenderbuffersEXT(GLsizei n, GLuint *r) { glGenRenderbuffers(n, r); }
void glDeleteRenderbuffersEXT(GLsizei n, const GLuint *r) { glDeleteRenderbuffers(n, r); }
void glBindRenderbufferEXT(GLenum t, GLuint r) { glBindRenderbuffer(t, r); }
void glRenderbufferStorageEXT(GLenum t, GLenum f, GLsizei w, GLsizei h) { glRenderbufferStorage(t, f, w, h); }
void glRenderbufferStorageMultisampleEXT(GLenum t, GLsizei s, GLenum f, GLsizei w, GLsizei h) { glRenderbufferStorageMultisample(t, s, f, w, h); }
void glBlitFramebufferEXT(GLint a, GLint b, GLint c, GLint d, GLint e, GLint f, GLint g, GLint h, GLbitfield m, GLenum fl) { glBlitFramebuffer(a, b, c, d, e, f, g, h, m, fl); }

void glBegin(GLenum m) { (void) m; }
void glEnd(void) {}
void glVertex2f(GLfloat x, GLfloat y) { (void) x; (void) y; }
void glColor3f(GLfloat r, GLfloat g, GLfloat b) { (void) r; (void) g; (void) b; }
void glColor4fv(const GLfloat *c) { (void) c; }
void glOrtho(double l, double r, double b, double t, double n, double f) { (void) l; (void) r; (void) b; (void) t; (void) n; (void) f; }
void glPushAttrib(GLbitfield m) { (void) m; }
void glPopAttrib(void) {}
void glLineStipple(GLint f, GLushort p) { (void) f; (void) p; }
void glPolygonMode(GLenum f, GLenum m) { (void) f; (void) m; }
void glTexEnvi(GLenum t, GLenum p, GLint v) { (void) t; (void) p; (void) v; }

// Emscripten's GLFW 3 has no glfwGetError; its errors go to the error callback.
int glfwGetError(const char **description) { if (description) *description = 0; return GLFW_NO_ERROR; }
