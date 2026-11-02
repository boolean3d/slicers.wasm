// The GL loader of the browser build. Creality Print loads every GL function by name with glad (OpenGLManager::init_gl);
// in a tab the names come from the WebGL2 context (emscripten_webgl_get_proc_address). Creality's GUI dropped the
// SLIC3R_OPENGL_ES branches Orca keeps, so it still names desktop-only calls that WebGL2 does not have: glad left those
// pointers null, and the first call trapped ("null function or function signature mismatch", GLCanvas3D::init's
// glClearDepth). Every name WebGL2 lacks gets an entry here, with glad's own PFN type so the signature is checked at
// compile time (wasm traps on a mismatch):
//  * the same call under its ES name (glClearDepth -> glClearDepthf, the APPLE vertex arrays -> core ones), or the
//    same work done with what ES has (glMultiDrawElements -> one glDrawElements per range);
//  * the attribute stack kept for the state groups ES has (slicer-wx/cpp/gl-attrib-stack.c);
//  * the rest (fixed-function drawing, matrices and lights, polygon mode, line stipple, GL 4.x compute and texture
//    buffers behind Creality's version checks) do nothing, and say so once in the console, so a missing piece of the
//    picture is named instead of crashing the tab.
// List: every gl* call in Creality's src/ that GLES3/gl3.h does not declare (7.3.0).
// The other way round too: glad loads a name only for a GL version the context reports, and WebGL2 reports "OpenGL ES
// 3.0", so the ES 3.0 calls desktop GL lists under 3.1-4.3 (fence sync, instancing, uniform blocks, samplers,
// glClearDepthf...) stayed null although WebGL2 has them; b3d_web_gl_es3() fills those after gladLoadGL.
#include <glad/gl.h>
#include <emscripten/html5.h>

#include <cstdio>
#include <cstring>
#include <type_traits>

namespace {

template <typename F, int I> struct Skip;
template <typename R, typename... A, int I> struct Skip<R (GLAD_API_PTR *)(A...), I>
{
    static inline const char *name = nullptr;
    static R GLAD_API_PTR fn(A...)
    {
        static bool told = false;
        if (!told) {
            told = true;
            std::fprintf(stderr, "b3d gl: %s is not in WebGL2; skipped\n", name);
        }
        if constexpr (!std::is_void_v<R>)
            return R{};
    }
};
template <typename F, int I> GLADapiproc skip(const char *name)
{
    Skip<F, I>::name = name;
    return reinterpret_cast<GLADapiproc>(static_cast<F>(&Skip<F, I>::fn));
}

// glClearDepthf is one of the names b3d_web_gl_es3() fills, so it is taken from WebGL2 here, not from glad's pointer.
void GLAD_API_PTR clear_depth(GLdouble d)
{
    static const auto f = reinterpret_cast<PFNGLCLEARDEPTHFPROC>(emscripten_webgl_get_proc_address("glClearDepthf"));
    f(static_cast<GLfloat>(d));
}
void GLAD_API_PTR multi_draw_elements(GLenum mode, const GLsizei *count, GLenum type, const void *const *indices, GLsizei n)
{
    for (GLsizei i = 0; i < n; ++i)
        glDrawElements(mode, count[i], type, indices[i]);
}

// glPushAttrib / glPopAttrib: the slicer lanes' shared attribute stack (slicer-wx/cpp/gl-attrib-stack.c, from
// shared/cpp): Creality's ImGui renderer turns the scissor test on under glPushAttrib and off only through
// glPopAttrib, so a skipped pop left the 3D view clipped to one corner. Its C names are glad's macros here.
extern "C" void push_attrib_es(GLbitfield m) __asm__("glPushAttrib");
extern "C" void pop_attrib_es() __asm__("glPopAttrib");
void GLAD_API_PTR push_attrib(GLbitfield m) { push_attrib_es(m); }
void GLAD_API_PTR pop_attrib() { pop_attrib_es(); }

struct Entry { const char *name; GLADapiproc proc; };
#define B3D_SAME(n, P, f) { #n, reinterpret_cast<GLADapiproc>(static_cast<P>(f)) }
#define B3D_SKIP(n, P) { #n, skip<P, __COUNTER__>(#n) }

const Entry *entries(size_t &size)
{
    static const Entry e[] = {
        B3D_SAME(glClearDepth, PFNGLCLEARDEPTHPROC, &clear_depth),
        B3D_SAME(glMultiDrawElements, PFNGLMULTIDRAWELEMENTSPROC, &multi_draw_elements),
        { "glBindVertexArrayAPPLE", reinterpret_cast<GLADapiproc>(emscripten_webgl_get_proc_address("glBindVertexArray")) },
        { "glGenVertexArraysAPPLE", reinterpret_cast<GLADapiproc>(emscripten_webgl_get_proc_address("glGenVertexArrays")) },
        { "glDeleteVertexArraysAPPLE", reinterpret_cast<GLADapiproc>(emscripten_webgl_get_proc_address("glDeleteVertexArrays")) },
        B3D_SKIP(glBegin, PFNGLBEGINPROC),
        B3D_SKIP(glEnd, PFNGLENDPROC),
        B3D_SKIP(glVertex2f, PFNGLVERTEX2FPROC),
        B3D_SKIP(glVertex3f, PFNGLVERTEX3FPROC),
        B3D_SKIP(glVertex3fv, PFNGLVERTEX3FVPROC),
        B3D_SKIP(glNormal3d, PFNGLNORMAL3DPROC),
        B3D_SKIP(glNormal3f, PFNGLNORMAL3FPROC),
        B3D_SKIP(glNormal3fv, PFNGLNORMAL3FVPROC),
        B3D_SKIP(glTexCoord2f, PFNGLTEXCOORD2FPROC),
        B3D_SKIP(glTexCoord2fv, PFNGLTEXCOORD2FVPROC),
        B3D_SKIP(glColor3f, PFNGLCOLOR3FPROC),
        B3D_SKIP(glColor3fv, PFNGLCOLOR3FVPROC),
        B3D_SKIP(glColor4f, PFNGLCOLOR4FPROC),
        B3D_SKIP(glColor4fv, PFNGLCOLOR4FVPROC),
        B3D_SKIP(glColorMaterial, PFNGLCOLORMATERIALPROC),
        B3D_SKIP(glLightfv, PFNGLLIGHTFVPROC),
        B3D_SKIP(glVertexPointer, PFNGLVERTEXPOINTERPROC),
        B3D_SKIP(glDisableClientState, PFNGLDISABLECLIENTSTATEPROC),
        B3D_SKIP(glEnableClientState, PFNGLENABLECLIENTSTATEPROC),
        B3D_SKIP(glMatrixMode, PFNGLMATRIXMODEPROC),
        B3D_SKIP(glLoadIdentity, PFNGLLOADIDENTITYPROC),
        B3D_SKIP(glPushMatrix, PFNGLPUSHMATRIXPROC),
        B3D_SKIP(glPopMatrix, PFNGLPOPMATRIXPROC),
        B3D_SKIP(glMultMatrixf, PFNGLMULTMATRIXFPROC),
        B3D_SKIP(glOrtho, PFNGLORTHOPROC),
        B3D_SKIP(glRotated, PFNGLROTATEDPROC),
        B3D_SKIP(glRotatef, PFNGLROTATEFPROC),
        B3D_SKIP(glScalef, PFNGLSCALEFPROC),
        B3D_SKIP(glTranslated, PFNGLTRANSLATEDPROC),
        B3D_SKIP(glTranslatef, PFNGLTRANSLATEFPROC),
        B3D_SAME(glPushAttrib, PFNGLPUSHATTRIBPROC, &push_attrib),
        B3D_SAME(glPopAttrib, PFNGLPOPATTRIBPROC, &pop_attrib),
        B3D_SKIP(glPolygonMode, PFNGLPOLYGONMODEPROC),
        B3D_SKIP(glLineStipple, PFNGLLINESTIPPLEPROC),
        B3D_SKIP(glTexEnvi, PFNGLTEXENVIPROC),
        B3D_SKIP(glGetTexEnviv, PFNGLGETTEXENVIVPROC),
        B3D_SKIP(glGetTexImage, PFNGLGETTEXIMAGEPROC),
        B3D_SKIP(glGetBufferSubData, PFNGLGETBUFFERSUBDATAPROC),
        B3D_SKIP(glClearBufferData, PFNGLCLEARBUFFERDATAPROC),
        B3D_SKIP(glTexBuffer, PFNGLTEXBUFFERPROC),
        B3D_SKIP(glDispatchCompute, PFNGLDISPATCHCOMPUTEPROC),
        B3D_SKIP(glMemoryBarrier, PFNGLMEMORYBARRIERPROC),
    };
    size = sizeof(e) / sizeof(e[0]);
    return e;
}

} // namespace

// WebGL2's own function first; a name it lacks from the list above; otherwise null, as glad expects.
extern "C" GLADapiproc b3d_web_gl_proc(const char *name)
{
    if (void *p = emscripten_webgl_get_proc_address(name))
        return reinterpret_cast<GLADapiproc>(p);
    size_t n = 0;
    const Entry *e = entries(n);
    for (size_t i = 0; i < n; ++i)
        if (std::strcmp(e[i].name, name) == 0)
            return e[i].proc;
    return nullptr;
}

// Every GLES3/gl3.h call that desktop GL lists under a version above 3.0 (glad's gl.c, 7.3.0): glad left it null for
// WebGL2's "OpenGL ES 3.0"; WebGL2 has it, so it is taken from the context. Run right after gladLoadGL.
extern "C" void b3d_web_gl_es3()
{
#define B3D_ES3(n) { reinterpret_cast<void **>(&glad_##n), #n }
    static const struct { void **ptr; const char *name; } e[] = {
        B3D_ES3(glBindSampler),
        B3D_ES3(glBindTransformFeedback),
        B3D_ES3(glClearDepthf),
        B3D_ES3(glClientWaitSync),
        B3D_ES3(glCopyBufferSubData),
        B3D_ES3(glDeleteSamplers),
        B3D_ES3(glDeleteSync),
        B3D_ES3(glDeleteTransformFeedbacks),
        B3D_ES3(glDepthRangef),
        B3D_ES3(glDrawArraysInstanced),
        B3D_ES3(glDrawElementsInstanced),
        B3D_ES3(glFenceSync),
        B3D_ES3(glGenSamplers),
        B3D_ES3(glGenTransformFeedbacks),
        B3D_ES3(glGetActiveUniformBlockName),
        B3D_ES3(glGetActiveUniformBlockiv),
        B3D_ES3(glGetActiveUniformsiv),
        B3D_ES3(glGetBufferParameteri64v),
        B3D_ES3(glGetInteger64v),
        B3D_ES3(glGetInternalformativ),
        B3D_ES3(glGetProgramBinary),
        B3D_ES3(glGetSamplerParameterfv),
        B3D_ES3(glGetSamplerParameteriv),
        B3D_ES3(glGetShaderPrecisionFormat),
        B3D_ES3(glGetSynciv),
        B3D_ES3(glGetUniformBlockIndex),
        B3D_ES3(glGetUniformIndices),
        B3D_ES3(glInvalidateFramebuffer),
        B3D_ES3(glInvalidateSubFramebuffer),
        B3D_ES3(glIsSampler),
        B3D_ES3(glIsSync),
        B3D_ES3(glIsTransformFeedback),
        B3D_ES3(glPauseTransformFeedback),
        B3D_ES3(glProgramBinary),
        B3D_ES3(glProgramParameteri),
        B3D_ES3(glReleaseShaderCompiler),
        B3D_ES3(glResumeTransformFeedback),
        B3D_ES3(glSamplerParameterf),
        B3D_ES3(glSamplerParameterfv),
        B3D_ES3(glSamplerParameteri),
        B3D_ES3(glSamplerParameteriv),
        B3D_ES3(glShaderBinary),
        B3D_ES3(glTexStorage2D),
        B3D_ES3(glTexStorage3D),
        B3D_ES3(glUniformBlockBinding),
        B3D_ES3(glVertexAttribDivisor),
        B3D_ES3(glWaitSync),
    };
#undef B3D_ES3
    for (const auto &x : e)
        if (*x.ptr == nullptr)
            *x.ptr = emscripten_webgl_get_proc_address(x.name);
}
