#!/usr/bin/env python3
"""Check the build-time text patches against a source tree, without building.

The browser builds patch some upstream files at configure time (orca_gui_patch in browser-build/CMakeLists.txt,
orca_patch_source in the engine recipe): each FIND text must occur exactly once. CMake only says so hours into a
build, one miss at a time. This reads the same calls and reports every miss at once.

  check-text-patches.py <source tree> <cmake file> [<cmake file> ...]
Exit 0 when every patch applies, 1 otherwise (each miss is named: file, patch number, first line of the text).
"""
import re, sys, pathlib

CALLS = {'orca_gui_patch': ('src', 1), 'orca_patch_source': ('src/libslic3r', 0)}   # base dir, index of the path argument

def arguments(text, pos):
    """The arguments of the call whose '(' is at pos, as (value, quoted) pairs."""
    args, i, depth = [], pos + 1, 1
    while depth:
        c = text[i]
        if c == '"':
            j, out = i + 1, []
            while text[j] != '"':
                if text[j] == '\\':
                    j += 1
                    out.append({'n': '\n', 't': '\t', 'r': '\r'}.get(text[j], text[j]))
                else:
                    out.append(text[j])
                j += 1
            args.append((''.join(out), True)); i = j + 1
        elif c == '#':
            i = text.index('\n', i)
        elif c == '(':
            depth += 1; i += 1
        elif c == ')':
            depth -= 1; i += 1
        elif c.isspace():
            i += 1
        else:
            j = i
            while not text[j].isspace() and text[j] not in '()"#': j += 1
            args.append((text[i:j], False)); i = j
    return args

def main():
    tree = pathlib.Path(sys.argv[1]); bad = 0; n = 0
    for cm in sys.argv[2:]:
        text = pathlib.Path(cm).read_text()
        for m in re.finditer(r'^[ \t]*(orca_gui_patch|orca_patch_source)\s*\(', text, re.M):
            base, at = CALLS[m.group(1)]
            args = arguments(text, m.end() - 1)
            rel = args[at][0]
            if '${' in rel: continue                      # the function's own definition
            src = tree / base / rel
            if not src.exists():
                print(f'MISSING FILE  {rel}  ({cm})'); bad += 1; continue
            body = src.read_text(errors='replace')
            pairs = args[2:]
            for k in range(0, len(pairs), 4):
                find, repl = pairs[k + 1][0], pairs[k + 3][0]
                n += 1
                if '${' in find:
                    print(f'skipped (uses a variable)  {rel} #{k // 4 + 1}'); continue
                c = body.count(find)
                if c != 1:
                    bad += 1
                    print(f'NO LONGER APPLIES  {rel} #{k // 4 + 1}: found {c} times: {find.strip().splitlines()[0][:100]!r}')
                body = body.replace(find, repl)
    print(f'{n} text patches checked, {bad} do not apply')
    sys.exit(1 if bad else 0)

main()
