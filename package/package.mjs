// Makes the public package of one slicer build: the files a static host (an object store behind a CDN) serves, each
// already compressed, with the headers it must be served with written in manifest.json.
//
//   node package.mjs --app bambu --src <build dir> --version 2.08.02.61-1 --out <dir> [--source <url>] [--licence <file>]
//                    [--start bambu-start.txt]
//
// <build dir> holds what the build makes: <program>.html, <program>.js, <program>.wasm, <program>.data (program =
// bambustudio, orcaslicer or prusaslicer), wxwebview-sw.js and resources/ (only resources/web is read from the network;
// the rest is inside <program>.data). The package is
//   <out>/<app>/index.html             tiny, never cached: sends the browser on to the current version (address kept)
//   <out>/<app>/<version>/...          the build, cached for a year (a new build = a new version folder)
//   <out>/<app>/wxwebview-sw.js        the web view's service worker, never cached: at the app folder so its scope
//                                      holds both the page and the slicer's web pages (<program>.js is pointed at it)
//   <out>/<app>/resources/web/...      the slicer's own web pages (it opens them as file:///<app>/resources/web/), an hour
//   <out>/<app>/resources/profiles/<maker>/<model>_cover.png   the printer pictures those pages show, an hour
//   <out>/manifest.json                every object: content type, content encoding, cache control, sizes, sha256
//   <out>/headers.txt                  the headers every response of the slicer host must carry (cross-origin isolation)
// With --start <list> the first visit downloads only the files the program reads to bring its first screens up
// (splitData below): <version>/<program>.data holds those, <version>/files/<app>/resources/... every other file, one
// object each, fetched by install-and-lazy-load.js when the program first reads it, and kept by the web view's service worker.
// The bytes stored under a path are the brotli bytes when "encoding" is "br": upload them with Content-Encoding: br.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Every response from the slicer host. Threads need SharedArrayBuffer, which needs cross-origin isolation.
const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

if (!isMainThread) {
  // One compression job: brotli, best quality, large window for the big files.
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
  for (const k of ['app', 'src', 'version', 'out']) if (!a[k]) throw new Error('missing --' + k);
  if (!/^[a-z]+$/.test(a.app) || !/^[\w.-]+$/.test(a.version)) throw new Error('bad --app or --version');
  const src = path.resolve(a.src), out = path.resolve(a.out);
  const dir = path.join(out, a.app, a.version);
  // The program's files are named after the slicer; the page that loads them is index.html at every address.
  const PROGRAM = { bambu: 'bambustudio', orca: 'orcaslicer', prusa: 'prusaslicer' }[a.app];
  if (!PROGRAM) throw new Error('--app must be bambu, orca or prusa');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
    '.data': 'application/octet-stream', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp',
    '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.map': 'application/json', '.md': 'text/plain; charset=utf-8' };
  // Already-compressed formats are stored as they are.
  const PACKED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.mp4', '.webm']);
  const YEAR = 'public, max-age=31536000, immutable, no-transform';
  const NEVER = 'no-cache, no-transform';

  const HOUR = 'public, max-age=3600, no-transform';
  const files = [];   // { rel, from, cache, top }: top = at <app>/<rel>, outside the version folder
  const add = (rel, from, cache = YEAR, top = false) => files.push({ rel, from, cache, top });

  // The page: the credit screen and the part opener go in after the page's Module set-up, before the program's script.
  const html = fs.readFileSync(path.join(src, PROGRAM + '.html'), 'utf8');
  const tag = '<script async src=' + PROGRAM + '.js>';
  if (html.split(tag).length !== 2) throw new Error(PROGRAM + '.html: no single "' + tag + '"');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'slicer-package-'));
  const stageFile = (name, text) => { const f = path.join(stage, name); fs.writeFileSync(f, text); return f; };
  // index.html is written once the program's data file is compressed: the credit screen needs both of its sizes (the download
  // counts unpacked bytes, the browser is sent the packed ones).
  const pageFile = path.join(stage, 'index.html');
  fs.writeFileSync(pageFile, '');
  add('index.html', pageFile, NEVER);
  add('credit.js', path.join(HERE, 'credit.js'));
  add('home-folder-sync.js', path.join(HERE, 'home-folder-sync.js'));
  add('boolean3d-folder.js', path.join(HERE, 'boolean3d-folder.js'));
  add('open-part-from-link.js', path.join(HERE, 'open-part-from-link.js'));
  add(PROGRAM + '.wasm', path.join(src, PROGRAM + '.wasm'));
  // The web view's service worker must revalidate (a browser keeps an installed worker otherwise). It is served from
  // the app folder, not the version folder: the port registers it beside the page with scope "./", which in a version
  // folder leaves out the slicer's web pages (/<app>/resources/web/..., below). A page outside the worker's scope
  // gets no window.wx before its first script, so whatever it asks the slicer at load is lost (the setup wizard's
  // printer list stays empty). The program's script is pointed one folder up for both the worker and its scope.
  let sw = fs.realpathSync(path.join(src, 'wxwebview-sw.js'));
  const REGISTER = 'navigator.serviceWorker.register("wxwebview-sw.js",{scope:"./"})';
  const upOne = js => {
    if (js.split(REGISTER).length !== 2) throw new Error(PROGRAM + '.js: no single ' + REGISTER);
    return js.replace(REGISTER, 'navigator.serviceWorker.register("../wxwebview-sw.js",{scope:"../"})');
  };
  let inject2 = '', fileList = null;
  if (a.start) {
    // Lazy loading: the program's data file keeps the start files only; every other file is its own object, fetched when read.
    const split = splitData(src, PROGRAM, path.resolve(a.start), a.app, a.version,
      ['credit.js', 'home-folder-sync.js', 'boolean3d-folder.js', 'open-part-from-link.js', 'files.js', 'install-and-lazy-load.js'], stageFile, stage);
    add(PROGRAM + '.js', stageFile(PROGRAM + '.js', upOne(fs.readFileSync(split.js, 'utf8'))));
    add(PROGRAM + '.data', split.data);
    add('files.js', split.listFile);
    fileList = split.list;
    add('install-and-lazy-load.js', path.join(HERE, 'install-and-lazy-load.js'));
    for (const f of split.files) add('files' + f.path, f.from);
    // The page's cache keeper joins the web view's own worker (one worker per scope), told which version folder it keeps.
    sw = stageFile('wxwebview-sw.js', fs.readFileSync(sw, 'utf8') + '\nself.SLICER_VERSION_DIR = ' + JSON.stringify(a.version + '/')
      + ';\n' + fs.readFileSync(path.join(HERE, 'slicer-cache-service-worker.js'), 'utf8'));
    // install-and-lazy-load.js installs the program in the browser first (every file into browser storage), then loads its script.
    inject2 = '<script src=files.js></script><script src=install-and-lazy-load.js></script>';
    console.log(`${a.app}: start ${split.startCount} files (${(split.startRaw / 1e6).toFixed(1)} MB raw), `
      + `${split.files.length} fetched when read (${(split.lazyRaw / 1e6).toFixed(1)} MB raw), ${split.fonts} fonts by address`);
  } else {
    add(PROGRAM + '.js', stageFile(PROGRAM + '.js', upOne(fs.readFileSync(path.join(src, PROGRAM + '.js'), 'utf8'))));
    add(PROGRAM + '.data', path.join(src, PROGRAM + '.data'));
  }
  add('wxwebview-sw.js', sw, NEVER, true);
  if (a.licence) add('LICENSE.txt', path.resolve(a.licence));
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = rel + '/' + e.name;
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p, r); else add(r, fs.realpathSync(p), HOUR, true);
    }
  };
  // The slicer's web pages (setup wizard, home page) are opened as file:///<app>/resources/web/..., which the web
  // view asks the host for at /<app>/resources/web/...: they live outside the version folder, kept an hour.
  fs.rmSync(path.join(out, a.app, 'resources'), { recursive: true, force: true });
  walk(fs.realpathSync(path.join(src, 'resources', 'web')), 'resources/web');
  // Those pages also show files that are only in the program's data file: the setup wizard's printer pictures (OrcaSlicer's
  // guide/21 takes each model's "cover", file:///<app>/resources/profiles/<maker>/<model>_cover.png). Written out
  // beside the pages, so the browser fetches one when the page shows it.
  {
    const { meta } = packageList(fs.readFileSync(path.join(src, PROGRAM + '.js'), 'utf8'));
    const root = '/' + a.app + '/resources/', data = fs.openSync(path.join(src, PROGRAM + '.data'));
    for (const f of meta.files) {
      const rel = f.filename.startsWith(root) ? f.filename.slice(root.length) : '';
      if (!/^profiles\/[^/]+\/[^/]+_cover\.png$/.test(rel)) continue;
      const b = Buffer.alloc(f.end - f.start);
      fs.readSync(data, b, 0, b.length, f.start);
      const to = path.join(stage, 'shown', rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, b);
      add('resources/' + rel, to, HOUR, true);
    }
    fs.closeSync(data);
  }

  // The address without a version: forwards to the current version, keeping ?arguments and #hash.
  const fwd = '<!doctype html><meta charset=utf-8><title>' + a.app + '</title><script>location.replace('
    + JSON.stringify(a.version + '/') + '+location.search+location.hash)</script>';
  const top = path.join(out, a.app, 'index.html');
  fs.writeFileSync(top, fwd);

  // files.js, now that every file is known: the install list (install-and-lazy-load.js) = the start files, the files read when needed,
  // the fonts, and the files outside the version folder the program's web pages show (resources/...).
  if (fileList) {
    const hashFile = f => contentHash(fs.readFileSync(f.from));
    fileList.startFiles = files.filter(f => !f.top && !f.rel.startsWith('files/') && !['index.html', 'files.js'].includes(f.rel))
      .map(f => [f.rel, fs.statSync(f.from).size, hashFile(f)]);
    fileList.top = files.filter(f => f.top && f.rel.startsWith('resources/')).map(f => [f.rel, fs.statSync(f.from).size, hashFile(f)]);
    fs.writeFileSync(files.find(f => f.rel === 'files.js').from, 'window.SLICER_FILES=' + JSON.stringify(fileList) + ';\n');
  }
  const cache = path.join(out, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  // Compress in parallel, biggest first.
  files.forEach(f => { f.raw = fs.statSync(f.from).size; f.ext = path.extname(f.rel).toLowerCase();
    f.key = a.app + '/' + (f.top ? '' : a.version + '/') + f.rel; f.to = path.join(out, f.key); });
  files.sort((x, y) => y.raw - x.raw);
  const jobs = files.filter(f => !PACKED.has(f.ext) && f.raw > 256 && f.from !== pageFile);
  const width = Math.max(1, Math.min(Number(a.jobs) || os.cpus().length, 24));
  let next = 0;
  const inflight = new Map();
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length) {
      const f = jobs[next++];
      const to = f.to;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      // Brotli at quality 11 takes minutes on the big files: kept by the source's sha256 for the next package.
      // The same file can be in a package twice (the web pages share some): one compression each.
      const cached = path.join(cache, sha(f.from) + '.br');
      if (!fs.existsSync(cached)) {
        if (!inflight.has(cached)) inflight.set(cached, new Promise((res, rej) => {
          const part = cached + '.' + process.pid + '.part';
          const w = new Worker(fileURLToPath(import.meta.url), { workerData: { from: f.from, to: part } });
          w.once('message', () => { fs.renameSync(part, cached); res(); }); w.once('error', rej);
        }));
        await inflight.get(cached);
      }
      fs.copyFileSync(cached, to);
      f.stored = fs.statSync(to).size;
      // Brotli that saves under 5% is not worth the header.
      if (f.stored > 0.95 * f.raw) { fs.copyFileSync(f.from, to); f.stored = f.raw; } else f.encoding = 'br';
    }
  }));
  const data = files.find(f => f.rel === PROGRAM + '.data');
  const page = { app: a.app, program: PROGRAM, version: a.version, source: a.source || '', dataRaw: data.raw, dataSent: data.stored };
  if (fileList) {
    // The whole install, as unpacked and as sent: the install screen counts unpacked bytes and shows the sent size.
    const inst = files.filter(f => (!f.top || f.rel.startsWith('resources/')) && !['index.html', 'files.js'].includes(f.rel));
    page.installRaw = inst.reduce((s, f) => s + f.raw, 0); page.installSent = inst.reduce((s, f) => s + (f.stored ?? f.raw), 0);
  }
  const inject = '<script>window.SLICER_PAGE=' + JSON.stringify(page) + '</script><script src=credit.js></script>'
    + '<script src=home-folder-sync.js></script><script src=boolean3d-folder.js></script><script src=open-part-from-link.js></script>' + inject2;
  // With an install (install-and-lazy-load.js) the page does not load the program's script itself: install-and-lazy-load.js does, once the program is in the browser.
  fs.writeFileSync(pageFile, fileList ? html.replace(tag + '</script>', inject) : html.replace(tag, inject + tag));
  for (const f of files) {
    if (f.stored !== undefined) continue;
    const to = f.to;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f.from, to);
    f.raw = f.stored = fs.statSync(to).size;
  }

  // manifest.json gathers every app packaged into <out>.
  const mf = path.join(out, 'manifest.json');
  const manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : { objects: {} };
  for (const k of Object.keys(manifest.objects)) if (k.startsWith(a.app + '/')) delete manifest.objects[k];
  manifest.objects[a.app + '/index.html'] = { type: TYPES['.html'], cache: NEVER, bytes: fs.statSync(top).size,
    raw: fs.statSync(top).size, sha256: sha(top) };
  for (const f of files.sort((x, y) => x.key < y.key ? -1 : 1)) {
    manifest.objects[f.key] = { type: TYPES[f.ext] || 'application/octet-stream', ...(f.encoding ? { encoding: f.encoding } : {}),
      cache: f.cache, bytes: f.stored, raw: f.raw, sha256: sha(f.to) };
  }
  manifest.current = { ...(manifest.current || {}), [a.app]: a.version };
  manifest.headers = HEADERS;
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 1));
  fs.writeFileSync(path.join(out, 'headers.txt'), Object.entries(HEADERS).map(([k, v]) => k + ': ' + v).join('\n') + '\n');
  fs.rmSync(stage, { recursive: true, force: true });

  const sum = (pick) => files.filter(pick).reduce((s, f) => s + f.stored, 0);
  const first = sum(f => ['index.html', 'credit.js', 'home-folder-sync.js', 'boolean3d-folder.js', 'open-part-from-link.js', 'files.js', 'install-and-lazy-load.js', PROGRAM + '.js', PROGRAM + '.wasm', PROGRAM + '.data',
    'wxwebview-sw.js'].includes(f.rel));
  console.log(`${a.app} ${a.version}: ${files.length} files, ${(sum(() => true) / 1e6).toFixed(1)} MB stored, `
    + `first visit ${(first / 1e6).toFixed(1)} MB (raw ${(files.filter(f => !f.rel.startsWith('resources/')).reduce((s, f) => s + f.raw, 0) / 1e6).toFixed(1)} MB)`);
}


// --start <list>: splits the program's data file. The list names the files the program reads before its first screens are up
// (paths under <app>/resources/, * within a folder, ** across folders, !pattern takes files back out; # comments).
// Those stay in <program>.data (<program>.js's file list is rewritten to match); every other file is written out to be its
// own object, files/<app>/resources/..., which install-and-lazy-load.js fetches when the program first reads it. Fonts the port hands
// to the browser itself (its FACES table in <program>.js) that are not start files leave the file system: install-and-lazy-load.js adds
// them as FontFaces by address, covering the characters of their own character map.
// <program>.js's list of the files in <program>.data ({files: [{filename, start, end}, ...], ...}) and where it is written.
function packageList(js) {
  const at = js.indexOf('loadPackage({files:');
  if (at < 0 || js.indexOf('loadPackage({files:', at + 1) >= 0) throw new Error('the program script: no single loadPackage({files:');
  const open = at + 'loadPackage('.length;
  let depth = 0, end = open;
  for (; end < js.length; end++) { if (js[end] === '{') depth++; else if (js[end] === '}' && --depth === 0) break; }
  return { open, end, meta: Function('return ' + js.slice(open, end + 1))() };
}

function splitData(src, program, listFile, app, version, pageScripts, stageFile, stage) {
  const js = fs.readFileSync(path.join(src, program + '.js'), 'utf8');
  const { open, end, meta } = packageList(js);
  const facesAt = /var FACES=(\{[^}]*\})/.exec(js);
  const faces = facesAt ? JSON.parse(facesAt[1]) : {};

  const glob = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?|\*/g,
    m => m === '*' ? '[^/]*' : '(?:.*/)?') + '$');
  const keep = [], drop = [];
  for (let line of fs.readFileSync(listFile, 'utf8').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('!')) drop.push(glob(line.slice(1))); else keep.push(glob(line));
  }
  const root = '/' + app + '/resources/';
  const data = fs.openSync(path.join(src, program + '.data'));
  const bytes = f => { const b = Buffer.alloc(f.end - f.start); fs.readSync(data, b, 0, b.length, f.start); return b; };
  const start = [], lazy = [], fonts = [];
  for (const f of meta.files) {
    const rel = f.filename.startsWith(root) ? f.filename.slice(root.length) : null;
    const isStart = rel === null || (keep.some(r => r.test(rel)) && !drop.some(r => r.test(rel)));
    const name = path.basename(f.filename);
    if (isStart) start.push(f);
    else if (rel.startsWith('fonts/') && faces[name]) fonts.push(f);
    else lazy.push(f);
  }
  if (!start.length) throw new Error(listFile + ': no start files');

  // The start data file, and the program's script with its file list.
  const out = path.join(stage, program + '.data');
  const fd = fs.openSync(out, 'w');
  let pos = 0;
  const files = start.map(f => { const b = bytes(f); fs.writeSync(fd, b); const e = { ...f, start: pos, end: pos + b.length }; pos += b.length; return e; });
  fs.closeSync(fd);
  const newMeta = { ...meta, files, remote_package_size: pos };
  const jsOut = stageFile(program + '.js', js.slice(0, open) + JSON.stringify(newMeta) + js.slice(end + 1));

  // Every other file, and the list install-and-lazy-load.js reads.
  // install-and-lazy-load.js reads a file as text in the x-user-defined charset (a synchronous request cannot ask for bytes), and a
  // text decoder obeys a byte-order mark at the start whatever the charset: a file starting with one is stored with
  // one extra byte in front, which install-and-lazy-load.js drops (the third field of its entry).
  const BOM = b => (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) || (b[0] === 0xFE && b[1] === 0xFF) || (b[0] === 0xFF && b[1] === 0xFE);
  const written = [], padded = new Set(), hashOf = {};
  for (const f of [...lazy, ...fonts]) {
    const to = path.join(stage, 'files', f.filename);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    let b = bytes(f);
    if (lazy.includes(f) && BOM(b)) { b = Buffer.concat([Buffer.from([0]), b]); padded.add(f.filename); }
    fs.writeFileSync(to, b);
    hashOf[f.filename] = contentHash(b);
    written.push({ path: f.filename, from: to });
  }
  const list = {
    cache: 'b3d-slicer-files-' + app + '-' + version,
    start: [program + '.js', program + '.wasm', program + '.data', ...pageScripts],
    base: 'files',
    // [path, bytes, skip, hash]: hash = of the stored bytes (the browser keeps a file it already has under that name)
    files: lazy.map(f => [f.filename, f.end - f.start, padded.has(f.filename) ? 1 : 0, hashOf[f.filename]]),
    fonts: fonts.map(f => { const [family, weight] = faces[path.basename(f.filename)];
      return { path: f.filename, family, weight, range: unicodeRange(bytes(f)), bytes: f.end - f.start, hash: hashOf[f.filename] }; }),
  };
  fs.closeSync(data);
  return {
    js: jsOut, data: out, list, listFile: stageFile('files.js', ''), files: written,
    startCount: start.length, startRaw: pos, fonts: fonts.length,
    lazyRaw: [...lazy, ...fonts].reduce((s, f) => s + f.end - f.start, 0),
  };
}

// The characters a TrueType/OpenType font covers, from its cmap (format 12, else format 4), as a CSS unicode-range.
function unicodeRange(b) {
  const n = b.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < n; i++) if (b.toString('latin1', 12 + 16 * i, 16 + 16 * i) === 'cmap') cmap = b.readUInt32BE(20 + 16 * i);
  if (cmap < 0) throw new Error('font without cmap');
  const subs = [];
  for (let i = 0, k = b.readUInt16BE(cmap + 2); i < k; i++) {
    const r = cmap + 4 + 8 * i, off = cmap + b.readUInt32BE(r + 4);
    subs.push({ pid: b.readUInt16BE(r), eid: b.readUInt16BE(r + 2), off, fmt: b.readUInt16BE(off) });
  }
  const pick = subs.find(s => s.fmt === 12 && (s.pid === 3 || s.pid === 0)) || subs.find(s => s.fmt === 4 && (s.pid === 3 || s.pid === 0));
  if (!pick) throw new Error('font without a Unicode cmap');
  const ranges = [];
  if (pick.fmt === 12) {
    for (let i = 0, k = b.readUInt32BE(pick.off + 12); i < k; i++) {
      const g = pick.off + 16 + 12 * i;
      ranges.push([b.readUInt32BE(g), b.readUInt32BE(g + 4)]);
    }
  } else {
    const seg = b.readUInt16BE(pick.off + 6) / 2, ends = pick.off + 14, starts = ends + 2 * seg + 2;
    const deltas = starts + 2 * seg, offs = deltas + 2 * seg;
    for (let i = 0; i < seg; i++) {
      const s = b.readUInt16BE(starts + 2 * i), e = b.readUInt16BE(ends + 2 * i);
      if (s === 0xFFFF) continue;
      const ro = b.readUInt16BE(offs + 2 * i), d = b.readInt16BE(deltas + 2 * i);
      // A segment can map some of its characters to glyph 0 (none): keep only the mapped ones.
      let run = -1;
      for (let c = s; c <= e + 1; c++) {
        let g = 0;
        if (c <= e) {
          if (!ro) g = (c + d) & 0xFFFF;
          else { const p = offs + 2 * i + ro + 2 * (c - s); g = p + 1 < b.length ? b.readUInt16BE(p) : 0; if (g) g = (g + d) & 0xFFFF; }
        }
        if (g && run < 0) run = c;
        if (!g && run >= 0) { ranges.push([run, c - 1]); run = -1; }
      }
    }
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of ranges) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  const hex = c => c.toString(16).toUpperCase();
  return merged.map(([s, e]) => s === e ? 'U+' + hex(s) : 'U+' + hex(s) + '-' + hex(e)).join(',');
}

// A file's identity for the browser's copy: the first 20 hex digits of its sha256.
function contentHash(b) { return crypto.createHash('sha256').update(b).digest('hex').slice(0, 20); }
