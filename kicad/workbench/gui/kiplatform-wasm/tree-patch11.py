# tree-patch11: no 3D mouse in a tab. Every editor frame makes a 3D-mouse plugin when activated: SPNAV on Linux/BSD,
# the 3Dconnexion navlib plugin (NL_*_PLUGIN, sources not built here) everywhere else, Emscripten included: pcbnew
# aborted on the missing NL_PCBNEW_PLUGIN constructor right after its frame came up.
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
FILES = ["pcbnew/pcb_base_frame.cpp", "eeschema/sch_base_frame.cpp", "gerbview/gerbview_frame.cpp",
         "3d-viewer/3d_viewer/eda_3d_viewer_frame.cpp", "3d-viewer/dialogs/panel_preview_3d_model.cpp",
         "pagelayout_editor/pl_editor_frame.cpp"]
pat = re.compile(r"#if defined\(__linux__\) \|\| defined\(__FreeBSD__\)\n(\s*)(m_spaceMouse = std::make_unique<SPNAV)")
for f in FILES:
    p = root / f; s = p.read_text()
    if "no 3D mouse in a tab" in s: continue
    assert len(pat.findall(s)) == 1, f
    s = pat.sub(lambda m: "#if defined(__EMSCRIPTEN__)   // browser build: no 3D mouse in a tab\n#elif defined(__linux__) || defined(__FreeBSD__)\n" + m.group(1) + m.group(2), s)
    p.write_text(s)
print("tree-patch11 ok")
