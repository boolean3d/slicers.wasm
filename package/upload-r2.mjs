// Uploads a package made by package.mjs to an S3-compatible store (Cloudflare R2), each object with the
// Content-Type, Content-Encoding and Cache-Control written in manifest.json. No dependencies (Node 18+).
//
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... node upload-r2.mjs <package dir> <bucket> [--dry-run]
//   (or S3_ENDPOINT=http://host:port instead of R2_ACCOUNT_ID, for a stand-in store)
//
// An object already in the store with the same sha256 (kept as x-amz-meta-sha256) is skipped, so a rerun or a new
// version uploads only what changed. Each <app>/index.html (the pointer to the current version) goes last, after
// every file of the version it points to is in place, so a visitor never lands on a half-uploaded version.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const [dir, bucket] = args.filter(a => !a.startsWith('--'));
if (!dir || !bucket) { console.error('usage: node upload-r2.mjs <package dir> <bucket> [--dry-run]'); process.exit(2); }
const env = process.env;
const endpoint = env.S3_ENDPOINT || (env.R2_ACCOUNT_ID && `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
if (!dry && (!endpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)) {
  console.error('needs R2_ACCOUNT_ID (or S3_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY'); process.exit(2);
}
const REGION = env.S3_REGION || 'auto';

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const keys = Object.keys(manifest.objects);
const isPointer = k => /^[^/]+\/index\.html$/.test(k);
const order = [...keys.filter(k => !isPointer(k)), ...keys.filter(isPointer)];

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// AWS Signature Version 4, path-style address (<endpoint>/<bucket>/<key>), payload hash signed.
async function send(method, key, headers = {}, body) {
  const url = new URL(endpoint);
  const uri = '/' + enc(bucket) + '/' + key.split('/').map(enc).join('/');
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const h = { ...headers, host: url.host, 'x-amz-date': amzDate,
    'x-amz-content-sha256': body ? sha256(body) : sha256('') };
  const names = Object.keys(h).map(n => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([n, v]) => [n.toLowerCase(), String(v).trim()]));
  const canon = [method, uri, '', names.map(n => n + ':' + lower[n] + '\n').join(''), names.join(';'),
    lower['x-amz-content-sha256']].join('\n');
  const scope = `${day}/${REGION}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canon)].join('\n');
  let k = hmac('AWS4' + env.R2_SECRET_ACCESS_KEY, day);
  for (const p of [REGION, 's3', 'aws4_request']) k = hmac(k, p);
  lower.authorization = `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, `
    + `Signature=${crypto.createHmac('sha256', k).update(toSign).digest('hex')}`;
  delete lower.host;
  return fetch(url.origin + uri, { method, headers: lower, body });
}

// What the store holds under a key: 'plan' (dry run), 'same' (these bytes), 'new' (nothing or other bytes it may replace),
// 'clash' (other bytes under a key served as immutable: a browser that has the old bytes keeps them for a year, so
// replacing them leaves returning visitors on old scripts with a new page; a new build needs a new --version folder).
async function look(key) {
  const o = manifest.objects[key];
  const body = fs.readFileSync(path.join(dir, key));
  const sum = sha256(body);
  if (o.sha256 && o.sha256 !== sum) throw new Error(`${key}: bytes on disk do not match the manifest`);
  if (dry) return 'plan';
  const head = await send('HEAD', key);
  if (head.ok && head.headers.get('x-amz-meta-sha256') === sum) return 'same';
  if (head.ok && /\bimmutable\b/.test(o.cache || '')) return 'clash';
  return 'new';
}

async function put(key) {
  const o = manifest.objects[key];
  const body = fs.readFileSync(path.join(dir, key));
  const headers = { 'content-type': o.type, 'cache-control': o.cache, 'x-amz-meta-sha256': sha256(body) };
  if (o.encoding) headers['content-encoding'] = o.encoding;
  for (let attempt = 1; ; attempt++) {
    const r = await send('PUT', key, headers, body);
    if (r.ok) return;
    const text = await r.text();
    if (attempt === 3 || r.status < 500) throw new Error(`${key}: ${r.status} ${text.slice(0, 300)}`);
  }
}

async function pool(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) { const j = i++; out[j] = await fn(list[j]); }
  }));
  return out;
}

// Every object is looked at before any is sent: a clash stops the whole upload with nothing changed in the store.
const seen = await pool(order, 8, look);
const clashes = order.filter((k, j) => seen[j] === 'clash');
if (clashes.length) {
  console.error(`refused: ${clashes.length} file(s) already in the store with other bytes, served as immutable (cached a year):\n  `
    + clashes.slice(0, 20).join('\n  ') + (clashes.length > 20 ? '\n  ...' : '')
    + '\nnothing was sent. Package the build under a new --version (a new build = a new version folder).');
  process.exit(1);
}
const count = { plan: 0, same: 0, sent: 0 }; let bytes = 0;
const send1 = order.filter((k, j) => seen[j] === 'new');
for (const what of seen) if (what !== 'new') count[what]++;
// Versions first (in parallel), pointers after, one by one.
await pool(send1.filter(k => !isPointer(k)), 8, async key => {
  await put(key); count.sent++; bytes += manifest.objects[key].bytes;
  if (manifest.objects[key].bytes > 1e6) console.log('sent', key, (manifest.objects[key].bytes / 1e6).toFixed(1), 'MB');
});
await pool(send1.filter(isPointer), 1, async key => { await put(key); count.sent++; bytes += manifest.objects[key].bytes; });
if (dry) for (const k of order) bytes += manifest.objects[k].bytes;
console.log(dry ? `dry run: ${count.plan} objects, ${(bytes / 1e6).toFixed(1)} MB, manifest checked against disk`
  : `done: ${count.sent} sent (${(bytes / 1e6).toFixed(1)} MB), ${count.same} already there; current ${JSON.stringify(manifest.current)}`);
