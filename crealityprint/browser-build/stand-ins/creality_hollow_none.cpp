// Hollow (the Hollow tool's "hollow the part" step, GUI/MeshHollow.cpp) builds the inner shell with OpenVDB, which
// the browser build does not have (the slicing engine is built without it). The part is left as it is and the
// person is told so, instead of a crash or a part that silently stays solid.
#include "slic3r/GUI/MeshHollow.hpp"
#include "slic3r/GUI/GUI.hpp"
#include "slic3r/GUI/I18N.hpp"

namespace Slic3r {
void MeshHollow(ModelVolumePtrs&, float)
{
    GUI::show_error(nullptr, _u8L("Hollowing is not in the browser version of Creality Print. The part is left solid."));
}
} // namespace Slic3r

// The Drill tool first tries the hole with CGAL here (SLA/Hollowing.cpp, a file the browser engine leaves out for its
// OpenVDB half). Answering "drilling failed" sends the tool down its own second route, the mcut boolean
// (GLGizmoDrill.cpp: if (ret) MeshBoolean::mcut::make_boolean(..., "A_NOT_B")), so the hole is still cut.
#include "libslic3r/SLA/Hollowing.hpp"

namespace Slic3r { namespace sla {
int hollow_mesh_and_drill(TriangleMesh&, TriangleMesh&, std::vector<TriangleMesh>&)
{
    return static_cast<int>(HollowMeshResult::DrillingFailed);
}
}} // namespace Slic3r::sla
