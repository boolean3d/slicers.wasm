# Creality Print's GUI, changed where its closed add-ons show (stand-ins/creality_closed_addons.cpp takes the
# libraries' place). Read by CMakeLists.txt after Creality's src/slic3r is added; orca_gui_patch() form (exact text,
# exactly once).

# 1. Sparse infill menu: Creality's Tab fills the menu from its own list and, when the current pattern is not in it,
#    moves the setting to CrossHatch (its "AI infill" path does the same). The three Gradual TPMS patterns and
#    "Adaptive TPMS" (ipField) are taken out of that list: they run Creality's closed code.
orca_gui_patch(libslic3r_gui slic3r/GUI/Tab.cpp
    FIND [==[            ipTpmsD,
            ipGradualTpmsG,
            ipGradualTpmsD,
            ipGradualTpmsFK,
            ipTpmsFK,]==]
    REPLACE [==[            ipTpmsD,
            // browser build: Gradual TPMS-G/-D/-FK use Creality's closed code (cr_tpms), not in the browser version
            ipTpmsFK,]==]
    FIND [==[            ipLateralLattice,
            ipField,
        }; ]==]
    REPLACE [==[            ipLateralLattice,
            // browser build: Adaptive TPMS (ipField) uses Creality's closed code (cr_FillTensor), not in the browser version
        }; ]==])

# 2. Colour mixing (filament right-click > Decompose Color, and the texture import's mixed filaments): the recipes
#    come from Creality's closed cr_km_recipe. Both ways in say so instead of opening a dialog with no answers.
set(_cr_mixing_notice [==[Slic3r::GUI::MessageDialog(nullptr, _L("Colour mixing is not in the browser version of Creality Print (it uses Creality's closed code)."), _L("Decompose Color"), wxOK | wxICON_INFORMATION).ShowModal();]==])
orca_gui_patch(libslic3r_gui slic3r/GUI/FilamentPanel.cpp
    FIND [==[void MaterialContextMenu::OnDecomposeColor()
{]==]
    REPLACE "void MaterialContextMenu::OnDecomposeColor()
{
#ifdef __EMSCRIPTEN__
    ${_cr_mixing_notice}
    return;
#endif")
orca_gui_patch(libslic3r_gui slic3r/GUI/TextureImportDialog.cpp
    FIND [==[bool TextureImportDialog::add_decomposed_mixed_filament(size_t row_index)
{]==]
    REPLACE "bool TextureImportDialog::add_decomposed_mixed_filament(size_t row_index)
{
#ifdef __EMSCRIPTEN__
    ${_cr_mixing_notice}
    return false;
#endif")
