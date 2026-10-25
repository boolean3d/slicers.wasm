// Serves a package made by package.mjs the way the public host will: each object's stored bytes with the content
// type, content encoding and cache control from manifest.json, and the slicer host's headers on every response.
// Nothing else (no on-the-fly compression, no directory listing). Logs every miss, so a file the slicer asks for
// that the package left out shows up. It is also the slicers' network relay (relay.mjs): <app>/relay for their
// connections to the slicer makers' servers (profile updates, model sites) and <app>/fetch for those sites' pictures,
// as a public host needs it; without it the slicers still run, offline.
//   node serve-package.mjs <package dir> <port>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { attach } from '../orcaslicer/shared/net/relay.mjs';

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 8800);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const H = manifest.headers;
let served = 0, bytes = 0;

const server = http.createServer((req, res) => {
  let key;
  try { key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''); } catch { res.writeHead(400, H); return res.end(); }
  if (key === '' || key.endsWith('/')) key += 'index.html';
  let o = manifest.objects[key];
  if (!o && manifest.objects[key + '/index.html']) { res.writeHead(301, { ...H, Location: '/' + key + '/' }); return res.end(); }
  if (!o) { console.log('MISS ' + key); res.writeHead(404, H); return res.end(); }
  const headers = { ...H, 'Content-Type': o.type, 'Cache-Control': o.cache, ETag: '"' + o.sha256.slice(0, 32) + '"', 'Content-Length': o.bytes };
  if (o.encoding) headers['Content-Encoding'] = o.encoding;
  if (req.headers['if-none-match'] === headers.ETag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, headers);
  served++; bytes += o.bytes;
  if (/index\.(wasm|data)$/.test(key)) console.log(`GET ${key} ${(o.bytes / 1e6).toFixed(1)} MB (requests ${served}, ${(bytes / 1e6).toFixed(1)} MB)`);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(path.join(root, key)).on('error', () => res.destroy()).pipe(res);
});
attach(server, { log: (s) => console.log(s) });
server.listen(port, '0.0.0.0', () => console.log('package on :' + port));
process.on('SIGUSR2', () => console.log(`TOTAL requests ${served}, ${(bytes / 1e6).toFixed(1)} MB`));
