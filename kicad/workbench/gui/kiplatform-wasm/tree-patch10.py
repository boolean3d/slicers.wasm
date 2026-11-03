# tree-patch10: a stand-in KIFACE in the browser build. The editors are programs of their own there (one static wasm
# cannot load a kiface), and the project manager asks KIWAY::KiFACE for the schematic and PCB faces while loading a
# project (PreloadLibraries, CloseProject): the dlopen path threw IO_ERROR and no project ever loaded. With the stand-in
# a project loads and its tree shows; KIWAY::Player gets no window for an editor (ShowPlayer handles a null: returns -1).
import pathlib, sys
root = pathlib.Path(sys.argv[1])
p = root / "common/kiway.cpp"; s = p.read_text()
old = """    if( doLoad )
    {
        wxString dname = dso_search_path( aFaceId );
"""
new = """    if( doLoad )
    {
#ifdef __EMSCRIPTEN__
        // browser build: no dlopen; a stand-in face so the project manager can load a project (its tree, its
        // settings). Opening an editor window from here is not possible in this build (Player() gets no window).
        struct KIFACE_STANDIN : public KIFACE
        {
            bool OnKifaceStart( PGM_BASE*, int, KIWAY* ) override { return true; }
            void OnKifaceEnd() override {}
            void Reset() override {}
            wxWindow* CreateKiWindow( wxWindow*, int aClassId, KIWAY*, int ) override
            {
                wxLogWarning( wxS( "browser build: no editor window for frame type %d from this program" ), aClassId );
                return nullptr;
            }
            void* IfaceOrAddress( int ) override { return nullptr; }
            void GetActions( std::vector<TOOL_ACTION*>& ) const override {}
        };
        m_kiface[aFaceId] = new KIFACE_STANDIN();
        m_kiface_version[aFaceId] = KIFACE_VERSION;
        return m_kiface[aFaceId];
#endif
        wxString dname = dso_search_path( aFaceId );
"""
if new in s: print("ok    common/kiway.cpp")
else:
    assert s.count(old) == 1; p.write_text(s.replace(old, new)); print("edit  common/kiway.cpp")
print("TREE-PATCH10-OK")
