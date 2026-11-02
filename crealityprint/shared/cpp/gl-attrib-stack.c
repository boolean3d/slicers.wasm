// glPushAttrib / glPopAttrib for a browser slicer (WebGL2 = OpenGL ES 3.0, which has no attribute stack).
// Built into each slicer from slicer-wx/cpp (gui/CMakeLists add_executable), in place of the empty stubs that
// gl_compat.c had. Every slicer tree takes it; trees whose ImGui renderer is the fixed-pipeline one need it.
#include <GLES3/gl3.h>

// glPushAttrib / glPopAttrib keep the state groups ES has (enables, colour buffer, depth buffer, scissor, viewport) on a
// small stack, as desktop GL does: renderers written for the fixed pipeline undo their glEnable calls only through
// glPopAttrib (Snapmaker Orca's ImGui renderer enables GL_SCISSOR_TEST under glPushAttrib(GL_ENABLE_BIT); with a no-op
// pop the scissor stayed on with WebGL's first box, 300x150, and the whole 3D view outside that corner was black).
// Groups ES does not have (transform, lighting, texture env, polygon mode) are not kept: nothing in ES reads them.
#define B3D_ATTRIB_DEPTH   0x00000100
#define B3D_ATTRIB_VIEWPORT 0x00000800
#define B3D_ATTRIB_ENABLE  0x00002000
#define B3D_ATTRIB_COLOR   0x00004000
#define B3D_ATTRIB_SCISSOR 0x00080000
static const GLenum b3d_enables[] = { GL_BLEND, GL_CULL_FACE, GL_DEPTH_TEST, GL_DITHER, GL_POLYGON_OFFSET_FILL,
    GL_SAMPLE_ALPHA_TO_COVERAGE, GL_SAMPLE_COVERAGE, GL_SCISSOR_TEST, GL_STENCIL_TEST };
#define B3D_ENABLE_COUNT ((int) (sizeof b3d_enables / sizeof b3d_enables[0]))
typedef struct {
    GLbitfield mask;
    GLboolean enabled[B3D_ENABLE_COUNT];
    GLint blend_src_rgb, blend_dst_rgb, blend_src_alpha, blend_dst_alpha, blend_eq_rgb, blend_eq_alpha;
    GLfloat blend_color[4], clear_color[4];
    GLboolean color_mask[4];
    GLint depth_func; GLboolean depth_mask; GLfloat clear_depth;
    GLint scissor_box[4], viewport[4]; GLfloat depth_range[2];
} b3d_attribs;
static b3d_attribs b3d_attrib_stack[16];
static int b3d_attrib_depth = 0;

static void b3d_set_enabled(GLenum cap, GLboolean on) { if (on) glEnable(cap); else glDisable(cap); }

void glPushAttrib(GLbitfield m)
{
    if (b3d_attrib_depth >= (int) (sizeof b3d_attrib_stack / sizeof b3d_attrib_stack[0]))
        return; // GL_STACK_OVERFLOW on desktop: the push is ignored
    b3d_attribs *a = &b3d_attrib_stack[b3d_attrib_depth++];
    a->mask = m;
    if (m & (B3D_ATTRIB_ENABLE | B3D_ATTRIB_COLOR | B3D_ATTRIB_DEPTH | B3D_ATTRIB_SCISSOR))
        for (int i = 0; i < B3D_ENABLE_COUNT; ++i)
            a->enabled[i] = glIsEnabled(b3d_enables[i]);
    if (m & B3D_ATTRIB_COLOR) {
        glGetIntegerv(GL_BLEND_SRC_RGB, &a->blend_src_rgb);
        glGetIntegerv(GL_BLEND_DST_RGB, &a->blend_dst_rgb);
        glGetIntegerv(GL_BLEND_SRC_ALPHA, &a->blend_src_alpha);
        glGetIntegerv(GL_BLEND_DST_ALPHA, &a->blend_dst_alpha);
        glGetIntegerv(GL_BLEND_EQUATION_RGB, &a->blend_eq_rgb);
        glGetIntegerv(GL_BLEND_EQUATION_ALPHA, &a->blend_eq_alpha);
        glGetFloatv(GL_BLEND_COLOR, a->blend_color);
        glGetFloatv(GL_COLOR_CLEAR_VALUE, a->clear_color);
        glGetBooleanv(GL_COLOR_WRITEMASK, a->color_mask);
    }
    if (m & B3D_ATTRIB_DEPTH) {
        glGetIntegerv(GL_DEPTH_FUNC, &a->depth_func);
        glGetBooleanv(GL_DEPTH_WRITEMASK, &a->depth_mask);
        glGetFloatv(GL_DEPTH_CLEAR_VALUE, &a->clear_depth);
    }
    if (m & B3D_ATTRIB_SCISSOR)
        glGetIntegerv(GL_SCISSOR_BOX, a->scissor_box);
    if (m & B3D_ATTRIB_VIEWPORT) {
        glGetIntegerv(GL_VIEWPORT, a->viewport);
        glGetFloatv(GL_DEPTH_RANGE, a->depth_range);
    }
}

void glPopAttrib(void)
{
    if (b3d_attrib_depth == 0)
        return; // GL_STACK_UNDERFLOW on desktop
    const b3d_attribs *a = &b3d_attrib_stack[--b3d_attrib_depth];
    const GLbitfield m = a->mask;
    for (int i = 0; i < B3D_ENABLE_COUNT; ++i) {
        const GLenum cap = b3d_enables[i];
        const int in_group = (m & B3D_ATTRIB_ENABLE)
            || ((m & B3D_ATTRIB_COLOR) && (cap == GL_BLEND || cap == GL_DITHER))
            || ((m & B3D_ATTRIB_DEPTH) && cap == GL_DEPTH_TEST)
            || ((m & B3D_ATTRIB_SCISSOR) && cap == GL_SCISSOR_TEST);
        if (in_group)
            b3d_set_enabled(cap, a->enabled[i]);
    }
    if (m & B3D_ATTRIB_COLOR) {
        glBlendFuncSeparate(a->blend_src_rgb, a->blend_dst_rgb, a->blend_src_alpha, a->blend_dst_alpha);
        glBlendEquationSeparate(a->blend_eq_rgb, a->blend_eq_alpha);
        glBlendColor(a->blend_color[0], a->blend_color[1], a->blend_color[2], a->blend_color[3]);
        glClearColor(a->clear_color[0], a->clear_color[1], a->clear_color[2], a->clear_color[3]);
        glColorMask(a->color_mask[0], a->color_mask[1], a->color_mask[2], a->color_mask[3]);
    }
    if (m & B3D_ATTRIB_DEPTH) {
        glDepthFunc(a->depth_func);
        glDepthMask(a->depth_mask);
        glClearDepthf(a->clear_depth);
    }
    if (m & B3D_ATTRIB_SCISSOR)
        glScissor(a->scissor_box[0], a->scissor_box[1], a->scissor_box[2], a->scissor_box[3]);
    if (m & B3D_ATTRIB_VIEWPORT) {
        glViewport(a->viewport[0], a->viewport[1], a->viewport[2], a->viewport[3]);
        glDepthRangef(a->depth_range[0], a->depth_range[1]);
    }
}
