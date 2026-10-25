# Phase 2g/2h: the vendor preset files come from one bundle, served inside the worker (presets-bundle-reader.js beside this script).
# Writes <app>/resources/b3d-bundle/profiles-<name>.bin (index line: {rel: [offset, length, mtime]}, then the bytes of
# every file under profiles/<vendor>/ and profiles/<vendor>.json, vendor by vendor), writes browser-port/shared/js/presets-bundle-reader.js
# with the bundle list for this slicer, and adds the pre-js to browser-port/browser-build/CMakeLists.txt. Bambu and Orca trees; Prusa has
# no such folder and is skipped. Vendors: BUNDLE_VENDORS (Bambu default BBL; Orca default ALL = every vendor, one bundle,
# since Orca reads every vendor's files at start: 115,000 calls). Usage: python3 write-presets-bundle.py <workbench>. Idempotent
# (the bundle is rewritten each run from the files, the js and cmake edits are skipped when in).
import sys, os, json
root = os.path.abspath(sys.argv[1]); here = os.path.dirname(os.path.abspath(__file__))
apps = {'bambu': '/home/web_user/.BambuStudio', 'orca': '/home/web_user/.OrcaSlicer'}
app = next((a for a in apps if os.path.isdir(os.path.join(root, a, 'resources', 'profiles'))), None)
if not app: print('no vendor profiles tree (Prusa): bundle skipped'); sys.exit(0)
res = os.path.join(root, app, 'resources'); out = os.path.join(res, 'b3d-bundle'); os.makedirs(out, exist_ok=True)
want = os.environ.get('BUNDLE_VENDORS', 'BBL' if app == 'bambu' else 'ALL').split()
if want == ['ALL']:
    want = sorted(n[:-5] for n in os.listdir(os.path.join(res, 'profiles')) if n.endswith('.json') and os.path.isdir(os.path.join(res, 'profiles', n[:-5])))
    name = 'ALL'
else: name = '-'.join(want)
for old in os.listdir(out):   # one bundle file per build: an older vendor set would be preloaded for nothing
    if old != 'profiles-' + name + '.bin': os.remove(os.path.join(out, old)); print('removed old', old)
files = []
for v in want:
    vdir = os.path.join(res, 'profiles', v); vjson = os.path.join(res, 'profiles', v + '.json')
    assert os.path.isdir(vdir) and os.path.isfile(vjson), 'vendor ' + v
    files.append((v + '.json', vjson))
    for d, _, names in sorted(os.walk(vdir)):
        for n in sorted(names):
            f = os.path.join(d, n); files.append((v + '/' + os.path.relpath(f, vdir).replace(os.sep, '/'), f))
index = {}; chunks = []; off = 0
for rel, f in files:
    b = open(f, 'rb').read(); index[rel] = [off, len(b), int(os.stat(f).st_mtime)]; chunks.append(b); off += len(b)
bin_ = os.path.join(out, 'profiles-' + name + '.bin')
with open(bin_, 'wb') as w: w.write(json.dumps(index, separators=(',', ':')).encode()); w.write(b'\n'); [w.write(c) for c in chunks]
# read back: every entry is its file's own bytes
data = open(bin_, 'rb').read(); nl = data.index(b'\n'); idx = json.loads(data[:nl]); base = nl + 1
for rel, f in files: o, l, _ = idx[rel]; assert data[base + o:base + o + l] == open(f, 'rb').read(), rel
print('bundle', os.path.relpath(bin_, root), len(want), 'vendors', len(files), 'files', round(off / 1048576, 1), 'MB, checked')
P = '/' + app + '/resources/profiles/'; S = apps[app] + '/system/'
roots = {}; sysr = {}
for v in want:
    roots.update({P + v + '/': v + '/', P + v + '.json': v + '.json'})
    # the data folder's system/<vendor> is the same bytes only while it is a link to resources/ (Bambu: start-up.js, phase 2d;
    # Orca: presets-bundle-reader.js makes the links for the enabled vendors before main runs): served after a readlink check (presets-bundle-reader.js)
    sysr.update({S + v + '/': {'at': S + v, 'to': P + v, 'rel': v + '/'}, S + v + '.json': {'at': S + v + '.json', 'to': P + v + '.json', 'rel': v + '.json'}})
bundles = [{'file': '/' + app + '/resources/b3d-bundle/profiles-' + name + '.bin', 'roots': roots, 'sys': sysr}]
links = None if app == 'bambu' else {'data': apps[app], 'res': '/' + app + '/resources/profiles', 'conf': 'OrcaSlicer.conf', 'always': ['OrcaFilamentLibrary', 'Custom']}
js = open(os.path.join(here, 'presets-bundle-reader.js')).read().replace('WXFS_BUNDLES_PLACEHOLDER', json.dumps(bundles)).replace('WXFS_LINKS_PLACEHOLDER', json.dumps(links))
jp = os.path.join(root, 'browser-port/shared/js/presets-bundle-reader.js')
if os.path.exists(jp) and open(jp).read() == js: print('already:', jp)
else: open(jp, 'w').write(js); print('wrote', jp)
cp = os.path.join(root, 'browser-port/browser-build/CMakeLists.txt'); s = open(cp).read()
if 'presets-bundle-reader.js' in s: print('already: CMakeLists.txt')
else:
    a = '"SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js" '
    assert a in s, 'pre-js anchor'; s = s.replace(a, a + '"SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/presets-bundle-reader.js" ', 1)
    d = '"${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/page-extras.js"'
    assert d in s, 'link-depends anchor'; s = s.replace(d, d + ' "${CMAKE_CURRENT_SOURCE_DIR}/../shared/js/presets-bundle-reader.js"', 1)
    open(cp, 'w').write(s); print('cmake edited:', cp)
# the bundle folder is preloaded like the other resources/ folders (the folder list is a cached CMake variable: a line of its own)
s = open(cp).read()
if 'b3d-bundle@' in s: print('already: CMakeLists.txt preload')
else:
    import re
    m = re.search(r'list\(APPEND _preload "SHELL:--preload-file \$\{ORCA_SRC\}/resources/\$\{r\}@/(\w+)/resources/\$\{r\}"\)[^\n]*\n    endif \(\)\nendforeach \(\)\n', s)
    assert m, 'preload loop anchor'
    line = '# the vendor presets bundle (off-thread write-presets-bundle.py): one file the worker serves the preset files from\nlist(APPEND _preload "SHELL:--preload-file ${ORCA_SRC}/resources/b3d-bundle@/' + m.group(1) + '/resources/b3d-bundle")\n'
    s = s[:m.end()] + line + s[m.end():]; open(cp, 'w').write(s); print('cmake preload added:', cp)
