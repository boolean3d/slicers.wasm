// glcmn.cpp's wxGLAPI and SetColour forward to fixed-function GL, which WebGL2 lacks;
// declare it so the file compiles (Orca and the spike never call these)
#include <GLES3/gl3.h>
#define GL_RGBA_MODE 0x0C31
extern "C" {
void glBegin(GLenum); void glEnd(void); void glTexCoord2f(GLfloat, GLfloat);
void glVertex3f(GLfloat, GLfloat, GLfloat); void glNormal3f(GLfloat, GLfloat, GLfloat);
void glColor4f(GLfloat, GLfloat, GLfloat, GLfloat); void glColor3f(GLfloat, GLfloat, GLfloat);
void glIndexi(GLint); void glFrustum(double, double, double, double, double, double);
}
