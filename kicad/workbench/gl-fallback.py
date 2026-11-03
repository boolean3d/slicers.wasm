#!/usr/bin/env python3
# gl-fallback.py <kicad tree>: the browser build never leaves a person without a board.
#  - no WebGL2 in this tab -> the software drawing, decided before an OpenGL canvas is made
#  - a lost WebGL context while drawing -> an error KiCad's own recovery catches -> the software drawing
#  - every OpenGL -> software switch is a console line, never a box
#  - supersampling (KiCad's default smoothing, 2x the device pixels per side) is skipped on screens scaled 1.5x or more:
#    there it means 9-16x the page's pixels in several buffers, more than a laptop's shared graphics memory holds
# Each edit is inside #ifdef __EMSCRIPTEN__; the desktop build is unchanged. Rerun-safe.
import sys, pathlib

root = pathlib.Path(sys.argv[1])
MARK = 'kicad-play-4 gl-fallback'


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


GAL = 'common/gal/opengl/opengl_gal.cpp'
patch(GAL, [
    ('#include <glsl_kicad_vert.h>\n',
     '#include <glsl_kicad_vert.h>\n'
     '\n#ifdef __EMSCRIPTEN__\n'
     '// ' + MARK + ': WebGL2 probe, lost-context check, smoothing on scaled screens\n'
     '#include <emscripten.h>\n#include <emscripten/html5.h>\n\n'
     '// Can this thread make a WebGL2 context at all (the GL canvases live on OffscreenCanvases in this worker)?\n'
     'EM_JS( int, kigl_webgl2_available, (), {\n'
     '    try {\n'
     '        if( typeof OffscreenCanvas === "undefined" ) return 0;\n'
     '        var gl = new OffscreenCanvas( 1, 1 ).getContext( "webgl2" );\n'
     '        if( !gl ) return 0;\n'
     '        var lose = gl.getExtension( "WEBGL_lose_context" );\n'
     '        if( lose ) lose.loseContext();\n'
     '        return 1;\n'
     '    } catch( e ) { return 0; }\n'
     '} );\n'
     '#endif\n\n'
     'namespace\n{\n'
     '// The smoothing the compositor really uses: on a browser screen scaled 1.5x or more, supersampling is skipped\n'
     'KIGFX::GAL_ANTIALIASING_MODE compositorAAMode( KIGFX::GAL_ANTIALIASING_MODE aMode, double aScale )\n{\n'
     '#ifdef __EMSCRIPTEN__\n'
     '    if( aMode == KIGFX::GAL_ANTIALIASING_MODE::AA_HIGHQUALITY && aScale >= 1.5 )\n'
     '        return KIGFX::GAL_ANTIALIASING_MODE::AA_NONE;\n'
     '#endif\n'
     '    (void) aScale;\n'
     '    return aMode;\n}\n}\n'),
    ('    m_compositor = new OPENGL_COMPOSITOR;\n    m_compositor->SetAntialiasingMode( m_options.antialiasing_mode );\n',
     '    m_compositor = new OPENGL_COMPOSITOR;\n'
     '    m_compositor->SetAntialiasingMode( compositorAAMode( m_options.antialiasing_mode, GetScaleFactor() ) );\n'),
    ('    if( m_isContextValid && m_options.antialiasing_mode != m_compositor->GetAntialiasingMode() )\n    {\n'
     '        m_compositor->SetAntialiasingMode( m_options.antialiasing_mode );\n',
     '    if( m_isContextValid\n'
     '        && compositorAAMode( m_options.antialiasing_mode, GetScaleFactor() ) != m_compositor->GetAntialiasingMode() )\n    {\n'
     '        m_compositor->SetAntialiasingMode( compositorAAMode( m_options.antialiasing_mode, GetScaleFactor() ) );\n'),
    ('    if( m_options.antialiasing_mode != m_compositor->GetAntialiasingMode() )\n    {\n'
     '        m_compositor->SetAntialiasingMode( m_options.antialiasing_mode );\n',
     '    if( compositorAAMode( m_options.antialiasing_mode, GetScaleFactor() ) != m_compositor->GetAntialiasingMode() )\n    {\n'
     '        m_compositor->SetAntialiasingMode( compositorAAMode( m_options.antialiasing_mode, GetScaleFactor() ) );\n'),
    ('    if( !m_isInitialized )\n        init();\n\n    // Set up the view port\n',
     '#ifdef __EMSCRIPTEN__\n'
     '    // A lost WebGL context draws nothing and reports nothing: make it an error KiCad\'s recovery catches\n'
     '    if( emscripten_is_webgl_context_lost( emscripten_webgl_get_current_context() ) )\n'
     '        throw std::runtime_error( "The browser lost the WebGL context" );\n'
     '#endif\n\n'
     '    if( !m_isInitialized )\n        init();\n\n    // Set up the view port\n'),
    ('    wxString retVal = wxEmptyString;\n\n    wxFrame* testFrame',
     '    wxString retVal = wxEmptyString;\n\n'
     '#ifdef __EMSCRIPTEN__\n'
     '    // No WebGL2 here (graphics card blocked by the browser, no OffscreenCanvas): decided before a GL canvas is made\n'
     '    if( !kigl_webgl2_available() )\n'
     '    {\n'
     '        cached = wxString( wxS( "WebGL2 is not available in this browser tab" ) );\n'
     '        return *cached;\n'
     '    }\n'
     '#endif\n\n'
     '    wxFrame* testFrame'),
])

UTILS = 'common/gal/opengl/utils.cpp'
patch(UTILS, [
    ('#include <wx/log.h> // wxLogTrace\n',
     '#include <wx/log.h> // wxLogTrace\n'
     '#ifdef __EMSCRIPTEN__\n#include <emscripten/html5.h>\n#endif\n'),
    ('    int      result = glGetError();\n    wxString errorMsg;\n',
     '    int      result = glGetError();\n    wxString errorMsg;\n\n'
     '#ifdef __EMSCRIPTEN__\n'
     '    // ' + MARK + ': once the browser has lost the WebGL context every call is a no-op and\n'
     '    // glGetError answers CONTEXT_LOST_WEBGL: nothing the caller did went wrong, and the teardown that follows the loss\n'
     '    // (the compositor\'s destructor, the canvas going away) must run through without a box\n'
     '    if( result == 0x9242 /* CONTEXT_LOST_WEBGL */\n'
     '        || emscripten_is_webgl_context_lost( emscripten_webgl_get_current_context() ) )\n'
     '        return GL_NO_ERROR;\n'
     '#endif\n'),
])

PANEL = 'common/draw_panel_gal.cpp'
patch(PANEL, [
    ('    const bool gpuOutOfMemory = dynamic_cast<const KIGFX::GPU_OOM_ERROR*>( &aError ) != nullptr;\n',
     '    const bool gpuOutOfMemory = dynamic_cast<const KIGFX::GPU_OOM_ERROR*>( &aError ) != nullptr;\n'
     '#ifdef __EMSCRIPTEN__\n'
     '    // ' + MARK + ': in a browser tab a second WebGL context fails the same way: straight to the software drawing\n'
     '    m_glRecoveryAttempted = true;\n'
     '#endif\n'),
    ('            SwitchBackend( GAL_FALLBACK );\n\n'
     '            DisplayInfoMessage( m_parent, _( "Could not use OpenGL, falling back to software rendering" ),\n'
     '                                wxString( aError.what() ) );\n',
     '            SwitchBackend( GAL_FALLBACK );\n\n'
     '#ifdef __EMSCRIPTEN__\n'
     '            printf( "kicad: OpenGL stopped (%s), drawing in software\\n", aError.what() );\n'
     '#else\n'
     '            DisplayInfoMessage( m_parent, _( "Could not use OpenGL, falling back to software rendering" ),\n'
     '                                wxString( aError.what() ) );\n'
     '#endif\n'),
    ('                    aGalType = GAL_FALLBACK;\n'
     '                    DisplayInfoMessage(\n'
     '                            m_parent,\n'
     '                            _( "Could not use OpenGL, falling back to software rendering" ),\n'
     '                            errormsg );\n',
     '                    aGalType = GAL_FALLBACK;\n'
     '#ifdef __EMSCRIPTEN__\n'
     '                    printf( "kicad: OpenGL not usable (%s), drawing in software\\n", errormsg.utf8_str().data() );\n'
     '#else\n'
     '                    DisplayInfoMessage(\n'
     '                            m_parent,\n'
     '                            _( "Could not use OpenGL, falling back to software rendering" ),\n'
     '                            errormsg );\n'
     '#endif\n'),
    ('    catch( std::runtime_error& err )\n    {\n        // Create a dummy GAL\n'
     '        new_gal = new KIGFX::GAL( m_options );\n        aGalType = GAL_TYPE_NONE;\n'
     '        DisplayErrorMessage( m_parent, _( "Error switching GAL backend" ), wxString( err.what() ) );\n'
     '        result = false;\n    }\n',
     '    catch( std::runtime_error& err )\n    {\n'
     '#ifdef __EMSCRIPTEN__\n'
     '        // The OpenGL canvas failed to come up: the software drawing, never a dummy canvas or a box\n'
     '        if( aGalType == GAL_TYPE_OPENGL )\n'
     '        {\n'
     '            printf( "kicad: OpenGL failed to start (%s), drawing in software\\n", err.what() );\n'
     '            new_gal = new KIGFX::CAIRO_GAL( m_options, this, this, this );\n'
     '            aGalType = GAL_FALLBACK;\n'
     '        }\n'
     '        else\n'
     '#endif\n'
     '        {\n'
     '        // Create a dummy GAL\n'
     '        new_gal = new KIGFX::GAL( m_options );\n        aGalType = GAL_TYPE_NONE;\n'
     '        DisplayErrorMessage( m_parent, _( "Error switching GAL backend" ), wxString( err.what() ) );\n'
     '        result = false;\n'
     '        }\n    }\n'),
])
