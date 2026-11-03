# tree-patch14: with one program (tree-patch13), a board or schematic given to it alone opens in its
# editor. On the desktop a .kicad_pcb / .kicad_sch opened from the file manager starts pcbnew / eeschema stand-alone; the
# kicad program does the same with its own switch (--frame pcb / --frame sch, kicad/kicad.cpp). The browser build has no
# separate editor programs, so a single board or schematic argument picks that frame (a project file still opens the
# project manager).
import pathlib, sys
root = pathlib.Path(sys.argv[1])
p = root / "kicad/kicad.cpp"; s = p.read_text()
old = '''    wxString frameName;

    if( parser.Found( "frame", &frameName ) )
    {'''
new = '''    wxString frameName;

#ifdef __EMSCRIPTEN__
    // browser build: a board or schematic given alone opens in its editor, as the desktop's file association starts
    // pcbnew or eeschema with it (here they are this program's --frame pcb / --frame sch)
    if( !parser.Found( "frame" ) && parser.GetParamCount() == 1 )
    {
        wxString ext = wxFileName( parser.GetParam( 0 ) ).GetExt();

        if( ext == FILEEXT::KiCadPcbFileExtension )
            frameName = wxT( "pcb" );
        else if( ext == FILEEXT::KiCadSchematicFileExtension )
            frameName = wxT( "sch" );
    }
#endif

    if( parser.Found( "frame", &frameName ) || !frameName.IsEmpty() )
    {'''
if "browser build: a board or schematic given alone" not in s:
    assert s.count(old) == 1
    p.write_text(s.replace(old, new))
print("tree-patch14 applied")
