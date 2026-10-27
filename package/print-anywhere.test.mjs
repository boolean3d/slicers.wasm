// node --test package/print-anywhere.test.mjs: the program's Octo/Klipper print host link to <printer>.boolean3d is answered
// in the page (print-anywhere.js): Test from the account's printer list, Upload and Print through the printers door.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('print-anywhere.js', import.meta.url), 'utf8');
const PRINTER = { id: 'dc93f026-5fce-49d8-84fc-068b91f14702', name: 'Garage Voron', paired: true, online: true, kind: 'klipper' };

/** A page with SOCKFS (createPeer as Emscripten's: a socket object is taken as is) and a door that answers. */
function page({ printers = [PRINTER], linked = true } = {}) {
  const calls = [], store = { 'b3d-slicer-home': linked ? JSON.stringify({ key: 'k'.repeat(48), door: 'http://door.test/functions/v1/slicer-home', anon: 'anon' }) : null };
  const notices = [];
  const fetch = async (url, o = {}) => {
    calls.push({ url, method: o.method, headers: o.headers, body: o.body });
    const op = url.split('/').pop();
    const answer = op === 'printers' ? { ok: true, printers }
      : op === 'print-upload' ? { ok: true, upload: 'http://door.test/storage/v1/object/upload/sign/home-prints/x.gcode?token=t' }
      : op === 'print-start' ? { ok: true, print: { id: JSON.parse(o.body).print } }
      : url.includes('/upload/sign/') ? {} : { ok: false };
    return { ok: true, status: 200, json: async () => answer };
  };
  const Module = { b3dNotice: (t) => notices.push(t) };
  const SOCKFS = { websocket_sock_ops: { createPeer(sock, addr, port) { return { addr, port, socket: addr }; } } };
  const ctx = { Module, SOCKFS, fetch, document: { hidden: false }, location: { pathname: '/orca/2.3.2/' }, console: { log() {} },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    setTimeout: (f, ms) => (ms ? 0 : (queueMicrotask(f), 0)), setInterval: () => 0, crypto, TextEncoder, TextDecoder, URL, Promise, JSON, Date };
  vm.runInNewContext(SRC, ctx);
  for (const f of Module.preRun) f();
  return { Module, SOCKFS, calls, notices, ctx };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
/** What libcurl does: connect, send the request, read until the socket closes. */
async function request(p, host, raw) {
  const peer = p.SOCKFS.websocket_sock_ops.createPeer({}, host, 80);
  const ws = peer.socket, got = [];
  let closed = false;
  ws.onopen = () => {}; ws.onmessage = (e) => got.push(Buffer.from(e.data)); ws.onclose = () => { closed = true; };
  await tick(); ws.pump();
  for (const piece of raw) { ws.send(piece); await tick(); ws.pump(); }
  for (let i = 0; i < 200 && !closed; i++) { await tick(); ws.pump(); }
  return Buffer.concat(got).toString('latin1');
}

test('Test (GET /api/version) to the printer\'s address answers as OctoPrint, from the account\'s list', async () => {
  const p = page();
  await tick();
  const r = await request(p, 'garage-voron.boolean3d', [Buffer.from('GET /api/version HTTP/1.1\r\nHost: garage-voron.boolean3d\r\nX-Api-Key: \r\n\r\n')]);
  assert.match(r, /^HTTP\/1\.1 200/);
  assert.match(r, /"text":"OctoPrint 1\.10\.0 \(Boolean3d: Garage Voron\)"/);
  assert.equal(p.calls[0].url, 'http://door.test/functions/v1/printers/printers');
  assert.equal(p.calls[0].headers['x-slicer-key'], 'k'.repeat(48));
});

test('an address that is not one of the account\'s printers says which ones are', async () => {
  const p = page({ printers: [PRINTER, { ...PRINTER, id: 'x', name: 'Shed Ender' }] });
  await tick();
  const r = await request(p, 'basement.boolean3d', [Buffer.from('GET /api/version HTTP/1.1\r\n\r\n')]);
  assert.match(r, /^HTTP\/1\.1 503/);
  assert.match(r, /No printer called basement\.boolean3d in your Boolean3d account\. Yours: garage-voron\.boolean3d, shed-ender\.boolean3d\./);
});

test('Upload and Print: the file goes up through the account and the printer is told to print it', async () => {
  const p = page();
  await tick();
  const gcode = 'G28\nG1 X10\n'.repeat(1000), B = '------------------------abc123';
  const body = Buffer.concat([
    Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="print"\r\n\r\ntrue\r\n`),
    Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="path"\r\n\r\n\r\n`),
    Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="Box-60x40x12_PLA_12m.gcode"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(gcode), Buffer.from(`\r\n--${B}--\r\n`)]);
  const head = Buffer.from(`POST /api/files/local HTTP/1.1\r\nHost: garage-voron.boolean3d\r\nContent-Length: ${body.length}\r\nContent-Type: multipart/form-data; boundary=${B}\r\nExpect: 100-continue\r\n\r\n`);
  // libcurl waits for 100 Continue, then sends the body in pieces
  const r = await request(p, 'garage-voron.boolean3d', [head, body.subarray(0, 5000), body.subarray(5000)]);
  assert.match(r, /^HTTP\/1\.1 100 Continue\r\n\r\nHTTP\/1\.1 201/);
  const up = p.calls.find((c) => c.url.endsWith('/print-upload')), put = p.calls.find((c) => c.method === 'PUT'), go = p.calls.find((c) => c.url.endsWith('/print-start'));
  assert.equal(JSON.parse(up.body).bytes, gcode.length);
  assert.equal(Buffer.from(put.body).toString(), gcode);
  assert.deepEqual(JSON.parse(go.body), { printer: PRINTER.id, print: JSON.parse(up.body).print, name: 'Box-60x40x12_PLA_12m' });
  assert.match(p.notices.at(-1), /Box-60x40x12_PLA_12m is on its way to Garage Voron/);
});

test('Upload without Print is refused in words; an unlinked slicer says how to link it', async () => {
  const B = 'b';
  const body = Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="print"\r\n\r\nfalse\r\n--${B}\r\nContent-Disposition: form-data; name="file"; filename="a.gcode"\r\n\r\nG28\r\n--${B}--\r\n`);
  const req = Buffer.concat([Buffer.from(`POST /api/files/local HTTP/1.1\r\nContent-Length: ${body.length}\r\nContent-Type: multipart/form-data; boundary=${B}\r\n\r\n`), body]);
  const p = page();
  await tick();
  assert.match(await request(p, 'garage-voron.boolean3d', [req]), /409[\s\S]*press Upload and Print/);
  const q = page({ linked: false });
  await tick();
  assert.match(await request(q, 'garage-voron.boolean3d', [Buffer.from('GET /api/version HTTP/1.1\r\n\r\n')]), /503[\s\S]*not linked to your Boolean3d account/);
});

test('any other address is left to the network as before', () => {
  const p = page();
  const peer = p.SOCKFS.websocket_sock_ops.createPeer({}, '192.168.1.50', 7125);
  assert.equal(peer.socket, '192.168.1.50');
});
