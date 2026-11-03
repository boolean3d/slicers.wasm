#!/usr/bin/env python3
# 3d-view.py <kicad tree>: KiCad's 3D view in the browser build.
#  - the 3D canvases load OpenGL through the same WebGL2 stand-in as the board drawing (glad -> kigl_es_proc), not forced off
#  - ray tracing stays off in a tab (it shows its picture through mapped pixel buffers, which WebGL2 does not have)
#  - the model loaders (plugins/3d/vrml, plugins/3d/oce) are linked into the program: each one's exported names carry its
#    own prefix (KIPLUGIN_FN, -DKICAD_PLUGIN_BUILTIN=vrml_ / oce_ from spike/gui/programs.cmake) and plugins/ldr opens
#    "builtin:vrml" / "builtin:oce" from a table of those functions instead of a shared library
# Each edit is inside #ifdef __EMSCRIPTEN__ or KICAD_PLUGIN_BUILTIN; the desktop build is unchanged. Rerun-safe.
import re, sys, pathlib

root = pathlib.Path(sys.argv[1])
MARK = 'kicad-play-5 3d-view'


def patch(rel, pairs=(), names=None, expect=None):
    # Rerun-safe pair by pair: a pair whose new text is in the file already is done; the name rewrite runs once (MARK)
    p = root / rel
    s = p.read_text()
    n_done = 0
    for old, new in pairs:
        if new in s:
            continue
        assert s.count(old) == 1, (rel, old[:80], s.count(old))
        s = s.replace(old, new)
        n_done += 1
    if names and MARK not in s:
        n = 0
        def sub(m):
            nonlocal n
            n += 1
            return m.group(1) + 'KIPLUGIN_FN( ' + m.group(2) + ' )' + m.group(3)
        s = re.sub(r'^((?:KICAD_PLUGIN_EXPORT\s+)?(?:const\s+)?(?:char|void|bool|int|SCENEGRAPH)\s*(?:const)?\s*\*?\s*)('
                   + '|'.join(names) + r')(\s*\()', sub, s, flags=re.M)
        assert n == expect, (rel, n, expect)
        s = '// ' + MARK + ': exported names through KIPLUGIN_FN (plugins/kicad_plugin.h)\n' + s
        n_done += 1
    if n_done:
        p.write_text(s)
    print('patched' if n_done else 'already', rel, n_done)


GL_OFF = ('#ifdef __EMSCRIPTEN__\n'
          '    const int glVersion = 0; // browser build: no 3D view (only the board\'s 2D drawing runs on WebGL2)\n'
          '#else\n'
          '    const int glVersion = gladLoaderLoadGL();\n'
          '#endif\n')
GL_ON = ('    // ' + MARK + ': in the browser build glad loads the WebGL2 stand-in, as for the board drawing\n'
         '    const int glVersion = gladLoaderLoadGL();\n')

patch('3d-viewer/3d_canvas/eda_3d_canvas.cpp', [
    (GL_OFF, GL_ON),
    ('#if wxCHECK_VERSION( 3, 3, 3 )\n    wxGLCanvas::SetSwapInterval( -1 );',
     '#ifdef __EMSCRIPTEN__\n'
     '    // ' + MARK + ': ray tracing shows its picture through mapped pixel buffers, which WebGL2 does not have\n'
     '    if( m_opengl_supports_raytracing && GetParent() )\n'
     '    {\n'
     '        wxCommandEvent evt( wxEVT_MENU, ID_DISABLE_RAY_TRACING );\n'
     '        GetParent()->ProcessWindowEvent( evt );\n'
     '    }\n\n'
     '    m_opengl_supports_raytracing = false;\n'
     '#endif\n\n'
     '#if wxCHECK_VERSION( 3, 3, 3 )\n    wxGLCanvas::SetSwapInterval( -1 );'),
])
patch('3d-viewer/3d_model_viewer/eda_3d_model_viewer.cpp', [(GL_OFF, GL_ON)])

# ── the plugins' exported names ──
EXPORT_DEF = ('    #ifndef KICAD_PLUGIN_EXPORT\n    #define KICAD_PLUGIN_EXPORT extern "C" __declspec( dllexport )\n'
              '    #endif\n#endif\n')
patch('include/plugins/kicad_plugin.h', [
    (EXPORT_DEF, EXPORT_DEF + '\n'
     '// ' + MARK + ': a plugin linked into the program (the browser build: no shared libraries) is built with\n'
     '// KICAD_PLUGIN_BUILTIN=<prefix>_, so the exported names of several plugins do not collide; plugins/ldr finds them\n'
     '// in its table of built-in plugins. Everywhere else the names are as they were.\n'
     '#ifndef KIPLUGIN_FN\n'
     '#ifdef KICAD_PLUGIN_BUILTIN\n'
     '#define KIPLUGIN_CAT2( a, b ) a##b\n'
     '#define KIPLUGIN_CAT( a, b ) KIPLUGIN_CAT2( a, b )\n'
     '#define KIPLUGIN_FN( n ) KIPLUGIN_CAT( KICAD_PLUGIN_BUILTIN, n )\n'
     '#else\n'
     '#define KIPLUGIN_FN( n ) n\n'
     '#endif\n'
     '#endif\n'),
], names=['GetKicadPluginClass', 'GetClassVersion', 'CheckClassVersion', 'GetKicadPluginName', 'GetPluginVersion'], expect=5)
NAMES3D = ['GetKicadPluginClass', 'GetClassVersion', 'CheckClassVersion', 'GetKicadPluginName', 'GetPluginVersion',
           'GetNExtensions', 'GetModelExtension', 'GetNFilters', 'GetFileFilter', 'CanRender', 'Load']
patch('include/plugins/3d/3d_plugin.h', names=NAMES3D, expect=9)
patch('plugins/3d/vrml/vrml.cpp', names=NAMES3D, expect=8)
patch('plugins/3d/oce/oce.cpp', names=NAMES3D, expect=8)
# The console says what became of the models: the loaders the program has, and each model file's load
patch('3d-viewer/3d_cache/3d_cache.cpp', [
    ('#include <wx/log.h>\n', '#include <wx/log.h>\n#include <cstdio>   // ' + MARK + '\n'),
    ('    ep->sceneData = m_Plugins->Load3DModel( aFileName, ep->pluginInfo );\n\n'
     '    if( !ADVANCED_CFG::GetCfg().m_Skip3DModelFileCache && nullptr != ep->sceneData )\n',
     '    ep->sceneData = m_Plugins->Load3DModel( aFileName, ep->pluginInfo );\n\n'
     '#ifdef __EMSCRIPTEN__\n'
     '    // ' + MARK + ': the console gets each model file\'s load\n'
     '    printf( "kicad: 3D model %s: %s\\n", aFileName.utf8_str().data(),\n'
     '            ep->sceneData ? ep->pluginInfo.c_str() : "not loaded (no loader for its type, or the file could not be read)" );\n'
     '#endif\n\n'
     '    if( !ADVANCED_CFG::GetCfg().m_Skip3DModelFileCache && nullptr != ep->sceneData )\n'),
])
patch('3d-viewer/3d_rendering/opengl/create_scene.cpp', [
    ('                    // only add it if the return is not NULL\n'
     '                    if( modelPtr )\n                    {\n'
     '                        MATERIAL_MODE materialMode = m_boardAdapter.m_Cfg->m_Render.material_mode;\n'
     '                        MODEL_3D*     model        = new MODEL_3D( *modelPtr, materialMode );\n\n'
     '                        m_3dModelMap[ fp_model.m_Filename ] = model;\n'
     '                    }\n',
     '                    // only add it if the return is not NULL\n'
     '                    if( modelPtr )\n                    {\n'
     '                        MATERIAL_MODE materialMode = m_boardAdapter.m_Cfg->m_Render.material_mode;\n'
     '                        MODEL_3D*     model        = new MODEL_3D( *modelPtr, materialMode );\n\n'
     '                        m_3dModelMap[ fp_model.m_Filename ] = model;\n'
     '#ifdef __EMSCRIPTEN__\n'
     '                        // ' + MARK + ': the console gets what the 3D view received\n'
     '                        printf( "kicad: 3D view: %s: %u meshes, opaque %d, transparent %d\\n",\n'
     '                                fp_model.m_Filename.utf8_str().data(), modelPtr->m_MeshesSize,\n'
     '                                (int) model->HasOpaqueMeshes(), (int) model->HasTransparentMeshes() );\n'
     '#endif\n'
     '                    }\n'
     '#ifdef __EMSCRIPTEN__\n'
     '                    else\n'
     '                        printf( "kicad: 3D view: %s: nothing to draw (not loaded)\\n", fp_model.m_Filename.utf8_str().data() );\n'
     '#endif\n'),
])
# Each plugin's "static struct FILE_DATA { FILE_DATA() {...} } file_data;": the in-class constructor is an inline
# (weak) symbol with the same name in both, and linked into one program the linker keeps one of them, so the STEP
# loader registered the VRML file types. An anonymous namespace makes
# each plugin's one its own; the desktop's separate libraries never met.
for _p in ('vrml/vrml.cpp', 'oce/oce.cpp'):
    patch('plugins/3d/' + _p, [
        ('static struct FILE_DATA\n{\n', 'namespace\n{\n// ' + MARK + ': the type is this file\'s own (both loaders have one)\nstruct FILE_DATA\n{\n'),
        ('} file_data;\n', '} file_data;\n}  // namespace\n'),
    ])
# loadmodel.cpp's two file-local helpers are plain globals; linked into the board editor they clash with the STEP and U3D
# exporters' helpers of the same names (pcbnew/exporters/step/step_pcb_model.cpp, u3d/writer.cpp): file-local here
patch('plugins/3d/oce/loadmodel.cpp', [
    # the console says why a STEP or IGES file gave no model
    ('#include <wx/log.h>\n', '#include <wx/log.h>\n#include <cstdio>   // ' + MARK + '\n'),
    ('    IFSelect_ReturnStatus stat  = reader.ReadFile( fname );\n\n    if( stat != IFSelect_RetDone )\n        return false;\n\n    // Enable user-defined shape precision\n',
     '    IFSelect_ReturnStatus stat  = reader.ReadFile( fname );\n\n    if( stat != IFSelect_RetDone )\n    {\n'
     '#ifdef __EMSCRIPTEN__\n        printf( "kicad: STEP %s: could not be read (status %d)\\n", fname, (int) stat );\n#endif\n'
     '        return false;\n    }\n\n    // Enable user-defined shape precision\n'),
    ('    if( !reader.Transfer( m_doc ) )\n    {\n        if( m_doc->CanClose() == CDM_CCS_OK )\n            m_doc->Close();\n\n        return false;\n    }\n\n    // are there any shapes to translate?\n    if( reader.NbRootsForTransfer() < 1 )\n    {\n',
     '    if( !reader.Transfer( m_doc ) )\n    {\n'
     '#ifdef __EMSCRIPTEN__\n        printf( "kicad: STEP %s: the shapes could not be translated\\n", fname );\n#endif\n'
     '        if( m_doc->CanClose() == CDM_CCS_OK )\n            m_doc->Close();\n\n        return false;\n    }\n\n    // are there any shapes to translate?\n    if( reader.NbRootsForTransfer() < 1 )\n    {\n'
     '#ifdef __EMSCRIPTEN__\n        printf( "kicad: STEP %s: no shapes in the file\\n", fname );\n#endif\n'),
    ('    default:\n        if( m_app->CanClose( data.m_doc ) == CDM_CCS_OK )\n            m_app->Close( data.m_doc );\n\n        return nullptr;\n        break;\n    }\n',
     '    default:\n'
     '#ifdef __EMSCRIPTEN__\n        printf( "kicad: 3D model %s: not a STEP or IGES file by its first lines (format %d)\\n", filename, (int) modelFmt );\n#endif\n'
     '        if( m_app->CanClose( data.m_doc ) == CDM_CCS_OK )\n            m_app->Close( data.m_doc );\n\n        return nullptr;\n        break;\n    }\n'),
    ('    if( !ret )\n    {\n        if( m_app->CanClose( data.m_doc ) == CDM_CCS_OK )\n            m_app->Close( data.m_doc );\n\n        return nullptr;\n    }\n',
     '    if( !ret )\n    {\n'
     '#ifdef __EMSCRIPTEN__\n        printf( "kicad: 3D model %s: %d top shapes, none gave a mesh\\n", filename, (int) frshapes.Length() );\n#endif\n'
     '        if( m_app->CanClose( data.m_doc ) == CDM_CCS_OK )\n            m_app->Close( data.m_doc );\n\n        return nullptr;\n    }\n'),
    ('\nFormatType fileType( const char* aFileName )', '\n// ' + MARK + ': file-local (the exporters have helpers of these names)\nstatic FormatType fileType( const char* aFileName )'),
    ('\nstd::string getShapeName( TopAbs_ShapeEnum aShape )', '\nstatic std::string getShapeName( TopAbs_ShapeEnum aShape )'),
])

# ── the loader: built-in plugins by name ──
patch('plugins/ldr/pluginldr.h', [
    ('#define MASK_PLUGINLDR wxT( "PLUGIN_LOADER" )\n',
     '#define MASK_PLUGINLDR wxT( "PLUGIN_LOADER" )\n\n'
     '#ifdef __EMSCRIPTEN__\n'
     '// ' + MARK + ': a browser program cannot load a shared library; its plugins are linked in and opened by name\n'
     '// ("builtin:vrml", "builtin:oce") from a table of their functions (KIPLUGIN_FN in plugins/kicad_plugin.h)\n'
     'struct KIPLUGIN_BUILTIN_FN;\n\n'
     'class KIPLUGIN_BUILTIN_LIB\n'
     '{\n'
     'public:\n'
     '    bool  Load( const wxString& aName, int aFlags = 0 );\n'
     '    bool  IsLoaded() const { return m_table != nullptr; }\n'
     '    void* GetSymbol( const wxString& aName ) const;\n'
     '    void  Unload() { m_table = nullptr; }\n\n'
     'private:\n'
     '    const KIPLUGIN_BUILTIN_FN* m_table = nullptr;\n'
     '};\n'
     '#endif\n'),
    ('    wxDynamicLibrary m_PluginLoader;\n',
     '#ifdef __EMSCRIPTEN__\n    KIPLUGIN_BUILTIN_LIB m_PluginLoader;\n#else\n    wxDynamicLibrary m_PluginLoader;\n#endif\n'),
])

DECL = ''.join('    extern "C" __attribute__(( weak )) ' + d + '; \\\n' for d in [
    'char const* p##GetKicadPluginClass( void )',
    'void p##GetClassVersion( unsigned char*, unsigned char*, unsigned char*, unsigned char* )',
    'bool p##CheckClassVersion( unsigned char, unsigned char, unsigned char, unsigned char )',
    'const char* p##GetKicadPluginName( void )',
    'void p##GetPluginVersion( unsigned char*, unsigned char*, unsigned char*, unsigned char* )',
    'int p##GetNExtensions( void )',
    'char const* p##GetModelExtension( int )',
    'int p##GetNFilters( void )',
    'char const* p##GetFileFilter( int )',
    'bool p##CanRender( void )',
    'SCENEGRAPH* p##Load( char const* )'])
ROWS = ', '.join('KIPLUGIN_ROW( p, ' + n + ' )' for n in NAMES3D)
LDR_TAIL = ('\n\n#ifdef __EMSCRIPTEN__\n'
            '// ' + MARK + ': the plugins linked into this program (spike/gui/programs.cmake builds plugins/3d/vrml and\n'
            '// plugins/3d/oce as static libraries with KICAD_PLUGIN_BUILTIN=vrml_ / oce_). The references are weak: a program\n'
            '// linked without a plugin has a null first entry and the plugin is simply absent.\n'
            'class SCENEGRAPH;\n\n'
            '#define KIPLUGIN_DECLARE( p ) \\\n' + DECL + '\n'
            'KIPLUGIN_DECLARE( vrml_ )\n'
            'KIPLUGIN_DECLARE( oce_ )\n\n'
            'struct KIPLUGIN_BUILTIN_FN\n{\n    const char* name;\n    void*       fn;\n};\n\n'
            '#define KIPLUGIN_ROW( p, n ) { #n, (void*) &p##n }\n'
            '#define KIPLUGIN_TABLE( p ) { ' + ROWS + ', { nullptr, nullptr } }\n\n'
            'static const KIPLUGIN_BUILTIN_FN s_vrmlPlugin[] = KIPLUGIN_TABLE( vrml_ );\n'
            'static const KIPLUGIN_BUILTIN_FN s_ocePlugin[] = KIPLUGIN_TABLE( oce_ );\n\n'
            'bool KIPLUGIN_BUILTIN_LIB::Load( const wxString& aName, int )\n{\n'
            '    const KIPLUGIN_BUILTIN_FN* t = aName == wxT( "builtin:vrml" ) ? s_vrmlPlugin\n'
            '                                 : aName == wxT( "builtin:oce" )  ? s_ocePlugin\n'
            '                                                                    : nullptr;\n'
            '    m_table = ( t && t[0].fn ) ? t : nullptr;\n'
            '    return IsLoaded();\n}\n\n'
            'void* KIPLUGIN_BUILTIN_LIB::GetSymbol( const wxString& aName ) const\n{\n'
            '    for( const KIPLUGIN_BUILTIN_FN* r = m_table; r && r->name; r++ )\n'
            '    {\n'
            '        if( aName == r->name )\n'
            '            return r->fn;\n'
            '    }\n\n'
            '    return nullptr;\n}\n'
            '#endif\n')
p = root / 'plugins/ldr/pluginldr.cpp'
s = p.read_text()
if MARK in s:
    print('already plugins/ldr/pluginldr.cpp')
else:
    p.write_text(s.rstrip('\n') + LDR_TAIL)
    print('patched plugins/ldr/pluginldr.cpp')

# A board whose 3D models are not found says so in the console (the desktop shows an info bar with a dialog behind it):
# which folders KiCad searched for STEP twins of the board's .wrl names, and how many model files each held
patch('3d-viewer/3d_cache/model_substitution_helpers.cpp', [
    ('#include "model_substitution_helpers.h"\n', '#include "model_substitution_helpers.h"\n#include <cstdio>   // ' + MARK + '\n'),
    ('    for( const wxString& dir : gatherScanDirs( aProjectPath, aResolver ) )\n    {\n'
     '        wxArrayString files;\n'
     '        ::CollectFilesLoopSafe( dir, files, wxEmptyString, wxDIR_FILES | wxDIR_DIRS );\n',
     '    // ' + MARK + ': the browser build tells the console where it looked\n'
     '    for( const wxString& dir : gatherScanDirs( aProjectPath, aResolver ) )\n    {\n'
     '        wxArrayString files;\n'
     '        ::CollectFilesLoopSafe( dir, files, wxEmptyString, wxDIR_FILES | wxDIR_DIRS );\n'
     '#ifdef __EMSCRIPTEN__\n'
     '        printf( "kicad: 3D model folder %s: %d files\\n", dir.utf8_str().data(), (int) files.size() );\n'
     '#endif\n'),
])
patch('pcbnew/pcb_edit_frame.cpp', [
    ('#include <pcb_edit_frame.h>\n', '#include <pcb_edit_frame.h>\n#include <env_vars.h>   // ' + MARK + '\n#include <common.h>\n#include <cstdio>\n'),
    ('        const int unresolved = DIALOG_MIGRATE_3D_MODELS::CountUnresolvedWrlReferences( this );\n\n'
     '        if( unresolved > 0 )\n        {\n',
     '        const int unresolved = DIALOG_MIGRATE_3D_MODELS::CountUnresolvedWrlReferences( this );\n\n'
     '        if( unresolved > 0 )\n        {\n'
     '#ifdef __EMSCRIPTEN__\n'
     '            // ' + MARK + ': the console gets the count and where the stock models are expected\n'
     '            printf( "kicad: %d of the board\'s 3D model files were not found (%s = %s)\\n", unresolved,\n'
     '                    ENV_VAR::GetVersionedEnvVarName( wxS( "3DMODEL_DIR" ) ).utf8_str().data(),\n'
     '                    ExpandEnvVarSubstitutions( wxString::Format( wxS( "${%s}" ),\n'
     '                            ENV_VAR::GetVersionedEnvVarName( wxS( "3DMODEL_DIR" ) ) ), &Prj() ).utf8_str().data() );\n'
     '#endif\n'),
])
patch('3d-viewer/3d_cache/3d_plugin_manager.cpp', [
    ('    items = m_ExtMap.equal_range( ext_to_find );\n    std::multimap< const wxString, KICAD_PLUGIN_LDR_3D* >::iterator sL = items.first;\n\n    while( sL != items.second )\n    {\n        if( sL->second->CanRender() )\n        {\n            SCENEGRAPH* sp = sL->second->Load( aFileName.ToUTF8() );\n\n            if( nullptr != sp )\n            {\n                sL->second->GetPluginInfo( aPluginInfo );\n                return sp;\n            }\n        }\n\n        ++sL;\n    }\n',
     '    items = m_ExtMap.equal_range( ext_to_find );\n    std::multimap< const wxString, KICAD_PLUGIN_LDR_3D* >::iterator sL = items.first;\n\n'
     '#ifdef __EMSCRIPTEN__\n'
     '    // ' + MARK + ': the console gets the loader chosen for a file and what it said\n'
     '    if( sL == items.second )\n        printf( "kicad: 3D model type .%s: no loader\\n", ext_to_find.utf8_str().data() );\n'
     '#endif\n\n'
     '    while( sL != items.second )\n    {\n        if( sL->second->CanRender() )\n        {\n            SCENEGRAPH* sp = sL->second->Load( aFileName.ToUTF8() );\n\n            if( nullptr != sp )\n            {\n                sL->second->GetPluginInfo( aPluginInfo );\n                return sp;\n            }\n'
     '#ifdef __EMSCRIPTEN__\n'
     '            printf( "kicad: 3D model %s: the loader gave nothing (%s)\\n", aFileName.utf8_str().data(), sL->second->GetLastError().c_str() );\n'
     '#endif\n'
     '        }\n'
     '#ifdef __EMSCRIPTEN__\n'
     '        else\n            printf( "kicad: 3D model %s: loader not usable (%s)\\n", aFileName.utf8_str().data(), sL->second->GetLastError().c_str() );\n'
     '#endif\n\n'
     '        ++sL;\n    }\n'),
    ('#include <wx/log.h>\n', '#include <wx/log.h>\n#include <cstdio>   // ' + MARK + '\n'),
    ('    wxLogTrace( MASK_3D_PLUGINMGR, wxT( "%s:%s:%d * [DEBUG] plugins loaded" ),\n',
     '#ifdef __EMSCRIPTEN__\n'
     '    // ' + MARK + ': the console gets the loaders the program has\n'
     '    printf( "kicad: 3D model loaders: %d, file types: %d\\n", (int) m_Plugins.size(), (int) m_ExtMap.size() );\n'
     '#endif\n'
     '    wxLogTrace( MASK_3D_PLUGINMGR, wxT( "%s:%s:%d * [DEBUG] plugins loaded" ),\n'),
    ('    if( pluginlist.empty() )\n        return;\n',
     '#ifdef __EMSCRIPTEN__\n'
     '    // ' + MARK + ': the browser program has its model loaders linked in (plugins/ldr KIPLUGIN_BUILTIN_LIB)\n'
     '    pluginlist.push_back( wxT( "builtin:vrml" ) );\n'
     '    pluginlist.push_back( wxT( "builtin:oce" ) );\n'
     '#endif\n\n'
     '    if( pluginlist.empty() )\n        return;\n'),
])
