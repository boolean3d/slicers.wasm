// node --test package/upload-r2.test.mjs: upload-r2.mjs against a stand-in S3 store (HEAD/PUT by path, sha kept as
// x-amz-meta-sha256), on a small package written here the way package.mjs writes one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const UPLOAD = new URL('upload-r2.mjs', import.meta.url).pathname;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const YEAR = 'public, max-age=31536000, immutable, no-transform';
const NEVER = 'no-cache, no-transform';

function store() {
  const objects = new Map(), puts = [];
  const server = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.split('?')[0]).replace(/^\/[^/]+\//, '');
    if (req.method === 'HEAD') {
      const o = objects.get(key);
      if (!o) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'x-amz-meta-sha256': o.sha, 'cache-control': o.cache }); return res.end();
    }
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      objects.set(key, { body, sha: req.headers['x-amz-meta-sha256'], cache: req.headers['cache-control'] });
      puts.push(key); res.writeHead(200); res.end();
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ objects, puts, server, url: 'http://127.0.0.1:' + server.address().port })));
}

function pack(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-r2-test-'));
  const objects = {};
  for (const [key, { text, cache }] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, key)), { recursive: true });
    fs.writeFileSync(path.join(dir, key), text);
    objects[key] = { type: 'text/javascript; charset=utf-8', cache, bytes: Buffer.byteLength(text), sha256: sha(Buffer.from(text)) };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ current: { kicad: '9.0.4-1' }, objects }));
  return dir;
}

function upload(dir, endpoint) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [UPLOAD, dir, 'b'], {
      env: { ...process.env, S3_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_ACCOUNT_ID: '' } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => ok({ code, out }));
  });
}

const build = (script) => ({
  'kicad/9.0.4-1/project-folder.js': { text: script, cache: YEAR },
  'kicad/9.0.4-1/kicad.wasm': { text: 'wasm bytes', cache: YEAR },
  'kicad/index.html': { text: '<p>to 9.0.4-1</p>', cache: NEVER },
});

test('a new build: every file sent, a rerun sends nothing', async () => {
  const s = await store();
  try {
    const dir = pack(build('v1'));
    const a = await upload(dir, s.url);
    assert.equal(a.code, 0, a.out);
    assert.equal(s.puts.length, 3);
    assert.equal(s.puts.at(-1), 'kicad/index.html', 'the pointer goes last');
    const b = await upload(dir, s.url);
    assert.equal(b.code, 0, b.out);
    assert.equal(s.puts.length, 3, 'nothing sent again');
  } finally { s.server.close(); }
});

test('other bytes under a version folder already published: refused, nothing in the store changes', async () => {
  // The KiCad case (11-03): a changed page script packaged under the same --version replaced the year-cached
  // project-folder.js; returning visitors kept the old one (saves not reaching the project).
  const s = await store();
  try {
    assert.equal((await upload(pack(build('v1')), s.url)).code, 0);
    const before = new Map([...s.objects].map(([k, o]) => [k, o.sha]));
    s.puts.length = 0;
    const r = await upload(pack({ ...build('v2'), 'kicad/9.0.4-1/new-file.js': { text: 'n', cache: YEAR } }), s.url);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /kicad\/9\.0\.4-1\/project-folder\.js/);
    assert.match(r.out, /new --version/);
    assert.deepEqual(s.puts, [], 'not one file sent, not even the new one or the pointer');
    assert.deepEqual(new Map([...s.objects].map(([k, o]) => [k, o.sha])), before);
  } finally { s.server.close(); }
});

test('the same change under a new version folder goes up, pointer last', async () => {
  const s = await store();
  try {
    assert.equal((await upload(pack(build('v1')), s.url)).code, 0);
    s.puts.length = 0;
    const next = {
      'kicad/9.0.4-2/project-folder.js': { text: 'v2', cache: YEAR },
      'kicad/9.0.4-2/kicad.wasm': { text: 'wasm bytes', cache: YEAR },
      'kicad/index.html': { text: '<p>to 9.0.4-2</p>', cache: NEVER },
    };
    const r = await upload(pack(next), s.url);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(s.puts.slice().sort(), Object.keys(next).sort());
    assert.equal(s.puts.at(-1), 'kicad/index.html');
  } finally { s.server.close(); }
});
