// CGAL/gmpxx.h for a CGAL without GMP (the browser engine builds CGAL with CGAL_DISABLE_GMP).
//
// Orca v2.3.2's bundled libigl (igl/copyleft/cgal/assign_scalar.h) includes this header on every
// non-Windows build and declares three assign_scalar() overloads on Simple_cartesian<mpq_class>::FT.
// Newer Orca dropped them; nothing in Orca calls them. Without GMP, mpq_class here is CGAL's own exact
// rational, Quotient<MP_Float>: a type distinct from Epeck::FT and from the engine's placeholder
// Epeck_with_sqrt::FT, so the overloads stay separate, and their bodies (to_interval, abs, subtraction)
// compile as written. With GMP the real header is used.
// This directory is searched before CGAL's own include directory, for libslic3r_cgal only.
#pragma once

#include <CGAL/config.h>

#ifndef CGAL_DISABLE_GMP
#include_next <CGAL/gmpxx.h>
#else
#include <CGAL/MP_Float.h>
#include <CGAL/Quotient.h>
typedef CGAL::Quotient<CGAL::MP_Float> mpq_class;
#endif
