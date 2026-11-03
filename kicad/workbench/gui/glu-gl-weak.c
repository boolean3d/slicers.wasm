/* GLU's GL calls, renamed kigl_glu_* by build-glu.sh. KiCad's OpenGL stand-in (gl_es_compat.cpp, in glad) has the real
 * ones; these weak do-nothing ones only keep a program linked without it whole. */
#include <GL/gl.h>
#define W __attribute__((weak))
W void glBegin(GLenum m) { (void) m; }
W void glEnd(void) {}
W void glMultMatrixd(const GLdouble *m) { (void) m; }
W void glMultMatrixf(const GLfloat *m) { (void) m; }
W void glNormal3f(GLfloat x, GLfloat y, GLfloat z) { (void) x; (void) y; (void) z; }
W void glOrtho(GLdouble l, GLdouble r, GLdouble b, GLdouble t, GLdouble n, GLdouble f) { (void) l; (void) r; (void) b; (void) t; (void) n; (void) f; }
W void glScalef(GLfloat x, GLfloat y, GLfloat z) { (void) x; (void) y; (void) z; }
W void glTexCoord2f(GLfloat s, GLfloat t) { (void) s; (void) t; }
W void glTranslated(GLdouble x, GLdouble y, GLdouble z) { (void) x; (void) y; (void) z; }
W void glTranslatef(GLfloat x, GLfloat y, GLfloat z) { (void) x; (void) y; (void) z; }
W void glVertex3f(GLfloat x, GLfloat y, GLfloat z) { (void) x; (void) y; (void) z; }
