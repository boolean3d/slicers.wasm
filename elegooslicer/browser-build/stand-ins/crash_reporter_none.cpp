// Stand-in for Elegoo's dev-utils/CrashReporter.cpp in the browser build: the desktop one starts Sentry's Crashpad
// handler, a separate process that uploads crash reports to Elegoo. A web page has no process to watch and sends nothing
// to a maker's server, so the reporter never starts. Same class as CrashReporter.h.
#include "CrashReporter.h"

bool CrashReporter::init(const std::string&) { return false; }
void CrashReporter::close() {}
void CrashReporter::triggerTestCrash() {}
