// Checks a live slicer host against a package's manifest.json: every object answers 200 with its content type, content
// encoding and cache control, every response carries the cross-origin isolation headers, each <app>/ address opens the
// pointer page, and the big files come from the CDN cache on a second request. No dependencies (Node 18+).
//   node check-host.mjs <package dir> https://slicers.example.com/
// A host still closed behind its gate rule: GATE=<cookie value> sends the b3d_gate cookie with every request.
// Requests are paced (4 at a time, ~25 a second) to stay well under the host's per-address rate limit.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [dir, base] = process.argv.slice(2);
if (!dir || !base) { console.error('usage: node check-host.mjs <package dir> <host url>'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const keys = Object.keys(manifest.objects);
const faults = [];
const url = k => new URL(k.split('/').map(encodeURIComponent).join('/'), base).href;
const get = (k, method = 'HEAD') => fetch(url(k), { method, headers: { 'accept-encoding': 'br', ...(process.env.GATE ? { cookie: 'b3d_gate=' + process.env.GATE } : {}) } });

function expect(k, r, o) {
  const want = { 'content-type': o?.type, 'content-encoding': o?.encoding, 'cache-control': o?.cache };
  for (const [h, v] of Object.entries(manifest.headers)) want[h.toLowerCase()] = v;
  if (r.status !== 200) return faults.push(`${k}: ${r.status}`);
  for (const [h, v] of Object.entries(want)) {
    const got = r.headers.get(h) ?? undefined;
    if (got !== v) faults.push(`${k}: ${h} is ${JSON.stringify(got)}, want ${JSON.stringify(v)}`);
  }
}

let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < keys.length) {
    const k = keys[i++];
    await new Promise(r => setTimeout(r, 150));
    try { expect(k, await get(k), manifest.objects[k]); } catch (e) { faults.push(`${k}: ${e.message}`); }
  }
}));

// The addresses the site links to end in "/": the host must answer them with the pointer page.
for (const app of Object.keys(manifest.current)) {
  const r = await get(app + '/', 'GET');
  const text = await r.text();
  if (r.status !== 200 || !text.includes(manifest.current[app] + '/')) faults.push(`${app}/: ${r.status}, not the pointer page`);
  const v = `${app}/${manifest.current[app]}/`;
  // the version address must serve this package's own page, byte for byte (its script names change between builds)
  const page = await get(v, 'GET');
  const sha = createHash('sha256').update(Buffer.from(await page.arrayBuffer())).digest('hex');
  if (page.status !== 200 || sha !== manifest.objects[v + 'index.html']?.sha256) faults.push(`${v}: ${page.status}, not the slicer page`);
}

// A second request of each big file: served from the CDN cache (header only exists behind Cloudflare). Both are GETs:
// Cloudflare answers a HEAD as DYNAMIC whatever the cache holds.
for (const k of keys.filter(k => manifest.objects[k].bytes > 5e6)) {
  const r = await get(k, 'GET'); await r.arrayBuffer();
  const again = await get(k, 'GET'); await again.arrayBuffer(); const c = again.headers.get('cf-cache-status');
  console.log(`${k}: ${(manifest.objects[k].bytes / 1e6).toFixed(1)} MB, cache ${c ?? '(no CDN)'}`);
  if (c && c !== 'HIT') faults.push(`${k}: cf-cache-status ${c} on the second request, want HIT`);
}

console.log(`${keys.length} objects checked, ${faults.length} faults`);
for (const f of faults.slice(0, 40)) console.log('  ' + f);
process.exit(faults.length ? 1 : 0);
