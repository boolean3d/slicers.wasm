// KiCad's platform layer for the browser build: no system print service (the Unix version prints PDFs through GTK + poppler).
#include <printing.h>
#include <wx/cmndata.h>
namespace KIPLATFORM { namespace PRINTING {
PRINT_RESULT PrintPDF( const std::string& ) { return PRINT_RESULT::UNSUPPORTED; }
void ResetPrintToFilePath( wxPrintData& ) {}
} }
