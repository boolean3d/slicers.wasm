// The names Creality Print's headers take from the Alibaba Cloud OSS SDK (UploadFile.hpp, VideoOssUploader.hpp),
// for the browser build, which has no OSS SDK: Creality Cloud uploads are not in the browser version. The sources
// that call the SDK (UploadFile.cpp, VideoOssUploader.cpp) are replaced by stand-ins/creality_cloud_none.cpp.
#pragma once
namespace AlibabaCloud { namespace OSS {
inline bool IsSdkInitialized() { return false; }
inline void InitializeSdk() {}
inline void ShutdownSdk() {}
class OssClient;
class OssError;
struct Part {};
}} // namespace AlibabaCloud::OSS
// UploadFile.hpp names std::vector unqualified (vector<AlibabaCloud::OSS::Part>), which the SDK's own headers allow it.
#include <vector>
using std::vector;
