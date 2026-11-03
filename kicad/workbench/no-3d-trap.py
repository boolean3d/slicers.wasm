#!/usr/bin/env python3
# no-3d-trap.py <kicad tree>: until the 3D view runs on WebGL2, asking for it never traps the tab.
# View > 3D Viewer showed "Failed to load OpenGL via loader" again on every repaint (the canvas retries
# OpenGL at each paint and each try queued another log box): OK never closed it, the board was out of reach.
#  - View > 3D Viewer (Alt+3, board and footprint editors) and the footprint chooser's 3D button: one plain note, no frame
#  - the 3D canvases (3D viewer, footprint 3D preview): the missing OpenGL is one console line, never a box
# Each edit is inside #ifdef __EMSCRIPTEN__; the desktop build is unchanged. Rerun-safe.
import sys, pathlib

root = pathlib.Path(sys.argv[1])
MARK = 'kicad-play-5 no-3d-trap'
NOTE = ('#ifdef __EMSCRIPTEN__\n'
        '    // ' + MARK + ': no 3D view in the browser yet: a plain note instead of a frame that cannot draw\n'
        '    DisplayInfoMessage( {FRAME}, _( "The 3D view is coming to KiCad in the browser." ) );\n'
        '    return{RET};\n'
        '#endif\n\n')


def patch(rel, pairs, include):
    p = root / rel
    s = p.read_text()
    if MARK in s:
        print('already', rel)
        return
    i = s.index('#include')
    s = s[:i] + '#include ' + include + ' // ' + MARK + '\n' + s[i:]
    for old, new in pairs:
        assert s.count(old) == 1, (rel, old[:80], s.count(old))
        s = s.replace(old, new)
    p.write_text(s)
    print('patched', rel)


patch('pcbnew/tools/pcb_viewer_tools.cpp', [
    ('int PCB_VIEWER_TOOLS::Show3DViewer( const TOOL_EVENT& aEvent )\n{\n',
     'int PCB_VIEWER_TOOLS::Show3DViewer( const TOOL_EVENT& aEvent )\n{\n'
     + NOTE.replace('{FRAME}', 'frame()').replace('{RET}', ' 0')),
], '<confirm.h>')
patch('pcbnew/footprint_chooser_frame.cpp', [
    ('void FOOTPRINT_CHOOSER_FRAME::Show3DViewerFrame()\n{\n',
     'void FOOTPRINT_CHOOSER_FRAME::Show3DViewerFrame()\n{\n'
     + NOTE.replace('{FRAME}', 'this').replace('{RET}', '')),
], '<confirm.h>')
LOG = '        wxLogMessage( wxT( "Failed to load OpenGL via loader" ) );\n'
QUIET = ('#ifdef __EMSCRIPTEN__\n'
         '        // ' + MARK + ': a box here came back on every repaint and trapped the tab\n'
         '        static bool told = false;\n'
         '        if( !told )\n'
         '            printf( "kicad: no 3D view in the browser yet\\n" );\n'
         '        told = true;\n'
         '#else\n' + LOG + '#endif\n')
patch('3d-viewer/3d_canvas/eda_3d_canvas.cpp', [(LOG, QUIET)], '<cstdio>')
patch('3d-viewer/3d_model_viewer/eda_3d_model_viewer.cpp', [(LOG, QUIET)], '<cstdio>')
