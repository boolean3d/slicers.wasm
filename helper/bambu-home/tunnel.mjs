// farm-helper/bambu-home/tunnel.mjs — a slicer in a browser tab reaches a printer's own web address on the house
// network through the helper (brief klipper-send). Every printer brand whose slicer talks to it over plain TCP (a
// Klipper printer's Moonraker, a Prusa printer's PrusaLink, their web pages and cameras) goes this one way.
//
// The tab's network layer (slicer-wx net-worker.js) opens one websocket per TCP connection the slicer makes to an
// address on the house network: <helper tab link>?to=<host>:<port> at home, or the same through the box relay when away
// (box.mjs). Here that line becomes a TCP connection to host:port; bytes pass both ways untouched as binary messages,
// as the slicer host's relay does for internet addresses (the slicers' net/relay.mjs). TLS, HTTP, the printer's
// own websocket all stay end to end between the slicer and the printer.
//
// Only addresses on the house network itself: private and link-local ranges, and this computer (a printer stand-in or
// Moonraker on the same Pi). Never the internet: the helper is not an open proxy.
// MIT licence (LICENSE).

import net from "node:net";
import dns from "node:dns/promises";

/** True for an address on a house network or this computer (IPv4 or IPv6). */
export function onHouseNetwork(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === "::1") return true;
    const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (v4) return onHouseNetwork(v4[1]);
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s);   // unique local fc00::/7, link-local fe80::/10
  }
  return false;
}

/** "host:port" (an IPv6 host in brackets) -> {host, port}, or null. */
export function parseTarget(to) {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(String(to || "")) || /^([^:\[\]]+):(\d+)$/.exec(String(to || ""));
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1], port } : null;
}

/** Bytes waiting to go to the tab before the printer's side is paused (a camera stream outruns a slow relay). */
const MOST_BACKLOG = 4 << 20;

/**
 * Join `line` (a websocket line, ws.mjs shape: sendBinary, onBinary, onClose, backlog, end) to a TCP connection to
 * `to` ("host:port"). Refused targets, names that do not resolve and failed connections end the line. `lookup`: for
 * tests. Returns a promise that settles once the connection is up or refused (true / false).
 */
export async function tunnel(line, to, { say = () => {}, lookup = (h) => dns.lookup(h, { all: true }) } = {}) {
  const early = [];
  let tcp = null, closed = false;
  line.onText = () => {};
  line.onBinary = (b) => { if (tcp) tcp.write(b); else early.push(b); };
  line.onClose = () => { closed = true; tcp?.destroy(); };
  const t = parseTarget(to);
  // every address of the name, in the system's order (Windows gives ::1 before 127.0.0.1 for localhost): the first
  // one that answers is used, as a desktop program connecting to the printer does
  let ips = [];
  try { if (t) ips = net.isIP(t.host) ? [t.host] : [].concat(await lookup(t.host)).map((a) => a.address); } catch {}
  const house = ips.filter(onHouseNetwork);
  if (!t || !house.length) {
    say(`tunnel refused ${to}${ips.length ? ` (${ips.join(", ")} is not on the house network)` : ""}`);
    line.end();
    return false;
  }
  if (closed) return false;
  let ip = null;
  for (const a of house) {
    const c = net.connect({ host: a, port: t.port });
    const up = await new Promise((r) => { c.once("connect", () => r(true)); c.once("error", (e) => r(e)); });
    if (up === true) { tcp = c; ip = a; break; }
    say(`tunnel ${to} (${a}): ${up.code || up.message}`);
  }
  if (!tcp || closed) { tcp?.destroy(); if (!closed) line.end(); return false; }
  return new Promise((resolve) => {
    tcp.setNoDelay(true);
    say(`tunnel ${to}${ip !== t.host ? ` (${ip})` : ""}`);
    for (const b of early.splice(0)) tcp.write(b);
    resolve(true);
    tcp.on("data", (d) => {
      line.sendBinary(d);
      if (line.backlog && line.backlog() > MOST_BACKLOG && !tcp.isPaused()) {
        tcp.pause();
        const wait = setInterval(() => {
          if (closed || line.backlog() < MOST_BACKLOG / 4) { clearInterval(wait); if (!closed) tcp.resume(); }
        }, 20);
      }
    });
    tcp.on("error", (e) => { say(`tunnel ${to}: ${e.code || e.message}`); resolve(false); });
    tcp.on("close", () => { if (!closed) { closed = true; line.end(); } resolve(false); });
  });
}
