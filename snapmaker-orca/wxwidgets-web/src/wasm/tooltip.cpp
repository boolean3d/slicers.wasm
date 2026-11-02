/////////////////////////////////////////////////////////////////////////////
// Name:        src/wasm/tooltip.cpp
// Purpose:     wxToolTip for the wasm port (see wx/wasm/tooltip.h)
// Licence:     wxWindows licence
/////////////////////////////////////////////////////////////////////////////

#include "wx/wxprec.h"

#if wxUSE_TOOLTIPS

#include "wx/tooltip.h"

bool wxToolTip::ms_enabled = true;

wxIMPLEMENT_ABSTRACT_CLASS(wxToolTip, wxObject);

#endif // wxUSE_TOOLTIPS
