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
  fs.writeFileSync(path.join(src, 'orcaslicer.html'), '<html><head><script>var Module={}</script></head><body><script async src=orcaslicer.js></script></body></html>');
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
      // The install downloads the web pages' files from this version's own copy, never from the shared orca/resources/
      // (slicer-hotfix-1125: staging another version rewrote it and the live install stuck at "bytes, listed").
      const L = JSON.parse(files.replace(/^window\.SLICER_FILES=/, '').replace(/;\s*$/, ''));
      const cover = L.top.find(f => f[0] === 'resources/profiles/Maker/Model One_cover.png');
      assert.equal(cover[3], 'top/resources/profiles/Maker/Model One_cover.png');
      assert.equal(read('orca/9.9-t/top/resources/profiles/Maker/Model One_cover.png'), 'PNG-bytes');
      assert.equal(m['orca/9.9-t/top/resources/profiles/Maker/Model One_cover.png'].cache, 'public, max-age=31536000, immutable, no-transform');
      assert.equal(read('orca/9.9-t/top/resources/web/guide/21/index.html'), '<html>printers</html>');
      for (const f of L.top) assert.ok(m['orca/9.9-t/' + f[3]], f[3]);
      assert.ok(!L.startFiles.some(f => f[0].startsWith('top/')), 'the copy is not a start file');
    }
  });
}

// AGPL-3.0 section 6: every packaged copy carries its licence and says where its Corresponding Source is, and the loading
// screen's two links (credit.js: 'Source code of this browser copy', 'Licence') reach them. Live 11-03: 6 of 7 slicer pages
// had no source link and 5 answered 404 for LICENSE.txt, because both were optional flags the stage scripts left out.
for (const app of ['orca', 'anycubic']) test(`${app}: LICENSE.txt and SOURCE.txt in the version folder, the page links to both`, () => {
  const { src } = build();
  if (app !== 'orca') for (const f of ['html', 'js', 'data', 'wasm'])
    fs.renameSync(path.join(src, 'orcaslicer.' + f), path.join(src, 'anycubicslicer.' + f));
  if (app !== 'orca') fs.writeFileSync(path.join(src, 'anycubicslicer.html'),
    fs.readFileSync(path.join(src, 'anycubicslicer.html'), 'utf8').replace('orcaslicer.js', 'anycubicslicer.js'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-out-'));
  execFileSync(process.execPath, [PKG, '--app', app, '--src', src, '--version', '9.9-t', '--out', out, '--jobs', '1',
    '--source-rev', 'abc1234'], { stdio: 'pipe' });
  const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).objects;
  const read = key => { const b = fs.readFileSync(path.join(out, key)); return String(m[key].encoding === 'br' ? zlib.brotliDecompressSync(b) : b); };
  const lic = read(`${app}/9.9-t/LICENSE.txt`);
  assert.match(lic, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  if (app === 'anycubic') assert.match(lic, /Mulan Permissive Software License/);
  const srcTxt = read(`${app}/9.9-t/SOURCE.txt`);
  assert.match(srcTxt, /browser build 9\.9-t/);
  assert.match(srcTxt, /github\.com\/boolean3d\/slicers\.wasm\/tree\/abc1234\//);
  assert.match(srcTxt, app === 'orca' ? /OrcaSlicer\/OrcaSlicer/ : /ANYCUBIC-3D\/AnycubicSlicerNext/);
  const page = read(`${app}/9.9-t/index.html`);
  assert.match(page, /"source":"SOURCE\.txt"/);
  // The libraries' own licences and copyright notices travel with the copy (BSD, MIT, Zlib, Apache and Boost ask for the
  // notice itself in a binary copy); 11-03 every live copy named its libraries but carried none of their notices.
  assert.match(srcTxt, /NOTICES\.txt beside this file/);
  const notices = read(`${app}/9.9-t/NOTICES.txt`);
  for (const must of [/wxWindows Library Licence, Version 3\.1/, /Boost Software License - Version 1\.0/, /Randolph Voorhies/,
    /Jason Bevins/, /Copyright 2022 The Noto Project Authors/, /OPEN CASCADE EXCEPTION/i, /Mozilla Public License Version 2\.0/,
    /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/, /Apache License\s+Version 2\.0/])
    assert.match(notices, must);
});

// Every library a program names has its notice file, so NOTICES.txt never names a library it has no notice for.
test('every program: NOTICES.txt carries a notice for every library SOURCE.txt names', async () => {
  const { PROGRAMS, noticeFiles, noticesText } = await import('./program-sources.mjs');
  for (const [app, p] of Object.entries(PROGRAMS)) {
    for (const k of p.libs) for (const f of noticeFiles(k)) assert.ok(fs.existsSync(f), `${app}: ${k} has no notice (${f})`);
    assert.ok(noticesText(app).length > 50000, app);
  }
});
