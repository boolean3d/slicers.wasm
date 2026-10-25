# PrusaSlicer's own Eigen (deps/+Eigen: 3.3.7, same URL and hash) into /w/prefix-eigen, ahead of the shared prefix's
# Eigen 5 (which dropped DynamicSparseMatrix, used by PrusaSlicer's bundled libigl). Header-only.
set -e
cd /w; mkdir -p dl; Z=dl/eigen-3.3.7.zip
[ -f $Z ] || curl -sSL -o $Z https://gitlab.com/libeigen/eigen/-/archive/3.3.7/eigen-3.3.7.zip
echo "4815118c085ff1d5a21f62218a3b2ac62555e9b8d7bacd5093892398e7a92c4b  $Z" | sha256sum -c -
rm -rf beigen eigen-3.3.7 && python3 -c "import zipfile;zipfile.ZipFile('$Z').extractall('.')"
cmake -S eigen-3.3.7 -B beigen -DCMAKE_INSTALL_PREFIX=/w/prefix-eigen -DBUILD_TESTING=OFF -DEIGEN_BUILD_DOC=OFF > beigen.log 2>&1
cmake --install beigen >> beigen.log 2>&1
ls /w/prefix-eigen/share/eigen3/cmake && echo EIGEN-OK
