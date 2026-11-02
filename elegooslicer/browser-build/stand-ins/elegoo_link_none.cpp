// Stand-in for Elegoo's ElegooLink.cpp in the browser build. The real file drives elegoo-link (LAN and cloud printer
// connections over MQTT, WebSockets and curl), which a web page cannot open; sending to printers is a later step.
// Every call answers "printer network not initialized", the desktop's own answer before the network starts, so the
// printer pages show their normal "not connected" state. Same class and signatures as ElegooLink.hpp.
#include "ElegooLink.hpp"

namespace Slic3r {

namespace {
template<typename T> PrinterNetworkResult<T> none()
{
    return PrinterNetworkResult<T>(PrinterNetworkErrorCode::PRINTER_NETWORK_NOT_INITIALIZED, T{},
                                   "Printer connections are not available in the browser version.");
}
} // namespace

ElegooLink::ElegooLink() {}
ElegooLink::~ElegooLink() {}

void ElegooLink::init(const std::string&, std::string&, const std::string&) {}
void ElegooLink::uninit() {}

PrinterNetworkResult<PrinterNetworkInfo> ElegooLink::connectToPrinter(const PrinterNetworkInfo&) { return none<PrinterNetworkInfo>(); }
PrinterNetworkResult<bool> ElegooLink::disconnectFromPrinter(const std::string&) { return none<bool>(); }
PrinterNetworkResult<std::vector<PrinterNetworkInfo>> ElegooLink::discoverPrinters() { return none<std::vector<PrinterNetworkInfo>>(); }
PrinterNetworkResult<bool> ElegooLink::sendPrintTask(const PrinterNetworkParams&) { return none<bool>(); }
PrinterNetworkResult<bool> ElegooLink::sendPrintFile(const PrinterNetworkParams&) { return none<bool>(); }
PrinterNetworkResult<PrinterMmsGroup> ElegooLink::getPrinterMmsInfo(const std::string&) { return none<PrinterMmsGroup>(); }
PrinterNetworkResult<PrinterNetworkInfo> ElegooLink::getPrinterAttributes(const std::string&) { return none<PrinterNetworkInfo>(); }
PrinterNetworkResult<PrinterNetworkInfo> ElegooLink::getPrinterStatus(const std::string&) { return none<PrinterNetworkInfo>(); }
PrinterNetworkResult<std::string> ElegooLink::getPrinterStatusRaw(const std::string&) { return none<std::string>(); }
PrinterNetworkResult<PrinterPrintFileResponse> ElegooLink::getFileList(const std::string&, int, int) { return none<PrinterPrintFileResponse>(); }
PrinterNetworkResult<PrinterPrintTaskResponse> ElegooLink::getPrintTaskList(const std::string&, int, int) { return none<PrinterPrintTaskResponse>(); }
PrinterNetworkResult<PrinterExceptionResponse> ElegooLink::getExceptionList(const std::string&, int, int) { return none<PrinterExceptionResponse>(); }
PrinterNetworkResult<bool> ElegooLink::deletePrintTasks(const std::string&, const std::vector<std::string>&) { return none<bool>(); }
PrinterNetworkResult<PrinterPrintFileResponse> ElegooLink::getFileDetail(const std::string&, const std::string&) { return none<PrinterPrintFileResponse>(); }
PrinterNetworkResult<bool> ElegooLink::updatePrinterName(const std::string&, const std::string&) { return none<bool>(); }
PrinterNetworkResult<bool> ElegooLink::cancelBindPrinter(const std::string&) { return none<bool>(); }
PrinterNetworkResult<PluginNetworkInfo> ElegooLink::hasInstalledPlugin() { return none<PluginNetworkInfo>(); }
PrinterNetworkResult<bool> ElegooLink::installPlugin(const std::string&) { return none<bool>(); }
PrinterNetworkResult<bool> ElegooLink::uninstallPlugin() { return none<bool>(); }
PrinterNetworkResult<bool> ElegooLink::logout(const UserNetworkInfo&) { return none<bool>(); }
PrinterNetworkResult<UserNetworkInfo> ElegooLink::connectToIot(const UserNetworkInfo&) { return none<UserNetworkInfo>(); }
PrinterNetworkResult<UserNetworkInfo> ElegooLink::getRtcToken() { return none<UserNetworkInfo>(); }
PrinterNetworkResult<std::vector<PrinterNetworkInfo>> ElegooLink::getUserBoundPrinters() { return none<std::vector<PrinterNetworkInfo>>(); }
PrinterNetworkResult<UserNetworkInfo> ElegooLink::refreshToken(const UserNetworkInfo&) { return none<UserNetworkInfo>(); }
PrinterNetworkResult<bool> ElegooLink::sendRtmMessage(const std::string&, const std::string&) { return none<bool>(); }
PrinterNetworkResult<std::vector<LicenseExpiredDevice>> ElegooLink::getLicenseExpiredDevices() { return none<std::vector<LicenseExpiredDevice>>(); }
PrinterNetworkResult<bool> ElegooLink::renewLicense(const std::string&) { return none<bool>(); }
PrinterNetworkResult<bool> ElegooLink::refreshPrinterStatus(const std::string&) { return none<bool>(); }
PrinterNetworkResult<PrinterNetworkInfo> ElegooLink::bindWANPrinter(const PrinterNetworkInfo&) { return none<PrinterNetworkInfo>(); }
PrinterNetworkResult<bool> ElegooLink::unbindWANPrinter(const std::string&) { return none<bool>(); }
PrinterNetworkResult<bool> ElegooLink::setRegion(const std::string&, const std::string&) { return none<bool>(); }

bool ElegooLink::isBusy(const std::string&, PrinterStatus& status, int)
{
    status = PRINTER_STATUS_UNKNOWN;
    return false;
}

void ElegooLink::doUninstallPlugin() {}

} // namespace Slic3r
