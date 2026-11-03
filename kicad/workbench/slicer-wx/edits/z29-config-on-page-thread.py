# wxConfig on the wasm port (src/wasm/config.cpp) keeps its entries in the page's localStorage through EM_ASM. With main()
# in a worker (the off-thread recipe) those calls ran in the worker, where localStorage does not exist: every read or
# write raised "ReferenceError: localStorage is not defined" (seen at every KiCad start, 12 times). Same cure as the
# password store (secretstore.cpp): every call runs on the page thread..
import re
p = 'src/wasm/config.cpp'; s = open(p).read()
if 'MAIN_THREAD_EM_ASM' in s: print('z29 already applied')
else:
    n = len(re.findall(r'(?<![A-Z_])EM_ASM(_INT|_PTR|_DOUBLE)?\s*\(', s))
    s = re.sub(r'(?<![A-Z_])EM_ASM(_INT|_PTR|_DOUBLE)?(\s*\()', lambda m: 'MAIN_THREAD_EM_ASM' + (m.group(1) or '') + m.group(2), s)
    s = s.replace('#include <emscripten.h>', '#include <emscripten.h>\n#include <emscripten/threading.h>   // z29: MAIN_THREAD_EM_ASM', 1)
    open(p, 'w').write(s); print('z29 applied to %d calls' % n)
