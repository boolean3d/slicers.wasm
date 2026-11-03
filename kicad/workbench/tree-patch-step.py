#!/usr/bin/env python3
# tree-patch-step.py <kicad tree>: the STEP export dialog runs the export in the board editor itself on __EMSCRIPTEN__.
# Desktop KiCad runs a second program (kicad-cli pcb export step); a browser tab has no second program (wxExecute fails),
# so File > Export > STEP did nothing. The job path's parameter filling becomes fillJob(); the browser path fills a job the
# same way and hands its parameters to EXPORTER_STEP exactly as PCBNEW_JOBS_HANDLER::JobExportStep does for kicad-cli.
import sys, re
root = sys.argv[1]
cpp = root + '/pcbnew/dialogs/dialog_export_step.cpp'
h = root + '/pcbnew/dialogs/dialog_export_step.h'
s = open(cpp).read()
if 'fillJob(' in s:
    print('already applied'); sys.exit(0)

start = s.index('    else\n    {\n        m_job->SetConfiguredOutputPath( path );')
end_marker = '        EndModal( wxID_OK );\n    }\n}\n'
end = s.index(end_marker, start)
body = s[start + len('    else\n    {\n'):end]
fill = '\n'.join(l[4:] if l.startswith('    ') else l for l in body.replace('m_job->', 'aJob->').split('\n'))
fill = fill.replace('SetConfiguredOutputPath( path )', 'SetConfiguredOutputPath( aPath )').replace('= tolerance;', '= aTolerance;')
assert 'tolerance' not in fill.replace('aTolerance', ''), 'unexpected tolerance use'
s = s[:start] + '    else\n    {\n        fillJob( m_job, path, tolerance );\n        EndModal( wxID_OK );\n    }\n}\n' + s[end + len(end_marker):]

s += '''

void DIALOG_EXPORT_STEP::fillJob( JOB_EXPORT_PCB_3D* aJob, const wxString& aPath, double aTolerance )
{
''' + fill.rstrip() + '''
}
'''

s += '''

#ifdef __EMSCRIPTEN__
void DIALOG_EXPORT_STEP::exportInProcess( const wxString& aPath, double aTolerance )
{
    // A browser tab runs no second program, so kicad-cli is not there: the open board is
    // exported here, with the parameters a job of this dialog would hand to kicad-cli
    // (PCBNEW_JOBS_HANDLER::JobExportStep)
    JOB_EXPORT_PCB_3D job;
    fillJob( &job, aPath, aTolerance );

    BOARD*   board = m_editFrame->GetBoard();
    wxString previousVariant = board->GetCurrentVariant();

    if( !job.m_variant.IsEmpty() )
        board->SetCurrentVariant( job.m_variant );

    WX_STRING_REPORTER reporter;
    bool               success;

    {
        wxBusyCursor  busy;
        EXPORTER_STEP exporter( board, job.m_3dparams, &reporter );
        exporter.m_outputFile = aPath;
        success = exporter.Export();
    }

    if( !job.m_variant.IsEmpty() )
        board->SetCurrentVariant( previousVariant );

    if( success )
        DisplayInfoMessage( this, wxString::Format( _( "Exported '%s'." ), aPath ), reporter.GetMessages() );
    else
        DisplayErrorMessage( this, _( "Export failed." ), reporter.GetMessages() );
}
#endif
'''

hook = '        m_editFrame->SetLastPath( LAST_PATH_STEP, fn.GetFullPath() );\n'
assert s.count(hook) == 1
s = s.replace(hook, hook + '''
#ifdef __EMSCRIPTEN__
        exportInProcess( fn.GetFullPath(), tolerance );
        return;
#endif
''')
s = s.replace('#include <jobs/job_export_pcb_3d.h>\n', '#include <jobs/job_export_pcb_3d.h>\n#include <exporters/step/exporter_step.h>\n#include <wx/utils.h>\n', 1)
open(cpp, 'w').write(s)

t = open(h).read()
anchor = '    wxString getComponentFilter() const;\n'
assert t.count(anchor) == 1
t = t.replace(anchor, anchor + '''
    /**
     * Fill \\a aJob from the dialog's controls, the output going to \\a aPath and board outlines
     * chained within \\a aTolerance mm.
     */
    void fillJob( JOB_EXPORT_PCB_3D* aJob, const wxString& aPath, double aTolerance );

#ifdef __EMSCRIPTEN__
    /// Export the open board to \\a aPath in this program (no kicad-cli in a browser tab).
    void exportInProcess( const wxString& aPath, double aTolerance );
#endif
''')
open(h, 'w').write(t)
print('applied')
