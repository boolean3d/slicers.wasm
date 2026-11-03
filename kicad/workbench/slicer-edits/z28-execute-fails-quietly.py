# wxExecute on the wasm port fails quietly: a browser tab has no child processes, and the stock unix code reached fork(),
# got ENOSYS and showed a "Fork failed (error 52: Function not implemented)" error dialog. Callers get the usual failure
# code (-1 sync, 0 async) and carry on, as they do on a desktop when the program is not found. KiCad's project manager
# asks "which -a python3" at every start (scripting/python_manager.cpp)..
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/unix/utilsunx.cpp', '''    wxCHECK_MSG( *argv, ERROR_RETURN_CODE, wxT("can't exec empty command") );

#if wxUSE_THREADS
    // fork() doesn't mix well with POSIX threads''', '''    wxCHECK_MSG( *argv, ERROR_RETURN_CODE, wxT("can't exec empty command") );

#ifdef __WXWASM__
    // z28: a browser tab has no child processes; the usual failure code, no error dialog
    wxLogDebug(wxS("wxExecute(\\"%s\\"): no child processes in a browser tab"), wxString(argv[0]));
    wxUnusedVar(process);
    wxUnusedVar(env);
    return ERROR_RETURN_CODE;
#endif

#if wxUSE_THREADS
    // fork() doesn't mix well with POSIX threads''')
print("z28 ok")
