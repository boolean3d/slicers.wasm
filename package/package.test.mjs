// node --test package/package.test.mjs: package.mjs on a tiny stand-in build (full and --start packages).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const PKG = new URL('package.mjs', import.meta.url).pathname;
// The web view's service worker registration as the wasm port's program script has it (webview_wasm).
const REGISTER = 'navigator.serviceWorker.register("wxwebview-sw.js",{scope:"./"})';

function build() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-src-'));
  const files = [['/orca/resources/profiles/a.json', '{"a":1}'], ['/orca/resources/images/b.svg', '<svg/>'],
    ['/orca/resources/profiles/Maker/Model One_cover.png', 'PNG-bytes']];
  let pos = 0;
  const meta = { files: files.map(([filename, text]) => { const e = { filename, start: pos, end: pos + text.length }; pos += text.length; return e; }),
    remote_package_size: pos };
  fs.writeFileSync(path.join(src, 'orcaslicer.data'), files.map(f => f[1]).join(''));
  // emscripten writes the package's file list as an object literal: loadPackage({files:[...],remote_package_size:N})
  fs.writeFileSync(path.join(src, 'orcaslicer.js'), 'var Module;' + REGISTER + ';loadPackage({files:' + JSON.stringify(meta.files)
    + ',remote_package_size:' + meta.remote_package_size + '});');
  fs.writeFileSync(path.join(src, 'orcaslicer.html'), '<html><script>var Module={}</script><script async src=orcaslicer.js></script></html>');
  fs.writeFileSync(path.join(src, 'orcaslicer.wasm'), Buffer.alloc(16));
  fs.writeFileSync(path.join(src, 'wxwebview-sw.js'), '// web view worker\n');
  fs.mkdirSync(path.join(src, 'resources', 'web', 'guide', '21'), { recursive: true });
  fs.writeFileSync(path.join(src, 'resources', 'web', 'guide', '21', 'index.html'), '<html>printers</html>');
  const start = path.join(src, 'start.txt');
  fs.writeFileSync(start, 'profiles/*\n');
  return { src, start };
}

for (const lazy of [false, true]) {
  test(`${lazy ? '--start' : 'full'} package: the setup wizard's pages get the web view's worker and their printer pictures`, () => {
    const { src, start } = build();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-out-'));
    execFileSync(process.execPath, [PKG, '--app', 'orca', '--src', src, '--version', '9.9-t', '--out', out, '--jobs', '1',
      ...(lazy ? ['--start', start] : [])], { stdio: 'pipe' });
    const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).objects;
    // The worker sits at /orca/wxwebview-sw.js: its scope /orca/ holds the page (/orca/9.9-t/) and the web pages the
    // slicer opens as file:///orca/resources/web/... (/orca/resources/web/...). In the version folder its scope would
    // leave those pages out: no window.wx before their first script, the wizard's printer request never sent.
    assert.ok(m['orca/wxwebview-sw.js'], 'worker at the app folder');
    assert.equal(m['orca/wxwebview-sw.js'].cache, 'no-cache, no-transform');
    assert.ok(!m['orca/9.9-t/wxwebview-sw.js'], 'no worker left in the version folder');
    assert.ok(m['orca/resources/web/guide/21/index.html']);
    // An object's stored bytes are brotli when its manifest entry says so.
    const read = key => { const b = fs.readFileSync(path.join(out, key)); return String(m[key].encoding === 'br' ? zlib.brotliDecompressSync(b) : b); };
    // The wizard's printer pictures, which only the program's data file holds, are host files where the wizard asks for them.
    assert.equal(m['orca/resources/profiles/Maker/Model One_cover.png']?.cache, 'public, max-age=3600, no-transform');
    assert.equal(read('orca/resources/profiles/Maker/Model One_cover.png'), 'PNG-bytes');
    const js = read('orca/9.9-t/orcaslicer.js');
    assert.ok(!js.includes(REGISTER), 'registration no longer scoped to the version folder');
    assert.ok(js.includes('navigator.serviceWorker.register("../wxwebview-sw.js",{scope:"../"})'));
    const sw = read('orca/wxwebview-sw.js');
    assert.ok(sw.startsWith('// web view worker'));
    // The lazy package's cache keeper still keeps the version folder's files, under the cache name install-and-lazy-load.js uses.
    if (lazy) {
      assert.ok(sw.includes('b3d-slicer-files-'));
      const files = read('orca/9.9-t/files.js');
      assert.match(files, /"cache":"b3d-slicer-files-orca-9\.9-t"/);
      assert.match(sw, /self\.SLICER_VERSION_DIR = "9\.9-t\/"/);
    }
  });
}
