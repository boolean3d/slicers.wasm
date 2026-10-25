// Lays out a Workers project that serves a package made by package.mjs (worker.js beside this file).
//   node make-host.mjs <package dir> <out dir> --name <worker name> --domain <host name> [--relay <https origin>] [--from <app>=<package dir>]...
//   --from takes that app (pointer, version, resources) from another package instead.
//   The relay box wants RELAY_KEY: deploy with cf deploy --secrets-file <file with RELAY_KEY=...>.
// Only what the apps' pointer pages lead to is taken: <app>/index.html, <app>/wxwebview-sw.js, <app>/resources/ and the
// version folder each pointer names (Workers static assets: 20,000 files and 25 MiB a file at most; both checked).
// Then, in <out dir>: npm i && cf deploy.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const from = {}; for (let f; (f = opt('from'));) { const [a, d] = f.split('='); from[a] = path.resolve(d); }
const name = opt('name'), domain = opt('domain'), relay = opt('relay') || '';
const [pkg, out] = args.map(a => path.resolve(a));
if (!pkg || !out || !name || !domain) { console.error('usage: make-host.mjs <package dir> <out dir> --name <worker> --domain <host> [--relay <origin>]'); process.exit(2); }

const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'manifest.json'), 'utf8'));
const appOf = k => k.split('/')[0];
const dirOf = k => from[appOf(k)] || pkg;
const all = {};   // key -> object, from the package that owns its app
for (const d of [pkg, ...Object.values(from)]) {
  const objs = d === pkg ? manifest.objects : JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')).objects;
  for (const [k, o] of Object.entries(objs)) if (dirOf(k) === d) all[k] = o;
}
const keep = new Set();
for (const k of Object.keys(all)) {
  const m = /^([^/]+)\/index\.html$/.exec(k);
  if (!m) continue;
  const html = fs.readFileSync(path.join(dirOf(k), k), 'utf8');   // pointers are stored plain (no-cache, no encoding)
  const v = /location\.replace\("([^"/]+)\//.exec(html);
  if (!v) throw new Error(k + ': no version in the pointer page');
  keep.add(m[1] + '/' + v[1] + '/'); keep.add(m[1] + '/resources/');
  keep.add(k); keep.add(m[1] + '/wxwebview-sw.js');
}
const keys = Object.keys(all).filter(k => keep.has(k) || [...keep].some(p => p.endsWith('/') && k.startsWith(p))).sort();

const types = [], caches = [], objects = {};
const idx = (list, v) => { let i = list.indexOf(v); if (i < 0) { i = list.length; list.push(v); } return i; };
const pub = path.join(out, 'public');
fs.rmSync(pub, { recursive: true, force: true });
let bytes = 0;
for (const k of keys) {
  const o = all[k];
  if (o.bytes > 25 * 1024 * 1024) throw new Error(k + ' is ' + o.bytes + ' bytes: over the 25 MiB a static asset may be');
  objects[k] = [idx(types, o.type), idx(caches, o.cache), o.encoding || '', o.sha256.slice(0, 32)];
  const f = path.join(pub, k);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  try { fs.linkSync(path.join(dirOf(k), k), f); } catch { fs.copyFileSync(path.join(dirOf(k), k), f); }
  bytes += o.bytes;
}
if (keys.length > 20000) throw new Error(keys.length + ' files: over the 20,000 of one Worker version');
// The asset layer must not answer for us: no index pages of its own, nothing it would read as a rule file.
for (const k of ['_headers', '_redirects']) if (objects[k]) throw new Error(k + ' would be read as a rule file');

const headers = { ...manifest.headers, 'X-Robots-Tag': 'noindex' };
fs.mkdirSync(path.join(out, 'src'), { recursive: true });
fs.writeFileSync(path.join(out, 'src/meta.json'), JSON.stringify({ headers, types, caches, objects }));
fs.copyFileSync(new URL('./worker.js', import.meta.url), path.join(out, 'src/index.js'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name, private: true, type: 'module',
  devDependencies: { cf: '1.0.0-beta.18', wrangler: '^4.136.0' } }, null, 1) + '\n');
fs.writeFileSync(path.join(out, 'wrangler.config.ts'),
  'import { defineWranglerConfig } from "wrangler/experimental-config";\n\nexport default defineWranglerConfig({ assetsDirectory: "public" });\n');
fs.writeFileSync(path.join(out, 'cloudflare.config.ts'), `import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.js" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: ${JSON.stringify(name)},
    compatibilityDate: "2026-10-06",
    entrypoint,
    env: { ASSETS: bindings.assets(), RELAY_ORIGIN: bindings.text(${JSON.stringify(relay)}) },
    workersDev: false,
    domains: [${JSON.stringify(domain)}],
    assets: { runWorkerFirst: true, htmlHandling: "none", notFoundHandling: "none" },
  },
});
`);
const pointers = keys.filter(k => /^[^/]+\/index\.html$/.test(k)).map(k => k.split('/')[0] + ' ' + [...keep].find(p => p.startsWith(k.split('/')[0] + '/') && !p.includes('resources') && p.endsWith('/') ));
console.log(`${keys.length} files, ${(bytes / 1e6).toFixed(1)} MB -> ${out} (${pointers.join(', ')})`);
