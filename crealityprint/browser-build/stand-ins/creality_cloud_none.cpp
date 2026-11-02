// Creality Cloud in the browser build: Creality Print uploads G-code and printer videos to Creality Cloud through
// the Alibaba Cloud OSS SDK and talks to cloud printers over MQTT (Paho). The browser build has neither library and
// reaches no maker's servers, so these classes answer every request with "not in the browser version": no crash,
// no silent success. They replace UploadFile.cpp, VideoOssUploader.cpp, print_manage/App/mqtt_client.cpp and
// print_manage/App/CloudDeviceMqttTransport.cpp (CMakeLists.txt); the headers are Creality's own.
#include "slic3r/GUI/UploadFile.hpp"
#include "slic3r/GUI/VideoOssUploader.hpp"
#include "slic3r/GUI/print_manage/App/mqtt_client.h"
#include "slic3r/GUI/print_manage/App/CloudDeviceMqttSession.hpp"

#include <boost/log/trivial.hpp>

namespace {
const char* const k_not_here = "Creality Cloud is not in the browser version.";
}

namespace Slic3r { namespace GUI {

UploadFile::UploadFile() = default;
UploadFile::UploadFile(std::map<std::string, std::string> request_headers)
    : m_request_headers(std::move(request_headers)), m_has_request_headers(true) {}
UploadFile::~UploadFile() = default;
static int cloud_refused(UploadFile::LastError& e, const char* what)
{
    e = { "browser", k_not_here, "" };
    BOOST_LOG_TRIVIAL(warning) << "Creality Cloud " << what << ": " << k_not_here;
    return -1;
}
int UploadFile::getAliyunInfo() { return cloud_refused(m_lastError, "getAliyunInfo"); }
int UploadFile::getOssInfo() { return cloud_refused(m_lastError, "getOssInfo"); }
json UploadFile::getCloudUploadInfo() { cloud_refused(m_lastError, "getCloudUploadInfo"); return json::object(); }
int UploadFile::uploadGcodeToCXCloud(const std::string&, const std::string&, std::function<void(std::string)>)
{ return cloud_refused(m_lastError, "upload"); }
void UploadFile::setProcessCallback(std::function<void(int, double)> cb) { m_funcProcessCb = std::move(cb); }
void UploadFile::UploadProgressCallback(int, int, double) {}
int UploadFile::uploadFileToAliyun(const std::string&, const std::string&, const std::string&)
{ return cloud_refused(m_lastError, "upload"); }
int UploadFile::downloadFileFromAliyun(const std::string&, const std::string&)
{ return cloud_refused(m_lastError, "download"); }
vector<AlibabaCloud::OSS::Part> UploadFile::uploadParts(AlibabaCloud::OSS::OssClient&, const std::string&, const std::string&,
    const std::string&, const std::string&, Slic3r::GUI::ProgressCallback)
{ cloud_refused(m_lastError, "upload"); return {}; }
void UploadFile::ProgressCallback(size_t, int64_t, int64_t, void*) {}
std::map<std::string, std::string> UploadFile::requestHeaders() const { return m_request_headers; }

VideoOssUploader::VideoOssUploader(const CloudOssConfig&) {}
VideoOssUploader::VideoOssUploader(const CloudOssConfig&, const Options& options) : m_options(options) {}
static VideoOssUploader::Result video_refused()
{
    VideoOssUploader::Result r;
    r.status        = VideoOssUploader::Status::Failed;
    r.error_code    = "browser";
    r.error_message = k_not_here;
    return r;
}
VideoOssUploader::Result VideoOssUploader::upload(const std::string&, const std::string&, const ProgressCallback&) { return video_refused(); }
VideoOssUploader::Result VideoOssUploader::check_object(const std::string&) { return video_refused(); }
void VideoOssUploader::cancel() {}
bool VideoOssUploader::is_uploading() const { return false; }
void VideoOssUploader::finish_upload() {}
void VideoOssUploader::set_active_client(AlibabaCloud::OSS::OssClient&) {}
void VideoOssUploader::clear_active_client(AlibabaCloud::OSS::OssClient&) {}

namespace {
class NoCloudTransport final : public CloudDeviceMqttSession::Transport {
    static CloudDeviceMqttSession::Result no() { CloudDeviceMqttSession::Result r; r.ok = false; r.error = "not_in_browser"; return r; }
public:
    CloudDeviceMqttSession::Result Connect(const CloudDeviceMqttSession::Config&, Receive, Lost) override { return no(); }
    CloudDeviceMqttSession::Result Subscribe() override { return no(); }
    CloudDeviceMqttSession::Result Monitor(const std::string&, bool) override { return no(); }
    CloudDeviceMqttSession::Result Acknowledge(const std::string&) override { return no(); }
};
} // namespace
std::unique_ptr<CloudDeviceMqttSession::Transport> MakeCloudDeviceMqttTransport() { return std::make_unique<NoCloudTransport>(); }

}} // namespace Slic3r::GUI

MQTTClient::MQTTClient(const std::string& server_address, const std::string& client_id)
    : server_address_(server_address), client_id_(client_id), last_error_(k_not_here) {}
MQTTClient::~MQTTClient() = default;
bool MQTTClient::connect(const std::string&, const std::string&, bool, int) { last_error_ = k_not_here; return false; }
void MQTTClient::disconnect() {}
bool MQTTClient::publish(const std::string&, const std::string&, int, bool) { return false; }
bool MQTTClient::subscribe(const std::string&, int, MessageCallback) { return false; }
bool MQTTClient::unsubscribe(const std::string&) { return false; }
void MQTTClient::setConnectionCallback(ConnectionCallback cb) { connection_callback_ = std::move(cb); }
void MQTTClient::setConnectionLostCallback(ConnectionLostCallback cb) { connection_lost_callback_ = std::move(cb); }
bool MQTTClient::isConnected() const { return false; }
std::string MQTTClient::getLastError() const { return last_error_; }
