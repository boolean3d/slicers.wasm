// Replaces Creality Print's src/libslic3r/Format/AssimpModel.cpp (assimp) in the browser build, as the engine's
// stubs/Format/AssimpImport.cpp does for the glTF path: Model::read_from_file() calls load_assimp_model() for
// .dae/.3ds/.ply/.off files, and the browser build has no assimp. Says so in the program's own error box.
#include "libslic3r/Format/AssimpModel.hpp"

#include "Unsupported.hpp"   // the engine's stubs/ folder

namespace Slic3r {

bool load_assimp_model(const char * /*path*/, Model * /*model*/, bool & /*is_cancel*/, ImportStepProgressFn /*stepFn*/)
{
    browser_engine::throw_unsupported("DAE/3DS/PLY/OFF import");
}

} // namespace Slic3r
