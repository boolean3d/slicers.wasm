// The page host's side of net-relay.js: a WebSocket endpoint (<page folder>/relay?to=host:port) that opens a TCP
// connection to host:port and passes bytes both ways (Emscripten's sockets speak plain binary frames). Only hosts
// on the allow list (suffix match) and ports 443/80. No dependencies: attach(server) on a node http server.
// Also <page folder>/fetch?url=https://... (GET): the web views' cross-origin pictures (home page model cards, MakerWorld
// thumbnails). The page is cross-origin isolated (COEP require-corp) and those hosts send no CORP/CORS header, so the
// browser refuses them; wxwebview-sw.js sends them here and they come back same-origin. Same allow list, no cookies,
// no identity: only the browser's own User-Agent and Accept go out, as the desktop web view's own picture requests.
import net from 'node:net';
import crypto from 'node:crypto';

// Never the printer makers' own services (the rule of these builds): Bambu Lab and MakerWorld are not on the allow
// list at all, and Prusa Account / Prusa Connect are refused under prusa3d.com. Their sites open in a new tab when the
// user clicks a link, never through here.
export const DEFAULT_ALLOW = ['prusa3d.com', 'prusa3d.cz', 'printables.com', 'orcaslicer.com', 'github.com',
  'githubusercontent.com',
  'storage.googleapis.com'];   // PrusaSlicer's preset repository serves its profile archives from there

export const DENY = ['account.prusa3d.com', 'connect.prusa3d.com'];
const under = (host, d) => host === d || host.endsWith('.' + d);
const allowed = (allow, host) => !DENY.some(d => under(host, d)) && allow.some(d => under(host, d));

async function fetchFor(req, res, allow, log) {
  let url; try { url = new URL(new URL(req.url, 'http://x').searchParams.get('url')); } catch { res.writeHead(400); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  try {
    let r;
    for (let hops = 0; ; hops++) {   // follow redirects only while they stay on the allow list
      if (url.protocol !== 'https:' || !allowed(allow, url.hostname) || hops > 5) { log('fetch refused ' + url.host); res.writeHead(403); return res.end(); }
      r = await fetch(url, { method: req.method, redirect: 'manual', headers: { 'User-Agent': req.headers['user-agent'] || '', Accept: req.headers.accept || '*/*' } });
      if (r.status < 300 || r.status >= 400 || !r.headers.get('location')) break;
      url = new URL(r.headers.get('location'), url);
    }
    const h = { 'Cross-Origin-Resource-Policy': 'same-origin' };
    for (const k of ['content-type', 'cache-control', 'etag', 'last-modified', 'expires']) if (r.headers.get(k)) h[k] = r.headers.get(k);
    log('fetch ' + url.host + ' ' + r.status);
    res.writeHead(r.status, h);
    if (!r.body || req.method === 'HEAD') return res.end();
    for await (const c of r.body) res.write(c);
    res.end();
  } catch (e) { log('fetch ' + url.host + ' ' + e.message); if (!res.headersSent) res.writeHead(502); res.end(); }
}

export function attach(server, { allow = DEFAULT_ALLOW, log = () => {} } = {}) {
  // fetch?url= goes in front of the host's own request handler (taken over, called for every other path)
  const own = server.listeners('request'); server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (new URL(req.url, 'http://x').pathname.endsWith('/fetch')) return fetchFor(req, res, allow, log);
    for (const f of own) f.call(server, req, res);
  });
  server.on('upgrade', (req, sock) => {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.endsWith('/relay')) return sock.destroy();
    const [host, port] = (u.searchParams.get('to') || '').split(':');
    const ok = host && ['443', '80'].includes(port) && allowed(allow, host);
    if (!ok) { log('relay refused ' + host + ':' + port); sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const proto = (req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim()).includes('binary') ? 'Sec-WebSocket-Protocol: binary\r\n' : '';
    const tcp = net.connect(+port, host);
    let open = false; const early = [];
    const frame = (op, data) => {
      const n = data.length; const h = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
        : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
      if (!sock.destroyed) sock.write(Buffer.concat([h, data]));
    };
    const close = () => { if (!sock.destroyed) { frame(8, Buffer.alloc(0)); sock.end(); } tcp.destroy(); };
    tcp.on('connect', () => { open = true; log('relay ' + host + ':' + port); for (const b of early) tcp.write(b); early.length = 0; });
    let down = 0;   // bytes the server sent back (logged at close: proof the call reached it)
    tcp.on('data', d => { down += d.length; frame(2, d); });
    tcp.on('error', e => { log('relay ' + host + ':' + port + ' ' + e.message); close(); });
    tcp.on('close', () => { if (open) log('relay ' + host + ':' + port + ' closed, ' + down + ' bytes back'); close(); });
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n' + proto + '\r\n');
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15, masked = buf[1] & 128; let n = buf[1] & 127, at = 2;
        if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); at = 4; }
        else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); at = 10; }
        const mask = masked ? buf.subarray(at, at + 4) : null; if (masked) at += 4;
        if (buf.length < at + n) return;
        const p = Buffer.from(buf.subarray(at, at + n)); buf = buf.subarray(at + n);
        if (mask) for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
        if (op === 8) return close();
        if (op === 9) { frame(10, p); continue; }
        if (op === 0 || op === 1 || op === 2) { if (open) tcp.write(p); else early.push(p); }
      }
    });
    sock.on('error', () => tcp.destroy());
    sock.on('close', () => tcp.destroy());
  });
}
