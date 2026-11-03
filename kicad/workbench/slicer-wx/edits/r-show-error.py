# The page template calls showError() (WebGL context lost, window.onerror) but never defined it, so any uncaught page
# error became a second error, "showError is not defined", and hid the first. Now it is defined: it writes the
# message to the console beside the original error (Orca: seen on every start.)
# Run in owx.
def sub(p, a, b, n=1):
    s = open(p).read()
    if b in s: return   # already applied
    assert s.count(a) == n, (p, a[:60], s.count(a))
    open(p, 'w').write(s.replace(a, b))

sub('build/wasm/template.html', '''    var createCanvas = function () {''', '''    var showError = function (text) {
      console.error(text);
    };

    var createCanvas = function () {''')
