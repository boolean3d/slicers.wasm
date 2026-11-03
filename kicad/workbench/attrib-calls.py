#!/usr/bin/env python3
# attrib-calls.py <kicad tree>: KiCad's own vertex-attribute calls (glVertexAttribPointer,
# glEnable/DisableVertexAttribArray: the 2D drawing's shader-parameter attribute) go through the GL stand-in. On an
# attribute the built-in program also uses (0-3) they are the same GL state as the client arrays, so they are recorded
# with them, go back after the stand-in's own draws, and the state cache sees them. k16-k18 let them pass straight to
# WebGL: the pointer cache then skipped a real change, a draw read the wrong buffer and the 2D drawing fell back to
# software ("switching framebuffer: invalid operation"; bisect glcache=2). Rerun-safe.
import sys, pathlib
root = pathlib.Path(sys.argv[1]); MARK = 'kicad-play-11 attrib-calls'
p = root / 'thirdparty/glad/src/gl_es_compat.cpp'; s = p.read_text()
if MARK in s:
    print('already'); sys.exit(0)
def rep(a, b):
    global s
    assert s.count(a) == 1, (a[:60], s.count(a)); s = s.replace(a, b)
rep('''void kg_ClientActiveTexture( GLenum ) {}   // one texture coordinate array (unit 0)
''', '''void kg_ClientActiveTexture( GLenum ) {}   // one texture coordinate array (unit 0)

// KiCad's own attribute calls (''' + MARK + '''): on attributes 0-3 the same GL state as the client arrays, recorded
// with them so they go back after our own draws and the cache knows them; the others pass straight through.
void kg_VertexAttribPointer( GLuint a, GLint size, GLenum type, GLboolean norm, GLsizei stride, const void* p )
{
    if( a < N_ARRAYS )
        setArray( a, size, type, norm, stride, p );
    else
        glVertexAttribPointer( a, size, type, norm, stride, p );
}

void kg_EnableVertexAttribArray( GLuint a )
{
    if( a < N_ARRAYS )
    {
        S().arrayOn[a] = true;
        attribEnable( a, true );
    }
    else
        glEnableVertexAttribArray( a );
}

void kg_DisableVertexAttribArray( GLuint a )
{
    if( a < N_ARRAYS )
    {
        S().arrayOn[a] = false;
        attribEnable( a, false );
    }
    else
        glDisableVertexAttribArray( a );
}
''')
rep('''    E( BindBuffer ), E( DrawArrays ), E( DrawElements ), E( DeleteBuffers ), E( NormalPointer ), E( ClientActiveTexture ),
''', '''    E( BindBuffer ), E( DrawArrays ), E( DrawElements ), E( DeleteBuffers ), E( NormalPointer ), E( ClientActiveTexture ),
    E( VertexAttribPointer ), E( EnableVertexAttribArray ), E( DisableVertexAttribArray ),
''')
p.write_text(s); print('patched')
