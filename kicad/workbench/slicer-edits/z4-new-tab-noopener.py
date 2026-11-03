# wxLaunchDefaultBrowser opens the address in a new browser tab that cannot reach back into the slicer's page
# (noopener, noreferrer): a desktop browser started by the slicer has no handle on the slicer either. Before, the new
# tab got window.opener = the slicer's page.
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('build/wasm/wx.js', '''      window.open(url, '_blank');''', '''      window.open(url, '_blank', 'noopener,noreferrer');''')
