// What Orca's GUI calls in libslic3r that the browser build does not have, in the engine's manner
// (engine/stubs): the feature reports itself unsupported instead of the link failing.
//  * SLA hollowing needs OpenVDB (none in the wasm deps): no interior is ever made.
//  * Draco (.drc) export needs Google draco: store_drc says it could not write.
//  * STEP needs OCCT: the engine's Step stub throws on load(), so the mesh dialog never gets a count.
#include "libslic3r/SLA/Hollowing.hpp"
#include "libslic3r/Format/DRC.hpp"
#include "libslic3r/Format/STEP.hpp"
#include <sys/shm.h>
#include <sys/ipc.h>
#include <cerrno>

namespace Slic3r {
namespace sla {
InteriorPtr generate_interior(const TriangleMesh &, const HollowingConfig &, const JobController &) { return {}; }
void InteriorDeleter::operator()(Interior *) {}    // generate_interior never makes one
indexed_triangle_set &get_mesh(Interior &) { static indexed_triangle_set none; return none; }
} // namespace sla

bool store_drc(const char *, TriangleMesh *, int, int) { return false; }
bool store_drc(const char *, ModelObject *, int, int) { return false; }
bool store_drc(const char *, Model *, int, int) { return false; }

unsigned int Step::get_triangle_num(double, double) { return 0; }
unsigned int Step::get_triangle_num_tbb(double, double) { return 0; }
} // namespace Slic3r

// System V shared memory: MediaPlayCtrl's Linux camera path asks for it; a browser has none.
extern "C" {
key_t ftok(const char *, int) { errno = ENOSYS; return -1; }
int shmget(key_t, size_t, int) { errno = ENOSYS; return -1; }
void *shmat(int, const void *, int) { errno = ENOSYS; return (void *) -1; }
int shmdt(const void *) { errno = ENOSYS; return -1; }
int shmctl(int, int, struct shmid_ds *) { errno = ENOSYS; return -1; }
}
