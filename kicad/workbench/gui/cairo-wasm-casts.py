# cairo 1.16 hands two-argument line_to callbacks to the spline decomposer through a cast to its three-argument
# cairo_spline_add_point_func_t. Native code shrugs; WebAssembly checks the signature of every indirect call and
# traps ("null function or function signature mismatch" under KIGFX::CAIRO_GAL_BASE::DrawCircle, kicad-spike-4,
# 10-25). Each cast becomes a small three-argument adapter. Usage: cairo-wasm-casts.py <cairo source dir>; idempotent.
import pathlib, sys
root = pathlib.Path(sys.argv[1]) / "src"
def sub(name, a, b, n=1):
    p = root / name; s = p.read_text()
    if b in s: return
    assert s.count(a) == n, (name, a[:50], s.count(a))
    p.write_text(s.replace(a, b))
ADAPTER = """
/* wasm: the spline decomposer calls with a tangent the plain line_to does not take */
static cairo_status_t
%(name)s (void *closure, const cairo_point_t *point, const cairo_slope_t *tangent)
{
    return %(target)s (closure, point);
}
"""
def adapter(name, target): return ADAPTER % dict(name=name, target=target)

# fill: adapter after _cairo_filler_line_to, cast replaced
sub("cairo-path-fill.c", "static cairo_status_t\n_cairo_filler_curve_to (void", adapter("_cairo_filler_add_point", "_cairo_filler_line_to") + "\nstatic cairo_status_t\n_cairo_filler_curve_to (void")
sub("cairo-path-fill.c", "(cairo_spline_add_point_func_t)_cairo_filler_line_to, filler,", "_cairo_filler_add_point, filler,")
# in-fill
sub("cairo-path-in-fill.c", "static cairo_status_t\n_cairo_in_fill_curve_to (void", adapter("_cairo_in_fill_add_point", "_cairo_in_fill_line_to") + "\nstatic cairo_status_t\n_cairo_in_fill_curve_to (void")
sub("cairo-path-in-fill.c", "(cairo_spline_add_point_func_t)_cairo_in_fill_line_to,", "_cairo_in_fill_add_point,")
# stroke (polygon): two line_to variants; _cairo_stroker_spline_to already takes the tangent
sub("cairo-path-stroke.c", "static cairo_status_t\n_cairo_stroker_curve_to (void", adapter("_cairo_stroker_add_point", "_cairo_stroker_line_to") + adapter("_cairo_stroker_add_point_dashed", "_cairo_stroker_line_to_dashed") + "\nstatic cairo_status_t\n_cairo_stroker_curve_to (void")
sub("cairo-path-stroke.c", "(cairo_spline_add_point_func_t) _cairo_stroker_line_to_dashed :\n\t(cairo_spline_add_point_func_t) _cairo_stroker_line_to;", "_cairo_stroker_add_point_dashed :\n\t_cairo_stroker_add_point;")
sub("cairo-path-stroke.c", "(cairo_spline_add_point_func_t) _cairo_stroker_line_to_dashed :\n\t(cairo_spline_add_point_func_t) _cairo_stroker_spline_to;", "_cairo_stroker_add_point_dashed :\n\t_cairo_stroker_spline_to;")
# stroke (traps)
sub("cairo-path-stroke-traps.c", "static cairo_status_t\ncurve_to_dashed (void *closure,", adapter("add_point_dashed", "line_to_dashed") + "\nstatic cairo_status_t\ncurve_to_dashed (void *closure,")
sub("cairo-path-stroke-traps.c", "func = (cairo_spline_add_point_func_t)line_to_dashed;", "func = add_point_dashed;")
# path interpreter: the flattening callback's line_to is a field; the adapter takes the cpf itself
sub("cairo-path-fixed.c", "static cairo_status_t\n_cpf_curve_to (void", """static cairo_status_t
_cpf_add_point (void *closure, const cairo_point_t *point, const cairo_slope_t *tangent)
{
    cpf_t *cpf = closure;   /* wasm: a three-argument adapter for the two-argument line_to */

    return cpf->line_to (cpf->closure, point);
}

static cairo_status_t
_cpf_curve_to (void""")
sub("cairo-path-fixed.c", "(cairo_spline_add_point_func_t)cpf->line_to,\n\t\t\t      cpf->closure,", "_cpf_add_point,\n\t\t\t      cpf,")
print("cairo casts ok")
