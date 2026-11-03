# One edit, every wx tree we build: 3.1.5 (Orca 2.3), 3.2.6 (Prusa), 3.3.2 (Orca 2.4, Elegoo, Creality Print 7.3).
# wx 3.3 spells the same code differently (nullptr for NULL, override for wxOVERRIDE, = default for {}, no
# #if wxUSE_UNICODE). An anchor written against 3.1 is tried as written first, then in 3.3 spelling; the replacement
# goes in with the spelling that matched, so it reads like the code around it. Edits import sub() from here; a new spelling rule goes in as33() once.
# Running this file does nothing (the build runs every edits/*.py).
import re

def as33(t):
    t = re.sub(r'\bwxOVERRIDE\b', 'override', t)
    t = re.sub(r'\bwxNOEXCEPT\b', 'noexcept', t)
    t = re.sub(r'\bNULL\b', 'nullptr', t)
    t = re.sub(r'(?m)^(\s+(?:virtual )?~?wx\w+\(\)) \{\}$', r'\1 = default;', t)   # empty ctor/dtor
    t = re.sub(r'#if wxUSE_UNICODE\n((?:(?!#).*\n)*?)#endif\n', r'\1', t)   # Unicode only: the #if is gone
    return t

def forms(a, b):
    """(anchor, replacement) pairs to try, 3.1/3.2 form first."""
    f = [(a, b)]
    if as33(a) != a or as33(b) != b: f.append((as33(a), as33(b)))
    return f

def sub(p, a, b, n=1):
    s = open(p).read()
    f = forms(a, b)
    if any(fb in s for fa, fb in f): return   # already applied
    for fa, fb in f:
        if s.count(fa) == n:
            open(p, 'w').write(s.replace(fa, fb)); return
    assert False, (p, a[:60], [s.count(fa) for fa, fb in f])
