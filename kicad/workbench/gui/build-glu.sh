# GLU's polygon tessellator for the browser (KiCad's OpenGL GAL and its IDF/VRML exporter call gluTess*; Emscripten ships no GLU).
# Source: Mesa's GLU 9.0.3 (SGI Free Software License B 2.0, a permissive licence), src/libtess + the quadrics,
# projection and error strings of src/libutil (the 3D preview in the footprint properties dialog: gluNewQuadric, gluSphere,
# gluPerspective. Their 11 GL calls are renamed kigl_glu_* (the 3D view's arrows, pivot and preview draw)
# through them): KiCad's OpenGL stand-in (thirdparty/glad/src/gl_es_compat.cpp) defines them; glu-gl-weak.c here keeps
# do-nothing weak ones for a program linked without it. -> /w/prefix-kdeps/lib/libglutess.a
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
D=/w/kdeps; P=/w/prefix-kdeps; mkdir -p $D/dl $D/src; cd $D
[ -f dl/glu-9.0.3.tar.xz ] || curl -fsSL -o dl/glu-9.0.3.tar.xz https://archive.mesa3d.org/glu/glu-9.0.3.tar.xz
[ -d src/glu-9.0.3 ] || tar xf dl/glu-9.0.3.tar.xz -C src
cd src/glu-9.0.3
GLFN="Begin End MultMatrixd MultMatrixf Normal3f Ortho Scalef TexCoord2f Translated Translatef Vertex3f"
R=""; for n in $GLFN; do R="$R -Dgl$n=kigl_glu_$n"; done
F="$R -O2 -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -DNDEBUG -Iinclude -Isrc/include -Isrc/libtess -Isrc/libutil -include limits.h -w"   # priorityq-heap.c uses LONG_MAX without its include
rm -rf tess-obj && mkdir tess-obj
for f in src/libtess/*.c src/libutil/error.c src/libutil/glue.c src/libutil/project.c src/libutil/quad.c src/libutil/registry.c; do emcc $F -c $f -o tess-obj/$(basename $f .c).o; done
emcc $F -c $HERE/glu-gl-weak.c -o tess-obj/glu-gl-weak.o
rm -f $P/lib/libglutess.a; emar rcs $P/lib/libglutess.a tess-obj/*.o
mkdir -p $P/include/GL && cp include/GL/glu.h $P/include/GL/glu.h
echo GLU-OK
