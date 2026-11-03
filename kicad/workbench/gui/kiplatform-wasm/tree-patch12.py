# tree-patch12: "open with the default program" hands the file to the person as a browser download.
# A tab has no other program to open a file with (the wx port's wxLaunchDefaultApplication returns false): the Plot dialog's
# "Open Output Directory" did nothing, so plotted Gerbers + drill files stayed in the tab's file system. In the browser build,
# LaunchExternal (common/launch_ext.cpp, KiCad's own "open with the system" call) downloads a file as itself and a folder as
# <folder>.zip (stored, every file below it); the plot dialog and the project tree's default case call LaunchExternal
# instead of wxLaunchDefaultApplication (upstream already routes other "open" buttons through it).
import pathlib, sys
root = pathlib.Path(sys.argv[1])

def edit(f, old, new, mark):
    p = root / f; s = p.read_text()
    if mark in s: return
    assert s.count(old) == 1, (f, old[:60])
    p.write_text(s.replace(old, new))

JS = r'''
// browser build: hand the file, or the folder as a zip, to the person as a download. Runs on the page thread, where the
// file system and the document are (EM_JS: a code block with commas cannot go through the EM_ASM macros).
EM_JS( int, b3d_hand_to_browser, ( const char* aPath ), {
        var path = UTF8ToString( aPath );
        try {
            var st = FS.stat( path ), isDir = FS.isDir( st.mode );
            var base = path.replace( /[/]+$/, "" ).split( "/" ).pop() || "files";
            var parts = [], name = base, type = "application/octet-stream";
            if( !isDir ) { parts = [ FS.readFile( path ) ]; }
            else {
                var T = new Uint32Array( 256 );
                for( var n = 0; n < 256; n++ ) { var c = n; for( var k = 0; k < 8; k++ ) c = c & 1 ? 0xEDB88320 ^ ( c >>> 1 ) : c >>> 1; T[n] = c >>> 0; }
                var crc = function( b ) { var c = 0xFFFFFFFF; for( var i = 0; i < b.length; i++ ) c = T[( c ^ b[i] ) & 255] ^ ( c >>> 8 ); return ( c ^ 0xFFFFFFFF ) >>> 0; };
                var files = [];
                var walk = function( d, rel ) {
                    FS.readdir( d ).sort().forEach( function( e ) {
                        if( e === "." || e === ".." ) return;
                        var f = d + "/" + e, s = FS.stat( f );
                        if( FS.isDir( s.mode ) ) walk( f, rel + e + "/" ); else files.push( [ rel + e, FS.readFile( f ), s.mtime ] );
                    } );
                };
                walk( path.replace( /[/]+$/, "" ), "" );
                var central = [], off = 0, enc = new TextEncoder();
                files.forEach( function( f ) {
                    var nm = enc.encode( f[0] ), data = f[1], c = crc( data ), t = new Date( f[2] );
                    var dt = ( ( t.getHours() << 11 ) | ( t.getMinutes() << 5 ) | ( t.getSeconds() >> 1 ) ) & 0xFFFF;
                    var dd = ( ( Math.max( t.getFullYear() - 1980, 0 ) << 9 ) | ( ( t.getMonth() + 1 ) << 5 ) | t.getDate() ) & 0xFFFF;
                    var h = new DataView( new ArrayBuffer( 30 ) );
                    h.setUint32( 0, 0x04034b50, true ); h.setUint16( 4, 20, true ); h.setUint16( 6, 0x0800, true ); h.setUint16( 8, 0, true );
                    h.setUint16( 10, dt, true ); h.setUint16( 12, dd, true ); h.setUint32( 14, c, true );
                    h.setUint32( 18, data.length, true ); h.setUint32( 22, data.length, true ); h.setUint16( 26, nm.length, true );
                    parts.push( h.buffer, nm, data );
                    var g = new DataView( new ArrayBuffer( 46 ) );
                    g.setUint32( 0, 0x02014b50, true ); g.setUint16( 4, 20, true ); g.setUint16( 6, 20, true ); g.setUint16( 8, 0x0800, true );
                    g.setUint16( 12, dt, true ); g.setUint16( 14, dd, true ); g.setUint32( 16, c, true );
                    g.setUint32( 20, data.length, true ); g.setUint32( 24, data.length, true ); g.setUint16( 28, nm.length, true );
                    g.setUint32( 42, off, true );
                    central.push( g.buffer, nm );
                    off += 30 + nm.length + data.length;
                } );
                var size = 0; central.forEach( function( b ) { size += b.byteLength; } );
                var e = new DataView( new ArrayBuffer( 22 ) );
                e.setUint32( 0, 0x06054b50, true ); e.setUint16( 8, files.length, true ); e.setUint16( 10, files.length, true );
                e.setUint32( 12, size, true ); e.setUint32( 16, off, true );
                parts = parts.concat( central, [ e.buffer ] );
                name = base + ".zip"; type = "application/zip";
            }
            var url = URL.createObjectURL( new Blob( parts, { type: type } ) ), a = document.createElement( "a" );
            a.href = url; a.download = name; a.style.display = "none"; document.body.appendChild( a ); a.click(); a.remove();
            setTimeout( function() { URL.revokeObjectURL( url ); }, 60000 );
            console.log( "kicad: handed " + path + " to the browser as " + name );
            return 1;
        } catch( err ) { console.error( "kicad: could not hand " + path + " to the browser: " + err ); return 0; }
} );
'''
CALL = '''
    return emscripten_sync_run_in_main_runtime_thread( EM_FUNC_SIG_II, b3d_hand_to_browser,
                                                       aPath.utf8_string().c_str() ) != 0;
'''

edit("common/launch_ext.cpp", "#include <wx/utils.h>\n",
     "#include <wx/utils.h>\n#ifdef __EMSCRIPTEN__\n#include <emscripten.h>   // browser build: LaunchExternal = a download\n#include <emscripten/threading.h>\n" + JS + "#endif\n",
     "browser build: LaunchExternal = a download")
edit("common/launch_ext.cpp", "bool LaunchExternal( const wxString& aPath )\n{\n#ifdef __WXMAC__\n",
     "bool LaunchExternal( const wxString& aPath )\n{\n#if defined( __EMSCRIPTEN__ )" + CALL + "\n#elif defined( __WXMAC__ )\n",
     "emscripten_sync_run_in_main_runtime_thread( EM_FUNC_SIG_II, b3d_hand")
edit("pcbnew/dialogs/dialog_plot.cpp", "    wxLaunchDefaultApplication( path );\n}\n",
     "    LaunchExternal( path );   // browser build: the folder downloads as a zip\n}\n", "LaunchExternal( path );   // browser build")
edit("pcbnew/dialogs/dialog_plot.cpp", "#include <pcb_plotter.h>\n", "#include <pcb_plotter.h>\n#include <launch_ext.h>\n", "#include <launch_ext.h>")
edit("kicad/project_tree_item.cpp", "    default:\n        wxLaunchDefaultApplication( fullFileName );\n",
     "    default:\n        LaunchExternal( fullFileName );   // browser build: a download\n", "LaunchExternal( fullFileName );   // browser build")
p = root / "kicad/project_tree_item.cpp"; s = p.read_text()
if "#include <launch_ext.h>" not in s:
    i = s.index("#include "); p.write_text(s[:i] + "#include <launch_ext.h>\n" + s[i:])
print("tree-patch12 ok")
