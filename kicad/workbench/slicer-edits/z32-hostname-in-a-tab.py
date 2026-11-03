# wxGetHostName works in a browser tab: Emscripten's gethostname() ("emscripten"). The port had switched uname() off
# for __WXWASM__ and HAVE_GETHOSTNAME is not set by configure, so wxGetHostNameInternal fell through to the "no uname,
# no gethostname" branch: false + wxLogSysError "Cannot get the hostname (error 44)" as a modal error box at every use.
# KiCad asks for it when it locks a project (LOCKFILE: user@host)..
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('src/unix/utilsunx.cpp', '''    // we're using uname() which is POSIX instead of less standard sysinfo()
#if defined(HAVE_UNAME) && !defined(__WXWASM__)''', '''    // we're using uname() which is POSIX instead of less standard sysinfo()
#if defined(__WXWASM__)
    // z32: a browser tab has a host name too (Emscripten's gethostname)
    char cbuf[256];
    bool ok = gethostname(cbuf, sizeof(cbuf)) == 0;
    if ( ok )
    {
        wxStrlcpy(buf, wxSafeConvertMB2WX(cbuf), sz);
    }
#elif defined(HAVE_UNAME)''')
print("z32 ok")
