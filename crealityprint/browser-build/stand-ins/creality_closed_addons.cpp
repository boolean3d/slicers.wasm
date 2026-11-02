// Stand-ins for Creality Print's three closed-source add-ons, which Creality ships only as prebuilt Windows, macOS and
// Linux libraries (no source, nothing for WebAssembly):
//   cr_tpms_library        the three "gradual TPMS" sparse infill patterns  (deps/CR_TPMS)
//   cr_FillTensor_library  the "Field" sparse infill pattern                 (deps/CR_CLOSED/CR_FILLTENSOR)
//   cr_km_recipe           colour mixing: recipes for a target colour       (deps/CR_KM_RECIPE)
// Their public headers (Creality's, in the same AGPL source tree) are compiled against unchanged. The browser build
// leaves those four infill patterns out of the menus and shows a notice instead of the colour mixing dialog
// (cmake/CrealityBrowserEdits.cmake); these stand-ins are what remains reachable (a project made on the desktop that
// asks for one of them, the start-up resource call), and each one says plainly what is missing instead of failing
// silently or crashing.
#include "cr_tpms_library.h"
#include "cr_FillTensor_library.h"
#include "cr_km_recipe.h"

#include <cstdio>
#include <cstring>

#include "libslic3r/Exception.hpp"

namespace {
const char *const kNotInBrowser = " is not in the browser version of Creality Print (it uses Creality's closed code). "
                                  "Choose another sparse infill pattern.";

[[noreturn]] void refuse_infill(const char *pattern)
{
    throw Slic3r::SlicingError(std::string("The \"") + pattern + "\" sparse infill pattern" + kNotInBrowser);
}
} // namespace

extern "C" {

// --- cr_tpms_library ------------------------------------------------------------------------------------------------
float scalar_function_test(float, float, float, float, float, float, float, float, float, int, int, float, float)
{
    refuse_infill("Gradual TPMS");
}

// --- cr_FillTensor_library ------------------------------------------------------------------------------------------
// PrintObject::infill() calls FillTensor_Create once per object before any layer is filled: the slice stops there
// with the notice above.
FillTensorHandle FillTensor_Create(int) { refuse_infill("Field"); }
void FillTensor_Destroy(FillTensorHandle) {}
void FillTensor_SetParams(FillTensorHandle, float, float, float) {}
int FillTensor_SetFieldAndCompute(FillTensorHandle, const float *, int, int, int, float, float, float, float) { return -1; }
float FillTensor_Query(FillTensorHandle, float, float, float) { return 0.f; }
void FillTensor_QueryBatch(FillTensorHandle, const float *, float *results, int count)
{
    for (int i = 0; i < count; ++i)
        results[i] = 0.f;
}

// --- cr_km_recipe ---------------------------------------------------------------------------------------------------
// Every recipe call answers "no recipe" (non-zero / invalid), the documented failure the callers already handle.
// The two hex helpers are plain "#RRGGBB" text conversion, not the mixing model, and keep their meaning.
int c3dkm_hex_to_rgb(const char *hex, C3dkmSrgb *out_rgb)
{
    unsigned r, g, b;
    if (!hex || !out_rgb)
        return 0;
    if (*hex == '#')
        ++hex;
    if (std::strlen(hex) != 6 || std::sscanf(hex, "%2x%2x%2x", &r, &g, &b) != 3)
        return 0;
    *out_rgb = C3dkmSrgb{(unsigned char) r, (unsigned char) g, (unsigned char) b};
    return 1;
}
int c3dkm_rgb_to_hex(C3dkmSrgb rgb, char *out_hex)
{
    if (!out_hex)
        return 0;
    std::snprintf(out_hex, 8, "#%02X%02X%02X", rgb.r, rgb.g, rgb.b);
    return 1;
}
double c3dkm_function(double) { return 0.; }
double c3dkm_inverse(double) { return 0.; }
int c3dkm_mix_spectra(const C3dkmSpectrum *, const int *, unsigned int, double *) { return -1; }
C3dkmXyz c3dkm_reflectance_to_xyz(const double *) { return C3dkmXyz{0., 0., 0.}; }
C3dkmLab c3dkm_xyz_to_lab(C3dkmXyz) { return C3dkmLab{0., 0., 0.}; }
C3dkmSrgb c3dkm_lab_to_srgb(C3dkmLab) { return C3dkmSrgb{0, 0, 0}; }
C3dkmLab c3dkm_srgb_to_lab(C3dkmSrgb) { return C3dkmLab{0., 0., 0.}; }
double c3dkm_delta_e76(C3dkmLab, C3dkmLab) { return 0.; }

static int no_recipe(C3dRecipeResult *out)
{
    if (out) {
        out->valid = 0;
        out->component_count = 0;
        out->matched_color_hex[0] = 0;
    }
    return -1;
}
int c3d_recipe_recommend_from_physical_filaments(C3dkmSrgb, const C3dkmSrgb *, const unsigned int *, unsigned int,
                                                 const char *, C3dRecipeResult *out)
{
    return no_recipe(out);
}
int c3d_recipe_lookup_standard_recipe(C3dkmSrgb, int, const char *, C3dRecipeResult *out) { return no_recipe(out); }
int c3d_recipe_has_base_color_spectrum(int, const char *, const char *) { return 0; }
void c3d_recipe_set_resources_dir(const char *) {}

static int no_recipe(CRCloseRecipeResult *out)
{
    if (out) {
        out->valid = 0;
        out->component_count = 0;
        out->matched_color_hex = nullptr;
        out->components = nullptr;
    }
    return -1;
}
int cr_close_recommend_from_physical_filaments(unsigned char, unsigned char, unsigned char, const CRCloseFilament *,
                                               unsigned int, const char *, CRCloseRecipeResult *out)
{
    return no_recipe(out);
}
int cr_close_lookup_standard_recipe(unsigned char, unsigned char, unsigned char, int, const char *, CRCloseRecipeResult *out)
{
    return no_recipe(out);
}
int cr_close_has_base_color_spectrum(int, const char *, const char *) { return 0; }
// "#000000" is the library's own "no data" answer: ColorDecomposeSupport then uses its built-in colour.
const char *cr_close_get_base_official_hex(int, const char *, const char *) { return "#000000"; }
int cr_close_km_blend_color_multi_hex(const char *const *, const int *, unsigned int, char *out_hex)
{
    if (out_hex)
        out_hex[0] = 0;
    return -1;
}
// Called at every start-up (CrealityPrint.cpp, BaseColorSpectraCache): nothing to point at.
void cr_close_set_resources_dir(const char *) {}

} // extern "C"
