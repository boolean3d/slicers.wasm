#!/usr/bin/env python3
# settings-save.py <kicad tree>: a browser tab never exits, so KiCad's exit-time save of its settings never happens and
# every visit started with the first-start wizard ("KiCad is starting for the first time, or some of its configuration
# files are missing". The browser build writes the settings files as soon as the start wizard is
# done (its answers, or the defaults when it is cancelled); the home store keeps them for the next visit.
# Inside #ifdef __EMSCRIPTEN__; the desktop build is unchanged. Rerun-safe.
import sys, pathlib

root = pathlib.Path(sys.argv[1])
MARK = 'kicad-play-7 settings-save'


def patch(rel, pairs):
    p = root / rel
    s = p.read_text()
    if MARK in s:
        print('already', rel)
        return
    for old, new in pairs:
        assert s.count(old) == 1, (rel, old[:80], s.count(old))
        s = s.replace(old, new)
    p.write_text(s)
    print('patched', rel)


SAVE = ('#ifdef __EMSCRIPTEN__\n'
        '    // ' + MARK + ': a tab never exits, so the settings are written now, not at exit\n'
        '    Pgm().GetSettingsManager().Save();\n'
        '#endif\n')
patch('common/single_top.cpp', [
    ('    STARTWIZARD startWizard;\n    startWizard.CheckAndRun( frame );\n',
     '    STARTWIZARD startWizard;\n    startWizard.CheckAndRun( frame );\n' + SAVE),
    ('#include <startwizard/startwizard.h>\n', '#include <startwizard/startwizard.h>\n#include <settings/settings_manager.h>   // ' + MARK + '\n'),
])
patch('kicad/kicad.cpp', [
    ('        STARTWIZARD startWizard;\n        startWizard.CheckAndRun( frame );\n',
     '        STARTWIZARD startWizard;\n        startWizard.CheckAndRun( frame );\n'
     '#ifdef __EMSCRIPTEN__\n'
     '        // ' + MARK + ': a tab never exits, so the settings are written now, not at exit\n'
     '        Pgm().GetSettingsManager().Save();\n'
     '#endif\n'),
])
