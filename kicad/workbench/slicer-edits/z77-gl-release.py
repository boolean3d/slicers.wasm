# A destroyed wxGLContext gives its WebGL context back to the browser now (z77, kicad-gerbers 10-28). Emscripten's
# emscripten_webgl_destroy_context (libwebgl.js GL.deleteContext) only drops its own table entry: the browser keeps the
# context alive until garbage collection, and Chrome keeps at most 16 live WebGL contexts, then loses the oldest one.
# KiCad's symbol chooser makes two GL canvases (symbol + footprint preview) every time it opens, so after a few opens the
# oldest live context, the schematic editor's own canvas, was lost ("The browser lost the WebGL context", recovered).
# Desktop frees a GL context when it is destroyed; WEBGL_lose_context.loseContext() is the browser's way to do that.
# Only lines are added. Companion of kicad-gl-font.diff (that one is the "bitmap font sampler" fix).
import sys
p = 'src/wasm/glcanvas.cpp'
s = open(p).read()
if '(z77)' in s:
    sys.exit(0)

def sub(a, b):
    global s
    if s.count(a) != 1:
        print('z77: anchor not found once in', p, ':', a[:60].strip(), ', skipped'); sys.exit(0)
    s = s.replace(a, b, 1)

a = 'EM_JS(void, wxglDrop, (int id), { wxGlDrop(id); });\n'
sub(a, a + '''// (z77) give the context back to the browser: it keeps a deleted one alive until GC and loses the oldest past its cap
EM_JS(void, wxglLose, (int handle), {
    try {
        var c = GL.getContext(handle);
        var lose = c && c.GLctx && c.GLctx.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
    } catch (e) {}
});
''')

a = '''    if (m_handle > 0)
        emscripten_webgl_destroy_context(m_handle);
'''
sub(a, '''    if (m_handle > 0)
        wxglLose(m_handle);   // (z77)
''' + a)

open(p, 'w').write(s)
print('z77: applied to', p)
