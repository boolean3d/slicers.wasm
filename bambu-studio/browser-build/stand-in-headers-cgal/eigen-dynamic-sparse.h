// Eigen::DynamicSparseMatrix for Eigen 5, which removed it (Eigen 3.4 deprecated it: "use SparseMatrix").
// libigl 2.0's slice.cpp builds with it: (rows, cols), reserve(n), coeffRef(r, c), then a SparseMatrix copy.
// A SparseMatrix does all of that, so this is a SparseMatrix under the old name.
#pragma once
#include <Eigen/Sparse>
namespace Eigen {
template <typename Scalar, int Options = 0, typename StorageIndex = int>
class DynamicSparseMatrix : public SparseMatrix<Scalar, Options, StorageIndex> {
public:
    using SparseMatrix<Scalar, Options, StorageIndex>::SparseMatrix;
    void reserve(Index n) { SparseMatrix<Scalar, Options, StorageIndex>::reserve(n); }
};
} // namespace Eigen
