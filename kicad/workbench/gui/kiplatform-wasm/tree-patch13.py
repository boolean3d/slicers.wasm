# tree-patch13: the project manager and the editors are ONE program, as on the desktop.
# On the desktop the schematic and board editors are plug-in libraries (kifaces) that the project manager loads into its
# own process through KIWAY (common/kiway.cpp KIWAY::KiFACE: dlopen, then the getter KIFACE_1). A tab cannot dlopen, so
# the browser build links both editors into the project manager program; each editor's getter and Kiface() carry the
# editor's own name (KIFACE_1_sch / Kiface_sch, KIFACE_1_pcb / Kiface_pcb: compile definitions per editor, programs.cmake)
# and KIWAY::KiFACE takes the getter from a table instead of a loaded library. From there the stock path runs unchanged
# (version, OnKifaceStart with the project suite flags), so the editors are not "stand-alone": Update PCB from Schematic,
# the footprint chooser of the symbol fields and cross-probing go through KIWAY as on the desktop.
# Common code (one copy here, one per kiface library on the desktop) asked Kiface() in four places; it now asks the face of
# the frame it serves (FrameKiface). The editor buttons of the project manager open the editor in this program again
# (tree commit cb551c2d had them open a separate tab: separate programs, no longer built).
import pathlib, sys
root = pathlib.Path(sys.argv[1])

def edit(f, old, new, mark):
    p = root / f; s = p.read_text()
    if mark in s: return
    assert s.count(old) == 1, (f, old[:60])
    p.write_text(s.replace(old, new))

# --- KIWAY::KiFACE: the linked faces -------------------------------------------------------------------------------
edit("common/kiway.cpp", "#include <wx/dynlib.h>\n",
     "#include <wx/dynlib.h>\n"
     "#ifdef __EMSCRIPTEN__\n"
     "// browser build: the editors linked into this program, each getter under its editor's name (programs.cmake)\n"
     "extern \"C\" {\n"
     "KIFACE* KIFACE_1_sch( int* aKIFACEversion, int aKIWAYversion, PGM_BASE* aProgram ) __attribute__(( weak ));\n"
     "KIFACE* KIFACE_1_pcb( int* aKIFACEversion, int aKIWAYversion, PGM_BASE* aProgram ) __attribute__(( weak ));\n"
     "}\n"
     "#endif\n", "KIFACE_1_sch")

OLD_STANDIN = '''#ifdef __EMSCRIPTEN__
        // browser build: no dlopen; a stand-in face so the project manager can load a project (its tree, its
        // settings). Opening an editor window from here is not possible in this build (Player() gets no window).
        struct KIFACE_STANDIN : public KIFACE'''
NEW_STANDIN = '''#ifdef __EMSCRIPTEN__
        // browser build: no dlopen; the schematic and board editors are linked into this program and their getters
        // come from a table, then start as a loaded face starts below. A face that is not linked (calculator, Gerber
        // viewer, drawing sheet editor...) gets a stand-in so the project manager can still load a project.
        KIFACE_GETTER_FUNC* linked = nullptr;

        if( aFaceId == FACE_SCH )
            linked = &KIFACE_1_sch;
        else if( aFaceId == FACE_PCB )
            linked = &KIFACE_1_pcb;

        if( linked )
        {
            APP_MONITOR::AddNavigationBreadcrumb( wxString::Format( "Loading kiface %d", aFaceId ), "kiway.kiface" );

            KIFACE* kiface = linked( &m_kiface_version[aFaceId], KIFACE_VERSION, &Pgm() );
            bool    startSuccess = false;

            try
            {
                startSuccess = kiface->OnKifaceStart( &Pgm(), m_ctl, this );
            }
            catch( ... )
            {
                Pgm().HandleException( std::current_exception() );
            }

            return startSuccess ? ( m_kiface[aFaceId] = kiface ) : nullptr;
        }

        struct KIFACE_STANDIN : public KIFACE'''
edit("common/kiway.cpp", OLD_STANDIN, NEW_STANDIN, "KIFACE_1_sch;")
# --- common code asks the face of the frame it serves ----------------------------------------------------------------
edit("include/kiface_base.h", "/// Global KIFACE_BASE \"get\" accessor.\nKIFACE_BASE& Kiface();\n",
     "/// Global KIFACE_BASE \"get\" accessor.\nKIFACE_BASE& Kiface();\n\n"
     "class wxWindow;\n\n"
     "/**\n * The face of the editor whose frame holds \\a aWindow (the window itself or a parent), or nullptr when that frame\n"
     " * is no editor's (the project manager). Common code asks this instead of Kiface(): in the browser build every editor\n"
     " * is linked into one program and Kiface() is each editor's own name for its face.\n */\n"
     "KIFACE_BASE* FrameKiface( const wxWindow* aWindow );\n", "FrameKiface")

edit("common/eda_base_frame.cpp", '''APP_SETTINGS_BASE* EDA_BASE_FRAME::config() const
{
    // KICAD_MANAGER_FRAME overrides this
    return Kiface().KifaceSettings();
}


const SEARCH_STACK& EDA_BASE_FRAME::sys_search()
{
    return Kiface().KifaceSearch();
}


wxString EDA_BASE_FRAME::help_name()
{
    return Kiface().GetHelpFileName();
}
''', '''KIFACE_BASE* FrameKiface( const wxWindow* aWindow )
{
    for( const wxWindow* window = aWindow; window; window = window->GetParent() )
    {
        if( const EDA_BASE_FRAME* frame = dynamic_cast<const EDA_BASE_FRAME*>( window ) )
        {
            KIWAY::FACE_T face = KIWAY::KifaceType( frame->GetFrameType() );

            if( face == KIWAY::FACE_T( -1 ) || !frame->HasKiway() )
                return nullptr;

            return static_cast<KIFACE_BASE*>( frame->Kiway().KiFACE( face, false ) );
        }
    }

    return nullptr;
}


APP_SETTINGS_BASE* EDA_BASE_FRAME::config() const
{
    // KICAD_MANAGER_FRAME overrides this
    if( KIFACE_BASE* kiface = FrameKiface( this ) )
        return kiface->KifaceSettings();

    return Kiface().KifaceSettings();
}


const SEARCH_STACK& EDA_BASE_FRAME::sys_search()
{
    if( KIFACE_BASE* kiface = FrameKiface( this ) )
        return kiface->KifaceSearch();

    return Kiface().KifaceSearch();
}


wxString EDA_BASE_FRAME::help_name()
{
    if( KIFACE_BASE* kiface = FrameKiface( this ) )
        return kiface->GetHelpFileName();

    return Kiface().GetHelpFileName();
}
''', "KIFACE_BASE* FrameKiface( const wxWindow* aWindow )\n{")

edit("common/dialogs/dialog_color_picker.cpp", "#include <kiface_base.h>\n",
     "#include <kiface_base.h>\n\n\n"
     "// The settings of the editor this dialog serves; none when the project manager's preferences open it (in the browser\n"
     "// build every editor is linked into one program and the manager has no face of its own: Kiface() is not its).\n"
     "static APP_SETTINGS_BASE* pickerSettings( const wxWindow* aDialog )\n{\n"
     "    if( KIFACE_BASE* kiface = FrameKiface( aDialog ) )\n        return kiface->KifaceSettings();\n\n"
     "#ifdef __EMSCRIPTEN__\n    return nullptr;\n#else\n    return Kiface().KifaceSettings();\n#endif\n}\n", "pickerSettings(")
edit("common/dialogs/dialog_color_picker.cpp", '''    APP_SETTINGS_BASE* cfg = Kiface().KifaceSettings();
    wxASSERT( cfg );

    m_notebook->SetSelection( cfg->m_ColorPicker.default_tab );''', '''    APP_SETTINGS_BASE* cfg = pickerSettings( this );

    if( cfg )
        m_notebook->SetSelection( cfg->m_ColorPicker.default_tab );''', "if( cfg )\n        m_notebook->SetSelection")
edit("common/dialogs/dialog_color_picker.cpp", '''    APP_SETTINGS_BASE* cfg = Kiface().KifaceSettings();
    wxASSERT( cfg );

    if( cfg )
        cfg->m_ColorPicker.default_tab''', '''    APP_SETTINGS_BASE* cfg = pickerSettings( this );

    if( cfg )
        cfg->m_ColorPicker.default_tab''', "cfg = pickerSettings( this );\n\n    if( cfg )\n        cfg->m_ColorPicker")

edit("common/design_block_tree_model_adapter.cpp",
     "                                Kiface().KifaceSettings()->m_DesignBlockChooserPanel.tree ),",
     "                                ( FrameKiface( aParent ) ? *FrameKiface( aParent ) : Kiface() )\n"
     "                                        .KifaceSettings()->m_DesignBlockChooserPanel.tree ),", "FrameKiface( aParent )")

# --- the project manager's editor buttons open the editor in this program (stock) ------------------------------------
p = root / "kicad/tools/kicad_manager_control.cpp"; s = p.read_text()
a = s.find("#ifdef __EMSCRIPTEN__\n    // browser build: the editors are separate programs")
if a >= 0:
    b = s.index("#endif\n", a) + len("#endif\n")
    s = s[:a] + s[b:]
    # stock layout: one blank line between the guard and the try
    s = s.replace("REENTRANCY_GUARD guard( &m_inShowPlayer );\n\n\n    try", "REENTRANCY_GUARD guard( &m_inShowPlayer );\n\n    try")
    p.write_text(s)
print("tree-patch13 applied")
