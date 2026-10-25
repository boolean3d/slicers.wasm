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

async function one(key) {
  const o = manifest.objects[key];
  const body = fs.readFileSync(path.join(dir, key));
  const sum = sha256(body);
  if (o.sha256 && o.sha256 !== sum) throw new Error(`${key}: bytes on disk do not match the manifest`);
  if (dry) return 'plan';
  const head = await send('HEAD', key);
  if (head.ok && head.headers.get('x-amz-meta-sha256') === sum) return 'same';
  const headers = { 'content-type': o.type, 'cache-control': o.cache, 'x-amz-meta-sha256': sum };
  if (o.encoding) headers['content-encoding'] = o.encoding;
  for (let attempt = 1; ; attempt++) {
    const r = await send('PUT', key, headers, body);
    if (r.ok) return 'sent';
    const text = await r.text();
    if (attempt === 3 || r.status < 500) throw new Error(`${key}: ${r.status} ${text.slice(0, 300)}`);
  }
}

async function pool(list, n) {
  const count = { plan: 0, same: 0, sent: 0 }; let bytes = 0, i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) {
      const key = list[i++];
      const what = await one(key);
      count[what]++;
      if (what !== 'same') bytes += manifest.objects[key].bytes;
      if (what === 'sent' && manifest.objects[key].bytes > 1e6) console.log('sent', key, (manifest.objects[key].bytes / 1e6).toFixed(1), 'MB');
    }
  }));
  return { count, bytes };
}

// Versions first (in parallel), pointers after, one by one.
const body = await pool(order.filter(k => !isPointer(k)), 8);
const ptrs = await pool(order.filter(isPointer), 1);
const c = k => body.count[k] + ptrs.count[k];
console.log(dry ? `dry run: ${c('plan')} objects, ${((body.bytes + ptrs.bytes) / 1e6).toFixed(1)} MB, manifest checked against disk`
  : `done: ${c('sent')} sent (${((body.bytes + ptrs.bytes) / 1e6).toFixed(1)} MB), ${c('same')} already there; current ${JSON.stringify(manifest.current)}`);
