// wx's SVG reader calls nanosvg with C linkage (nsvgParse, nsvgRasterize...). KiCad's own nanosvg (thirdparty/nanosvg) is
// compiled as C++: its functions are mangled, so wx cannot use them, and its one data table (nsvg__colors) keeps the plain
// name. This C unit holds a second implementation for wx, from the header wx was built against (the slicers' prefix), with
// that table under another name so the two copies can live in one program.
#define nsvg__colors b3d_wx_nsvg_colors
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#define NANOSVG_IMPLEMENTATION
#include <nanosvg/nanosvg.h>
#define NANOSVGRAST_IMPLEMENTATION
#include <nanosvg/nanosvgrast.h>
