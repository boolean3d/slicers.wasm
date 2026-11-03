// The play package of the KiCad browser build: the three programs (project manager, schematic editor, PCB editor) under
// one address, /kicad/, each file already compressed, its headers in manifest.json (the slicers' package format, read by
// play/serve.mjs). Ported from this repository's package/package.mjs (no lazy split: KiCad's data is 26 MB, shared).
//
//   node kicad-package.mjs --src <kgui/web> --kicad 10.0.7 --version 10.0.7-k1 --out <dir> --here <this folder>
//        --licence <KiCad LICENSE.GPLv3> --source <SOURCE.txt> --homesync <home-sync.js> [--scripts <slicer repo package/>]
//   --scripts: the project hookup the slicers' package.mjs ships, project-folder.js and workspace-bar.js from that folder,
//   after home-sync.js on each program page (a static host serves them as they are; play/serve.mjs used to add them).
//
//   <out>/kicad/index.html                     never cached: sends the browser on to the current version (address kept)
//   <out>/kicad/<version>/index.html           the demo picker (start.html)
//   <out>/kicad/<version>/kicad/index.{html,js,wasm}   the program (project manager + both editors; page never cached)
//   <out>/kicad/<version>/index.data           the files all three read (demos, Python's library, fonts): one copy
//   <out>/kicad/<version>/{kicad-credit.js,backdrop.webp,home-sync.js,LICENSE.txt,SOURCE.txt}
// One home folder for all three: home-sync.js names its store after the first path piece (b3d-home-kicad).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};
// One program since tree-patch13: the project manager with the schematic and board editors linked in, as on the desktop
// (a board or schematic given alone opens in its editor, tree-patch14).
const PROGS = ['kicad'];

if (!isMainThread) {
  const { from, to } = workerData;
  const raw = fs.readFileSync(from);
  const out = zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: raw.length > 4e6 ? 24 : 22,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
  fs.writeFileSync(to, out);
  parentPort.postMessage(out.length);
} else {
  await main();
}

async function main() {
  const a = {};
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  for (const k of ['src', 'kicad', 'version', 'out', 'here', 'licence', 'source', 'homesync']) if (!a[k]) throw new Error('missing --' + k);
  if (!/^[\w.-]+$/.test(a.version)) throw new Error('bad --version');
  const src = path.resolve(a.src), out = path.resolve(a.out), here = path.resolve(a.here);
  fs.rmSync(path.join(out, 'kicad', a.version), { recursive: true, force: true });

  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
    '.data': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };
  const YEAR = 'public, max-age=31536000, immutable, no-transform';
  const NEVER = 'no-cache, no-transform';
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-package-'));
  const stageFile = (name, text) => { const f = path.join(stage, name.replace(/\//g, '_')); fs.writeFileSync(f, text); return f; };
  const files = [];
  const add = (rel, from, cache = YEAR) => files.push({ rel, from, cache });

  // The three programs carry the same index.data (one preload list): checked, then served once.
  const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const dataSha = PROGS.map(p => sha(path.join(src, p, 'index.data')));
  if (new Set(dataSha).size !== 1) throw new Error('the three index.data differ');
  add('index.data', path.join(src, 'kicad', 'index.data'));
  add('kicad-credit.js', path.join(here, 'kicad-credit.js'));
  // The loading screen's backdrop (kicad-credit.js): a small blurred picture of KiCad's window, beside this script.
  const backdrop = path.join(here, 'backdrop-kicad.webp');
  if (fs.existsSync(backdrop)) add('backdrop.webp', backdrop);
  add('home-sync.js', path.resolve(a.homesync));
  const HOOKUP = a.scripts ? ['project-folder.js', 'workspace-bar.js'] : [];
  for (const s of HOOKUP) add(s, path.join(path.resolve(a.scripts), s));
  // KiCad's stock symbol and footprint libraries (kicad-gerbers-1): --libs <folder with kicad-symbols/ and kicad-footprints/,
  // checked out at --libtag>. One object per library (a pack: a zero byte, then its files in name order) under
  // kicad/lib-<tag>/, shared by every version; the list + the stock tables in <version>/kicad-libs-list.js; kicad-libs.js
  // makes the files in the tab and reads a pack when KiCad first reads one of its files.
  const LIBS = a.libs ? ['kicad-libs-list.js', 'kicad-libs.js'] : [];
  if (a.libs) {
    const tag = a.libtag; if (!/^[\w.-]+$/.test(tag || '')) throw new Error('bad --libtag');
    const sets = {}, root = path.resolve(a.libs);
    // Symbols as KiCad's own installers ship them (kicad-gerbers-3): one .kicad_sym file per library, packed from the
    // repo's .kicad_symdir folders by the repo's tools/kicad_lib_pack.py (KICAD_PACK_SYM_LIBRARIES) into
    // kicad-symbols-packed/ with its table; the folder layout made KiCad open 22.7k files at start. A flat set's library
    // is one file straight in the set's folder.
    for (const [k, repo, ext, dir, flat] of [['symbols', 'kicad-symbols-packed', '.kicad_sym', '/kicad/share/kicad/symbols', true],
                                        ['footprints', 'kicad-footprints', '.pretty', '/kicad/share/kicad/footprints', false]]) {
      const libs = {};
      for (const d of fs.readdirSync(path.join(root, repo)).filter(n => n.endsWith(ext)).sort()) {
        const lib = d.slice(0, -ext.length), names = flat ? [d] : fs.readdirSync(path.join(root, repo, d)).filter(n => fs.statSync(path.join(root, repo, d, n)).isFile()).sort();
        const bufs = names.map(n => fs.readFileSync(flat ? path.join(root, repo, n) : path.join(root, repo, d, n)));
        libs[lib] = names.map((n, i) => [n, bufs[i].length]);
        const f = path.join(stage, 'pack-' + k + '-' + lib);
        fs.writeFileSync(f, Buffer.concat([Buffer.from([0]), ...bufs]));
        files.push({ rel: '../lib-' + tag + '/' + k + '/' + encodeURIComponent(lib) + '.pack', from: f, cache: YEAR, type: 'application/octet-stream' });
      }
      sets[k] = { dir, ext, libs, flat };
      files.push({ rel: '../lib-' + tag + '/' + k + '-LICENSE.md', from: path.join(root, 'kicad-' + k, 'LICENSE.md'), cache: YEAR, type: 'text/markdown; charset=utf-8' });
    }
    const tables = { sym: fs.readFileSync(path.join(root, 'kicad-symbols-packed', 'sym-lib-table'), 'utf8'),
                     fp: fs.readFileSync(path.join(root, 'kicad-footprints', 'fp-lib-table'), 'utf8') };
    add('kicad-libs-list.js', stageFile('kicad-libs-list.js', 'window.KICAD_LIBS=' + JSON.stringify({ base: '../../lib-' + tag + '/', tag, settings: a.kicad.split('.').slice(0, 2).join('.'), sets, tables }) + ';\n'));
    add('kicad-libs.js', path.join(here, 'kicad-libs.js'));
  }
  add('LICENSE.txt', path.resolve(a.licence));
  add('SOURCE.txt', path.resolve(a.source));
  // The libraries built in carry their own licences and copyright notices (BSD, MIT, Boost, SGI B ask for the notice in a binary copy).
  add('NOTICES.txt', path.resolve(a.notices || path.join(here, 'NOTICES.txt')));
  add('index.html', stageFile('start.html', fs.readFileSync(path.join(here, 'start.html'), 'utf8').replaceAll('@KICAD@', a.kicad)), NEVER);
  const pages = [];
  for (const p of PROGS) {
    const html = fs.readFileSync(path.join(src, p, 'index.html'), 'utf8');
    const tag = '<script async src=index.js>';
    if (html.split(tag).length !== 2) throw new Error(p + '/index.html: no single "' + tag + '"');
    const f = stageFile(p + '-index.html', '');
    pages.push({ p, html, tag, f });
    add(p + '/index.html', f, NEVER);
    add(p + '/index.js', path.join(src, p, 'index.js'));
    add(p + '/index.wasm', path.join(src, p, 'index.wasm'));
    // The web view's service worker (the port registers "wxwebview-sw.js" beside the page, scope "./"): KiCad's web views
    // (the new project's template preview) show their pages through it. Revalidated: a browser keeps an installed worker.
    add(p + '/wxwebview-sw.js', path.join(here, 'wxwebview-sw.js'), NEVER);
  }

  const cache = path.join(out, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  files.forEach(f => { f.raw = fs.statSync(f.from).size; f.ext = path.extname(f.rel).toLowerCase();
    f.key = path.posix.normalize('kicad/' + a.version + '/' + f.rel); f.to = path.join(out, f.key); });
  files.sort((x, y) => y.raw - x.raw);
  // pages are never cached and stored as they are (as package.mjs does): the host check compares a page's bytes as served
  const jobs = files.filter(f => f.raw > 256 && f.cache !== NEVER);
  const width = Math.max(1, Math.min(Number(a.jobs) || os.cpus().length, 24));
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length) {
      const f = jobs[next++];
      fs.mkdirSync(path.dirname(f.to), { recursive: true });
      // Brotli at quality 11 takes minutes on the big files: kept by the source's sha256 for the next package.
      const cached = path.join(cache, sha(f.from) + '.br');
      if (!fs.existsSync(cached)) await new Promise((res, rej) => {
        const part = cached + '.' + process.pid + '.' + next + '.part';
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: { from: f.from, to: part } });
        w.once('message', () => { fs.renameSync(part, cached); res(); }); w.once('error', rej);
      });
      fs.copyFileSync(cached, f.to);
      f.stored = fs.statSync(f.to).size;
      if (f.stored > 0.95 * f.raw) { fs.copyFileSync(f.from, f.to); f.stored = f.raw; } else f.encoding = 'br';
    }
  }));

  // Each program's page: the credit screen, the shared data one folder up, the home folder, before index.js.
  const data = files.find(f => f.rel === 'index.data');
  for (const pg of pages) {
    const page = { prog: pg.p, kicad: a.kicad, version: a.version, dataRaw: data.raw, dataSent: data.stored,
      ...(fs.existsSync(backdrop) ? { backdrop: '../backdrop.webp' } : {}) };
    // The backdrop is asked for with the page's first bytes, ahead of the program, so it paints at once.
    const inject = (page.backdrop ? '<link rel=preload as=image href=../backdrop.webp fetchpriority=high>' : '') + '<script>window.KICAD_PAGE=' + JSON.stringify(page) + ';'
      + 'Module.locateFile=function(p,d){return p==="index.data"?"../index.data":(d||"")+p};</script>'
      + '<script src=../kicad-credit.js></script><script src=../home-sync.js></script>'
      + HOOKUP.map(s => '<script src=../' + s + '></script>').join('')
      + LIBS.map(s => '<script src=../' + s + '></script>').join('');
    // index.js is loaded with the page's ?gl= (and ?glcache=) test switches in its address (kicad-pre.js): the program's threads start from that
    // address and see only its own query, not the page's.
    // (kicad-play-10) the glcache= test switch of the GL stand-in travels the same way
    const load = '<script>(function(){var s=document.createElement("script"),q=new URLSearchParams(location.search),p=new URLSearchParams();'
      + '["gl","glcache","glattr"].forEach(function(k){if(q.get(k))p.set(k,q.get(k))});var t=p.toString();'
      + 's.src="index.js"+(t?"?"+t:"");document.body.appendChild(s)})()</script>';
    fs.writeFileSync(pg.f, pg.html.replace(pg.tag + '</script>', inject + load).replace('<title></title>', '<title>KiCad</title>'));
  }
  for (const f of files) {
    if (f.stored !== undefined) continue;
    fs.mkdirSync(path.dirname(f.to), { recursive: true });
    fs.copyFileSync(f.from, f.to);
    f.raw = f.stored = fs.statSync(f.to).size;
  }

  const top = path.join(out, 'kicad', 'index.html');
  // The host's one lasting address: /kicad/ starts KiCad on its Project Manager, as on a computer (kicad-entry-1103:
  // never a demo list first; the demos open from KiCad's Open box, boolean3d-folder.js), ?project=&open= kept.
  fs.writeFileSync(top, kicadTopPage(a.version));

  const mf = path.join(out, 'manifest.json');
  const manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : { objects: {} };
  manifest.objects['kicad/index.html'] = { type: TYPES['.html'], cache: NEVER, bytes: fs.statSync(top).size,
    raw: fs.statSync(top).size, sha256: sha(top) };
  for (const f of files.sort((x, y) => x.key < y.key ? -1 : 1)) {
    manifest.objects[f.key] = { type: f.type || TYPES[f.ext] || 'application/octet-stream', ...(f.encoding ? { encoding: f.encoding } : {}),
      cache: f.cache, bytes: f.stored, raw: f.raw, sha256: sha(f.to) };
  }
  manifest.current = { ...(manifest.current || {}), kicad: a.version };
  manifest.headers = HEADERS;
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 1));
  fs.rmSync(stage, { recursive: true, force: true });
  const sum = pick => files.filter(pick).reduce((s, f) => s + f.stored, 0);
  for (const p of PROGS) console.log(`${p}: first visit ${((sum(f => f.rel.startsWith(p + '/')) + data.stored) / 1e6).toFixed(1)} MB`);
  console.log(`kicad ${a.version}: ${files.length} files, ${(sum(() => true) / 1e6).toFixed(1)} MB stored`);
}

/** /kicad/index.html: forward to <version>/kicad/ (the Project Manager), the address kept (same page as kicad-hookup.mjs). */
function kicadTopPage(version) {
  return '<!doctype html><meta charset=utf-8><title>KiCad</title><script>location.replace('
    + JSON.stringify(version + '/kicad/') + '+location.search+location.hash)</script>';
}
