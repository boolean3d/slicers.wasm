# A wxGLContext whose WebGL2 context the browser refuses (graphics blocked, memory, a lost GPU process) put up a wx error
# box "WebGL2 context could not be created (-1)" from inside the constructor, before the program could say anything. The
# program already learns of it through IsOK() (KiCad: "Could not create the main OpenGL context", then the software
# drawing. The port now writes one console line and leaves the words to the program, as the
# desktop ports' callers expect to handle it. Slicers: their own OpenGL check runs after this and still speaks. Run in pwx/owx.
p = 'src/wasm/glcanvas.cpp'
s = open(p).read()
if 'z47' not in s:
    a = '''        wxLogError("WebGL2 context could not be created (%d)", (int)m_handle);
        return;'''
    b = '''        // z47: no box from inside the constructor; the program reads IsOK() and says what it means
        printf("wx: WebGL2 context could not be created (%d)\\n", (int)m_handle);
        fflush(stdout);
        return;'''
    if s.count(a) != 1:
        print("z47: tree does not fit, skipped"); raise SystemExit(0)
    s = s.replace(a, b)
    if '#include <cstdio>' not in s and '#include <stdio.h>' not in s:
        s = s.replace('#include "wx/glcanvas.h"', '#include "wx/glcanvas.h"\n#include <cstdio>   // z47', 1)
    open(p, 'w').write(s)
print("z47 ok")
