// <CGAL/gmpxx.h> for a CGAL without GMP (the browser engine builds CGAL with CGAL_DISABLE_GMP).
//
// Bambu Studio's bundled libigl (src/libigl/igl/copyleft/cgal/assign_scalar.h) includes this header outside
// Windows and declares three assign_scalar() overloads on CGAL::Simple_cartesian<mpq_class>::FT. Nothing in
// Bambu Studio calls them (its Windows build has no such overloads at all); they only have to compile.
// Without GMP, mpq_class is an exact rational of CGAL's own (Quotient<MP_Float>), a type distinct from
// Epeck::FT, so the overloads do not collide. With GMP the real header is used.
// This directory is searched before CGAL's own include directory for libslic3r_cgal only.
#pragma once

#include <CGAL/config.h>

#if !defined(CGAL_DISABLE_GMP) && defined(CGAL_USE_GMP)
#include_next <CGAL/gmpxx.h>
#else
#include <CGAL/MP_Float.h>
#include <CGAL/Quotient.h>
using mpq_class = CGAL::Quotient<CGAL::MP_Float>;
#endif
