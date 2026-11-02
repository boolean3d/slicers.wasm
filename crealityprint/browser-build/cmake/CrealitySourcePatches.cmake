# Creality Print's own libslic3r files, changed for the browser build (read by the engine through ENGINE_EXTRA_PATCHES,
# after its OrcaSlicer patches; same orca_patch_source() form: exact text, exactly once, or the configure step stops).

# 1. PrintObject.cpp: the "Field" sparse infill computes a signed distance field with OpenVDB, then hands it to
#    Creality's closed FillTensor library. Neither exists in the browser (the engine has no OpenVDB; FillTensor ships
#    only as desktop binaries). The OpenVDB block is left out and the object asks the stand-in for its tensor, which
#    stops the slice with a plain "not in the browser version" message (stand-ins/creality_closed_addons.cpp).
#    The pattern is also left out of the menus (CrealityBrowserEdits); this is for projects made on the desktop.
orca_patch_source(PrintObject.cpp patched
    FIND [==[#include "OpenVDBUtils.hpp"
]==]
    REPLACE ""
    FIND [==[#include <openvdb/openvdb.h>
#include <openvdb/tools/Interpolation.h>
#include <openvdb/tools/MeshToVolume.h>
]==]
    REPLACE ""
    FIND [==[            if (needs_field) {
                BOOST_LOG_TRIVIAL(info) << "FillField: Computing OpenVDB SDF...";]==]
    REPLACE [==[            if (needs_field)
                FillTensor_Create(0);   // browser build: refuses with the "not in the browser version" message
#if 0   // browser build: OpenVDB signed distance field for Creality's closed FillTensor
            if (needs_field) {
                BOOST_LOG_TRIVIAL(info) << "FillField: Computing OpenVDB SDF...";]==]
    FIND [==[                                    });
                            }
                        }
                    }
                }
            }
        }
        tbb::parallel_for(tbb::blocked_range<size_t>(0, m_layers.size()),]==]
    REPLACE [==[                                    });
                            }
                        }
                    }
                }
            }
#endif
        }
        tbb::parallel_for(tbb::blocked_range<size_t>(0, m_layers.size()),]==])
list(APPEND ORCA_LIBSLIC3R_PATCHED "PrintObject.cpp=${patched}")

# 2. Sources the browser build does not compile (besides the engine's ORCA_LIBSLIC3R_EXCLUDED):
#    Format/AssimpModel.cpp needs assimp: stand-ins/creality_engine_stubs.cpp answers instead (CMakeLists.txt).
list(APPEND ORCA_LIBSLIC3R_EXCLUDED Format/AssimpModel.cpp)
