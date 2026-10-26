// farm-helper/bambu-home/ws.mjs — the little of websockets (RFC 6455) the helper, the printer box and the box relay
// need, with Node's own modules only: a server's side (wsAccept) and a caller's side (wsConnect, the box calling out
// to the relay). Text and binary messages, ping/pong, close. A line is the same object on both sides:
//   {sendText(s), sendBinary(buf), backlog(), end(), onText(s), onBinary(buf), onClose()}   (set the on* yourself)
// MIT licence (LICENSE).

import http from "node:http";
import https from "node:https";
import { createHash, randomBytes } from "node:crypto";

/** The largest message taken (a printer file): 1 GB. */
export const MOST_MESSAGE = 1 << 30;
/** How long a closing line waits for its queue to go out and the far side to close, before it is cut. */
const END_MS = 30000;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function frame(op, payload, masked) {
  const n = payload.length;
  const len = n < 126 ? Buffer.from([n | (masked ? 0x80 : 0)]) : n < 65536 ? Buffer.from([126 | (masked ? 0x80 : 0), n >> 8, n & 255])
    : (() => { const b = Buffer.alloc(9); b[0] = 127 | (masked ? 0x80 : 0); b.writeBigUInt64BE(BigInt(n), 1); return b; })();
  if (!masked) return Buffer.concat([Buffer.from([0x80 | op]), len, payload]);
  const mask = randomBytes(4), body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([Buffer.from([0x80 | op]), len, mask, body]);
}

/** A line over an open socket (`masked`: this side is the caller, whose frames are masked). `head`: bytes already read. */
export function wsLine(sock, { masked = false, head = null } = {}) {
  sock.setNoDelay(true);
  const c = { onText: () => {}, onBinary: () => {}, onClose: () => {} };
  const open = () => !sock.destroyed && !sock.writableEnded;
  c.sendText = (s) => { if (open()) sock.write(frame(1, Buffer.from(s), masked)); };
  c.sendBinary = (b) => { if (open()) sock.write(frame(2, Buffer.isBuffer(b) ? b : Buffer.from(b), masked)); };
  c.ping = () => { if (open()) sock.write(frame(9, Buffer.alloc(0), masked)); };
  c.backlog = () => sock.writableLength;
  // Close after what is already queued has gone out: a tunnel ends its line the moment the printer closes, while the
  // tail of a file can still sit in Node's queue (Windows: a whole slow-link backlog); destroy() would drop it.
  c.end = () => {
    if (!open()) return;
    sock.end(frame(8, Buffer.alloc(0), masked));
    const stop = setTimeout(() => sock.destroy(), END_MS);
    stop.unref?.();
    sock.once("close", () => clearTimeout(stop));
  };
  c.gone = false;
  let buf = Buffer.alloc(0), parts = [], partOp = 0, partLen = 0;
  const take = (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) break;
      const fin = buf[0] & 0x80, op = buf[0] & 15, isMasked = buf[1] & 0x80;
      let n = buf[1] & 127, at = 2;
      if (n === 126) { if (buf.length < 4) break; n = buf.readUInt16BE(2); at = 4; }
      else if (n === 127) { if (buf.length < 10) break; n = Number(buf.readBigUInt64BE(2)); at = 10; }
      if (n + partLen > MOST_MESSAGE) { sock.destroy(); return; }
      const mask = isMasked ? buf.subarray(at, at + 4) : null; if (isMasked) at += 4;
      if (buf.length < at + n) break;
      const p = Buffer.from(buf.subarray(at, at + n));
      if (mask) for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
      buf = buf.subarray(at + n);
      if (op === 8) { if (open()) sock.end(frame(8, Buffer.alloc(0), masked)); return; }
      if (op === 9) { sock.write(frame(10, p, masked)); continue; }
      if (op === 10) continue;
      if (op !== 0) { partOp = op; parts = []; partLen = 0; }
      parts.push(p); partLen += p.length;
      if (!fin) continue;
      const whole = Buffer.concat(parts); parts = []; partLen = 0;
      if (partOp === 1) c.onText(whole.toString()); else if (partOp === 2) c.onBinary(whole);
    }
  };
  sock.on("data", take);
  sock.on("close", () => { c.gone = true; c.onClose(); });
  sock.on("error", () => {});
  if (head?.length) setImmediate(() => take(head));
  return c;
}

/** The server's side of a websocket upgrade (an http server's "upgrade" event): the line, or null when refused. */
export function wsAccept(req, sock, head) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { sock.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return null; }
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  // A slicer's own sockets (Emscripten) ask for the "binary" subprotocol; a browser drops a line whose answer names none.
  const proto = String(req.headers["sec-websocket-protocol"] || "").split(",").map((x) => x.trim()).includes("binary")
    ? "Sec-WebSocket-Protocol: binary\r\n" : "";
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${proto}\r\n`);
  return wsLine(sock, { head });
}

/** Call out: a line to `url` (ws:// or wss://), with these request headers. Rejects when the far side refuses. */
export function wsConnect(url, { headers = {}, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const secure = u.protocol === "wss:" || u.protocol === "https:";
    const key = randomBytes(16).toString("base64");
    const req = (secure ? https : http).request({
      host: u.hostname, port: u.port || (secure ? 443 : 80), path: u.pathname + u.search, method: "GET",
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key, ...headers },
    });
    const t = setTimeout(() => { req.destroy(new Error("no answer")); }, timeoutMs);
    req.on("upgrade", (res, sock, head) => {
      clearTimeout(t);
      if (res.headers["sec-websocket-accept"] !== createHash("sha1").update(key + GUID).digest("base64")) { sock.destroy(); return reject(new Error("not a websocket")); }
      resolve(wsLine(sock, { masked: true, head }));
    });
    req.on("response", (res) => {
      clearTimeout(t);
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => reject(Object.assign(new Error(body.trim().slice(0, 200) || `refused (${res.statusCode})`), { status: res.statusCode })));
    });
    req.on("error", (e) => { clearTimeout(t); reject(e); });
    req.end();
  });
}
