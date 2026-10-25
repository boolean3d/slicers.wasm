# Eigen 5 changed the version macros Orca v2.3.2's FindEigen3 parses: use Eigen's own package config.
find_package(Eigen3 ${Eigen3_FIND_VERSION} CONFIG REQUIRED)
set(EIGEN3_FOUND TRUE)
set(EIGEN3_VERSION_OK TRUE)
get_target_property(EIGEN3_INCLUDE_DIR Eigen3::Eigen INTERFACE_INCLUDE_DIRECTORIES)
