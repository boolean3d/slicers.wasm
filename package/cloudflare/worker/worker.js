// The public slicer host on Cloudflare: Workers static assets hold each object's stored bytes, this Worker sends them
// the way serve-package.mjs does (type, encoding, cache control and ETag from manifest.json, the isolation headers on
// every response). Static assets alone re-compress already-brotli bytes (seen 10-24: br inside br), so every object
// goes through here and leaves with encodeBody 'manual'.
// Also the two network doors of relay.mjs: <app folder>/relay (WebSocket, the programs' TCP connections) is passed to
// the relay box (RELAY_ORIGIN, a plain node relay.mjs; Workers cannot open TCP to the many hosts that sit on
// Cloudflare), and <app folder>/fetch?url= (the web views' pictures) is answered here with the same allow list.
import META from './meta.json';

const [TYPES, CACHES, OBJECTS] = [META.types, META.caches, META.objects];   // objects: key -> [type, cache, encoding, etag]
const H = META.headers;

// Same lists as the slicers' net/relay.mjs (never Bambu Lab, MakerWorld, Prusa Account or Prusa Connect).
const ALLOW = ['prusa3d.com', 'prusa3d.cz', 'printables.com', 'orcaslicer.com', 'github.com', 'githubusercontent.com',
  'storage.googleapis.com'];
const DENY = ['account.prusa3d.com', 'connect.prusa3d.com'];
const under = (host, d) => host === d || host.endsWith('.' + d);
const allowed = host => !DENY.some(d => under(host, d)) && ALLOW.some(d => under(host, d));

function plain(status, extra = {}) { return new Response(null, { status, headers: { ...H, ...extra } }); }

async function picture(req, url) {
  let u; try { u = new URL(url.searchParams.get('url')); } catch { return plain(400); }
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405);
  let r;
  for (let hops = 0; ; hops++) {   // follow redirects only while they stay on the allow list
    if (u.protocol !== 'https:' || !allowed(u.hostname) || hops > 5) return plain(403);
    r = await fetch(u, { method: req.method, redirect: 'manual',
      headers: { 'User-Agent': req.headers.get('user-agent') || '', Accept: req.headers.get('accept') || '*/*' } });
    if (r.status < 300 || r.status >= 400 || !r.headers.get('location')) break;
    u = new URL(r.headers.get('location'), u);
  }
  const h = new Headers(H);
  for (const k of ['content-type', 'cache-control', 'etag', 'last-modified', 'expires']) if (r.headers.get(k)) h.set(k, r.headers.get(k));
  return new Response(req.method === 'HEAD' ? null : r.body, { status: r.status, headers: h });
}

async function relay(req, url, env) {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return plain(426);
  const [host, port] = (url.searchParams.get('to') || '').split(':');
  if (!host || !['443', '80'].includes(port) || !allowed(host)) return plain(403);
  if (!env.RELAY_ORIGIN || !env.RELAY_KEY) return plain(503);
  // A WebSocket to the relay box (with the key it wants) joined to the browser's, message for message. Handing the
  // box's own 101 back unchanged lost the frames it sent (seen 10-24), so the Worker holds both ends.
  const h = new Headers({ Upgrade: 'websocket', 'X-Relay-Key': env.RELAY_KEY });
  const proto = req.headers.get('sec-websocket-protocol'); if (proto) h.set('Sec-WebSocket-Protocol', proto);
  const up = await fetch(env.RELAY_ORIGIN.replace(/\/$/, '') + url.pathname + url.search, { headers: h });
  if (!up.webSocket) return plain(up.status === 101 ? 502 : up.status);
  const box = up.webSocket; box.accept();
  const [page, mine] = Object.values(new WebSocketPair()); mine.accept();
  // Binary frames can arrive as Blobs (send() would turn one into the text "[object Blob]"): bytes first, in order,
  // and a close only after what came before it.
  const pipe = (from, to) => {
    let chain = Promise.resolve();
    const then = f => { chain = chain.then(f).catch(() => {}); };
    from.addEventListener('message', e => then(async () => to.send(typeof e.data === 'string' ? e.data
      : e.data instanceof Blob ? await e.data.arrayBuffer() : e.data)));
    from.addEventListener('close', e => then(() => to.close(!e.code || e.code === 1005 ? 1000 : e.code, e.reason || '')));
    from.addEventListener('error', () => then(() => to.close(1011, '')));
  };
  pipe(box, mine); pipe(mine, box);
  const rh = new Headers(); if (proto) rh.set('Sec-WebSocket-Protocol', proto.split(',')[0].trim());
  return new Response(null, { status: 101, webSocket: page, headers: rh });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    let key;
    try { key = decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch { return plain(400); }
    if (key.endsWith('/relay')) return relay(req, url, env);
    if (key.endsWith('/fetch')) return picture(req, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405);
    if (key === '' || key.endsWith('/')) key += 'index.html';
    const o = OBJECTS[key];
    if (!o) return plain(OBJECTS[key + '/index.html'] ? 301 : 404, OBJECTS[key + '/index.html'] ? { Location: '/' + key + '/' } : {});
    const etag = '"' + o[3] + '"';
    const h = new Headers({ ...H, 'Content-Type': TYPES[o[0]], 'Cache-Control': CACHES[o[1]], ETag: etag });
    if (o[2]) h.set('Content-Encoding', o[2]);
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: h });
    // The asset under its own name, asked for as is (no Accept-Encoding: the stored bytes, not a re-encoding of them).
    const a = await env.ASSETS.fetch(new Request(new URL('/' + key.split('/').map(encodeURIComponent).join('/'), url), { headers: { 'Accept-Encoding': 'identity' } }));
    if (!a.ok) return plain(502);
    return new Response(req.method === 'HEAD' ? null : a.body, { status: 200, headers: h, encodeBody: 'manual' });
  },
};
