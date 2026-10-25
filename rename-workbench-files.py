#!/usr/bin/env python3
# The workbench the shipped builds are made in uses short working names (spike/, gui/, slicer-wx/, wxgl/, b3d-lan.js,
# p2-bundle.py, ...). This repository uses plain names. sync-workbench.sh copies one app folder out of the workbench
# with the workbench's names, then runs this on it: every file and folder below is moved to its plain name and every
# reference to it in the folder's text files is rewritten to match, so the folder builds under build.sh as it is.
#
#   python3 rename-workbench-files.py bambu|orca|prusa <app folder in workbench names>
#
# patches/*.patch are diffs of upstream trees and are left as they are (only the files are renamed). A name in the
# table that is not in the folder is skipped; a working name still in a file name afterwards stops with an error.
import os, re, sys

APP, ROOT = sys.argv[1], sys.argv[2]

# Folders and files, as paths in the app folder: workbench name -> plain name. Inner paths before outer ones.
MOVES = [
    ('gui/agent/b3d-lan.js', 'gui/agent/lan-printer-link.js'),
    ('gui/agent/b3d_lan_agent.cpp', 'gui/agent/lan_printer_agent.cpp'),
    ('gui/agent/b3d_lan_camera.cpp', 'gui/agent/lan_printer_camera.cpp'),
    ('gui/agent', 'gui/printer-link'),
    ('gui/bundle/p2-bundle.py', 'gui/bundle/write-presets-bundle.py'),
    ('gui/bundle/wxfs-bundle.js', 'gui/bundle/presets-bundle-reader.js'),
    ('gui/bundle', 'gui/presets-bundle'),
    ('gui/door/b3d-door.js', 'gui/door/script-door.js'),
    ('gui/door/b3d_door.cpp', 'gui/door/script_door.cpp'),
    ('gui/door/CMAKE-EDIT.txt', 'gui/door/cmake-lines.txt'),
    ('gui/door', 'gui/script-door'),
    ('gui/hms-extra', 'gui/printer-messages'),
    ('gui/shims-cgal', 'gui/stand-in-headers-cgal'),
    ('gui/shims-gui', 'gui/stand-in-headers-gui'),
    ('gui/stubs', 'gui/stand-ins'),
    ('gui/cmake-fake', 'gui/cmake-find-files'),
    ('gui/shaders-ES-prusa', 'gui/webgl-shaders'),
    ('gui/cmake/OrcaGuiPatches.cmake', 'gui/cmake/PatchedCopies.cmake'),
    ('gui/PrusaWasmPatches.cmake', 'gui/prusaslicer-source-edits.cmake'),
    ('gui/bambu-pre.js', 'gui/start-up.js'),
    ('gui/orca-pre.js', 'gui/start-up.js'),
    ('gui/prusa-pre.js', 'gui/start-up.js'),
    ('gui/maker-free.py', 'gui/remove-maker-branding.py'),
    ('gui/maker-free-orca.py', 'gui/remove-maker-branding-orca.py'),
    ('gui/bed-model-fill.py', 'gui/fill-plate-logo-holes.py'),
    ('gui/build-gdeps-bambu.sh', 'gui/build-gui-libraries-bambu.sh'),
    ('gui/build-gdeps.sh', 'gui/build-gui-libraries.sh'),
    ('gui/build-pdeps.sh', 'gui/build-prusaslicer-libraries.sh'),
    ('gui/build-occt-prusa.sh', 'gui/build-occt-prusaslicer.sh'),
    ('gui/build-gui.sh', 'gui/build-slicer.sh'),
    ('gui/build-wx.sh', 'gui/build-wxwidgets.sh'),
    ('gui', 'browser-build'),
    ('slicer-wx/js/wxfs-bundle.js', 'slicer-wx/js/presets-bundle-reader.js'),
    ('slicer-wx/js/wxpage-web.js', 'slicer-wx/js/page-bridge-web.js'),
    ('slicer-wx/js/wxpage.js', 'slicer-wx/js/page-bridge.js'),
    ('slicer-wx', 'shared'),
    ('wxgc/js/wxgc.js', 'wxgc/js/graphics-context.js'),
    ('wxgl', 'wxwidgets-opengl'),
    ('wxweb', 'wxwidgets-web'),
    ('wxgc', 'wxwidgets-drawing'),
    ('wxjs', 'shared-js-prusaslicer'),
    ('patches/bambustudio.patch', 'patches/bambu-studio.patch'),
    ('patches/engine.patch', 'patches/muon3d-engine.patch'),
]

# Text: (regex, replacement), in order. File names first (anywhere), then folder names in the forms the files use
# them: /w/spike/<path>, spike/<path>, ${CMAKE_CURRENT_SOURCE_DIR}/<path>, ../<path>, and a path starting a word.
B = r'(?<![\w.$/-])'      # starts a path: not inside another name (and not after a / unless the rule says so)
E = r'(?![\w-])'
TEXT = [(B.replace('/', '') + re.escape(os.path.basename(o)) + E, os.path.basename(n))
        for o, n in MOVES if '.' in os.path.basename(o)]
TEXT += [
    (r'/w/spike\b', '/w/browser-port'),
    (B + r'spike/', 'browser-port/'),
    (r'(?<![\w.$-])gui/agent/', 'gui/printer-link/'),
    (r'(CMAKE_CURRENT_SOURCE_DIR\}/|\.\.\./|gui/)agent/', r'\1printer-link/'),
    (r'(CMAKE_CURRENT_SOURCE_DIR\}/|gui/)bundle/', r'\1presets-bundle/'),
    (r'(CMAKE_CURRENT_SOURCE_DIR\}/|gui/)door/', r'\1script-door/'),
    (r'(CMAKE_CURRENT_SOURCE_DIR\}/|gui/)stubs/', r'\1stand-ins/'),
    (r'(?<![\w.-])hms-extra' + E, 'printer-messages'),
    (r'(?<![\w.-])shims-cgal' + E, 'stand-in-headers-cgal'),
    (r'(?<![\w.-])shims-gui' + E, 'stand-in-headers-gui'),
    (r'(?<![\w.-])cmake-fake' + E, 'cmake-find-files'),
    (r'(?<![\w.-])shaders-ES-prusa' + E, 'webgl-shaders'),
    (r'\bOrcaGuiPatches\b', 'PatchedCopies'),
    (r'(?<![\w.-])slicer-wx' + E, 'shared'),
    (r'(?<![\w.-])wxgl(?![\w.-])', 'wxwidgets-opengl'),
    (r'(?<![\w.-])wxweb(?![\w.-])', 'wxwidgets-web'),
    (r'(?<![\w.-])wxgc(?![\w.-])', 'wxwidgets-drawing'),
    (r'(?<![\w.-])wxjs(?![\w.-])', 'shared-js-prusaslicer'),
    (r'(?<![\w.$/-])gui/', 'browser-build/'),
    (r'(/w/browser-port/|browser-port/)gui\b', r'\1browser-build'),
    # the same folders named in comments: agent/lan_printer_agent.cpp, stubs/web_debug.cpp, gui/agent
    (r'(?<![\w./-])agent/(?=lan_printer)', 'printer-link/'),
    (r'(?<![\w./-])stubs/(?=(web_|WebView|gl_compat|hidapi_|pthread_name|bambu_gui|orca_gui))', 'stand-ins/'),
    (r'browser-build/agent\b', 'browser-build/printer-link'),
    # the files of package/ (named in comments)
    (r'(?<![\w.-])b3d-disk(?![\w-])', 'boolean3d-folder'),
    (r'(?<![\w.-])home-sync(?![\w-])', 'home-folder-sync'),
    (r'(?<![\w.-])part-in\.js', 'open-part-from-link.js'),
    (r'(?<![\w.-])lazy\.js', 'install-and-lazy-load.js'),
    (r'(?<![\w.-])trace\.js', 'trace-file-reads.js'),
    (r'(?<![\w.-])slicer-cache-sw\.js', 'slicer-cache-service-worker.js'),
]

for o, n in MOVES:
    src, dst = os.path.join(ROOT, o), os.path.join(ROOT, n)
    if os.path.lexists(src):
        if os.path.lexists(dst): sys.exit(f'rename-workbench-files: {n} is there already')
        os.rename(src, dst)

# Copies the workbench keeps beside the shared kit (PrusaSlicer's net/ and its certificates file): the same bytes as
# shared/'s, so the build reads shared/'s and the copy is left out. A copy that differs stops here.
SAME = [('net', 'shared/net', r'\.\./net/', '../shared/net/'),
        ('browser-build/ca-certificates.crt', 'shared/net/ca-certificates.crt',
         r'CMAKE_CURRENT_SOURCE_DIR\}/ca-certificates\.crt', 'CMAKE_CURRENT_SOURCE_DIR}/../shared/net/ca-certificates.crt')]
for copy, kept, pat, rep in list(SAME):
    a, b = os.path.join(ROOT, copy), os.path.join(ROOT, kept)
    if not os.path.lexists(a): SAME.remove((copy, kept, pat, rep)); continue
    if os.system(f'diff -r -q "{a}" "{b}" > /dev/null') != 0: sys.exit(f'rename-workbench-files: {copy} differs from {kept}')
    os.system(f'rm -rf "{a}"')
    TEXT.append((pat, rep))

for d, _, files in os.walk(ROOT):
    for f in files:
        p = os.path.join(d, f)
        if p.endswith('.patch') or os.path.islink(p): continue
        try: text = open(p, encoding='utf-8').read()
        except UnicodeDecodeError: continue
        new = text
        for pat, rep in TEXT: new = re.sub(pat, rep, new)
        if new != text: open(p, 'w', encoding='utf-8').write(new)

left = [os.path.join(d, f) for d, ds, fs in os.walk(ROOT) for f in ds + fs
        if re.search(r'^(spike|gui|slicer-wx|wx(gl|web|gc|js)|agent|door|bundle|stubs|shims-.*|hms-extra|cmake-fake|b3d[-_].*|p2-bundle\.py|wxfs-bundle\.js|wxpage.*|.*-pre\.js|maker-free.*)$', f)]
if left: sys.exit('rename-workbench-files: still working names: ' + ', '.join(left))
print('rename-workbench-files: done', APP)
