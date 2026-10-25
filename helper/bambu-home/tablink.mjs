// farm-helper/bambu-home/tablink.mjs — the Bambu home helper's link to Bambu Studio running in a browser tab on the
// same house network (the tab's own LAN agent, b3d_lan_agent.cpp + b3d-lan.js in the browser build). One websocket per
// tab; the helper speaks to the printers the way a printer in LAN Only + Developer Mode offers: MQTT over TLS (8883),
// implicit FTPS (990) or a web link the printer fetches (H2), its SSDP announcements (UDP 2021). Nothing here talks to
// Bambu's servers. MIT licence (LICENSE).
//
// From the tab (JSON text; a file follows its request as one binary message):
//   {op:"connect", dev_id, ip, code}      -> {ev:"connect", dev_id, status 0 ok | 1 failed (msg "5" = access code refused) | 2 lost}
//                                            then every report as {ev:"msg", dev_id, msg:"<the printer's JSON>"}
//   {op:"disconnect", dev_id} · {op:"send", dev_id, msg} · {op:"discover", on}
//   {op:"detect", id, ip}                 -> {id, ok, dev_id, model_id, dev_name, version}
//   {op:"verify"|"upload"|"print", id, dev_id, ip, code, project_name, plate_index, ams_mapping, ams_mapping2, use_ams,
//    bed_type, timelapse, bed_leveling, flow_cali, vibration_cali, layer_inspect} [+ file]
//                                         -> {id, stage:"upload", percent} ... {id, stage:"sending"} {id, stage:"done"} | {id, stage:"error", error, code}
//   {op:"camera", dev_id, on}             -> binary messages, each UTF-8 "<dev_id>\n" then one whole JPEG, ~2 a second;
//                                            no camera, or it failed: {ev:"camera", dev_id, ok:false, error}

import http from "node:http";
import tls from "node:tls";
import { createHash } from "node:crypto";
import { rtspsCamera } from "../bambu.mjs";
import { sendPrint } from "./lan.mjs";

// ── A websocket server, the little the tab needs (RFC 6455: handshake, masked client frames, text + binary) ──
function frame(op, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, payload]);
}
/** The largest message a tab may send (a printer file): 1 GB. */
const MOST_MESSAGE = 1 << 30;
function wsAccept(req, sock, onOpen) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { sock.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  const c = { onText: () => {}, onBinary: () => {}, onClose: () => {} };
  c.sendText = (s) => { if (!sock.destroyed) sock.write(frame(1, Buffer.from(s))); };
  c.sendBinary = (b) => { if (!sock.destroyed) sock.write(frame(2, b)); };
  c.backlog = () => sock.writableLength;
  c.end = () => sock.destroy();
  let buf = Buffer.alloc(0), parts = [], partOp = 0, partLen = 0;
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) break;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
      let n = buf[1] & 127, at = 2;
      if (n === 126) { if (buf.length < 4) break; n = buf.readUInt16BE(2); at = 4; }
      else if (n === 127) { if (buf.length < 10) break; n = Number(buf.readBigUInt64BE(2)); at = 10; }
      if (n + partLen > MOST_MESSAGE) { sock.destroy(); return; }
      const mask = masked ? buf.subarray(at, at + 4) : null; if (masked) at += 4;
      if (buf.length < at + n) break;
      const p = Buffer.from(buf.subarray(at, at + n));
      if (mask) for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
      buf = buf.subarray(at + n);
      if (op === 8) { sock.end(frame(8, Buffer.alloc(0))); return; }
      if (op === 9) { sock.write(frame(10, p)); continue; }
      if (op === 10) continue;
      if (op !== 0) { partOp = op; parts = []; partLen = 0; }
      parts.push(p); partLen += p.length;
      if (!fin) continue;
      const whole = Buffer.concat(parts); parts = []; partLen = 0;
      if (partOp === 1) c.onText(whole.toString()); else if (partOp === 2) c.onBinary(whole);
    }
  });
  sock.on("close", () => c.onClose());
  sock.on("error", () => {});
  onOpen(c);
}

/** The JSON Bambu Studio's DeviceManager::on_machine_alive reads, from a printer's announcement. */
export const ssdpInfo = (p) => ({
  dev_name: p.name || p.serial, dev_id: p.serial, dev_ip: p.ip, dev_type: p.model || "", dev_signal: "-44dBm",
  connect_type: "lan", bind_state: "free", sec_link: "secure", ssdp_version: "v1", connection_name: "",
});

const parse = (s, dflt) => { try { const v = typeof s === "string" ? JSON.parse(s) : s; return v ?? dflt; } catch { return dflt; } };
const safeName = (s) => String(s || "print").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 100);

/**
 * The tab link, listening on `port`. `pool`, `shelf`, `cameras`: the helper's shared ones (lan.mjs). `heard`: the
 * printers the helper heard on the network (serial -> {serial, ip, model, name}); the helper calls heardPrinter(serial)
 * on each announcement and the tabs that look for printers hear it. `onPrinted({devId, name, file, bytes, plate,
 * amsMapping, amsMapping2, options})`: a print the printer took. Returns {port: Promise<number>, heardPrinter, close()}.
 */
export function startTabLink({ port = 8770, host = "0.0.0.0", pool, shelf, cameras, heard = new Map(),
  mqttPort = 8883, ftpPort = 990, cameraInput = null, say = console.log, onPrinted = () => {} }) {
  const tabs = new Set();
  const heardPrinter = (serial) => {
    const p = heard.get(serial);
    if (p) for (const t of tabs) if (t.discovering) t.sendText(JSON.stringify({ ev: "ssdp", info: ssdpInfo(p) }));
  };

  /** Who is at an address: the printer's certificate names its serial; its announcements its model and name. */
  const detect = (ip) => new Promise((resolve) => {
    const s = tls.connect({ host: ip, port: mqttPort, rejectUnauthorized: false }, () => {
      const cn = s.getPeerCertificate()?.subject?.CN || "";
      s.destroy();
      const h = heard.get(cn) || [...heard.values()].find((x) => x.ip === ip);
      resolve(cn ? { ok: true, dev_id: cn, model_id: h?.model || "", dev_name: h?.name || cn, version: h?.firmware || "" } : { ok: false });
    });
    s.setTimeout(8000, () => { s.destroy(); resolve({ ok: false }); });
    s.on("error", () => resolve({ ok: false }));
  });

  function open(tab) {
    tabs.add(tab);
    say("tab linked");
    const mine = new Map();     // dev_id -> {link, ip, code, off}   this tab's links
    const watching = new Map(); // dev_id -> stop()                  this tab's cameras
    const send = (o) => tab.sendText(JSON.stringify(o));

    async function connect(m) {
      const old = mine.get(m.dev_id);
      if (old?.link.isOpen() && old.code === m.code && old.ip === m.ip) { send({ ev: "connect", dev_id: m.dev_id, status: 0, msg: "" }); old.link.pushall(); return; }
      if (old) { old.off(); mine.delete(m.dev_id); pool.give(old.link); }
      let link;
      try { link = await pool.take(m.dev_id, m.ip, m.code); } catch (e) {
        say(`link to ${m.dev_id} at ${m.ip} failed: ${e.message}`);
        return send({ ev: "connect", dev_id: m.dev_id, status: 1, msg: e.code === "ACCESS_CODE" ? "5" : e.message });
      }
      if (tab.gone) { pool.give(link); return; }
      const onReport = (_, msg) => send({ ev: "msg", dev_id: m.dev_id, msg: JSON.stringify(msg) });
      const onClose = () => { if (mine.get(m.dev_id)?.link === link) { mine.delete(m.dev_id); send({ ev: "connect", dev_id: m.dev_id, status: 2, msg: "" }); } };
      link.on("report", onReport);
      link.on("close", onClose);
      const entry = { link, ip: m.ip, code: m.code, off: () => { link.off("report", onReport); link.off("close", onClose); } };
      mine.set(m.dev_id, entry);
      send({ ev: "connect", dev_id: m.dev_id, status: 0, msg: "" });
      // What the printer said so far, at once (Bambu Studio takes full and partial reports alike), then a full one.
      if (link.report.print) onReport(null, { print: link.report.print });
      link.pushall();
      link.request({ info: { sequence_id: "0", command: "get_version" } });
    }

    function disconnect(devId) {
      const l = mine.get(devId);
      if (!l) return;
      mine.delete(devId); l.off(); pool.give(l.link);
    }

    async function job(m, bytes) {
      const answer = (o) => send({ id: m.id, ...o });
      try {
        if (m.op === "verify") {
          // The access check: the printer takes this access code (an open link with it, or a fresh login).
          const link = await pool.take(m.dev_id, m.ip, m.code);
          pool.give(link);
          return answer({ stage: "done" });
        }
        if (!bytes) throw new Error("no file came with the request");
        const name = safeName(m.project_name) + ".gcode.3mf";
        const model = heard.get(m.dev_id)?.model || "";
        say(`${m.op} ${name} for ${m.dev_id} at ${m.ip}: ${bytes.length} bytes, plate ${m.plate_index}, ams ${m.ams_mapping}`);
        const link = m.op === "print" ? await pool.take(m.dev_id, m.ip, m.code) : null;
        try {
          await sendPrint({
            link, ip: m.ip, code: m.code, model, shelf, ftpPort, name, bytes, task: m.project_name || null, plate: m.plate_index,
            amsMapping: parse(m.ams_mapping, []), amsMapping2: parse(m.ams_mapping2, null), upload: m.op === "upload", waitMs: 30000,
            options: { bed_type: m.bed_type, timelapse: m.timelapse, bed_leveling: m.bed_leveling, flow_cali: m.flow_cali,
              vibration_cali: m.vibration_cali, layer_inspect: m.layer_inspect, ...(m.use_ams != null ? { use_ams: !!m.use_ams } : {}) },
            stage: (stage, percent) => answer(percent == null ? { stage } : { stage, percent }),
          });
        } finally { if (link) pool.give(link); }
        say(`${m.op} ${name} on ${m.dev_id}: done`);
        answer({ stage: "done" });
        // A print started: the helper keeps it in the account (Reprint from anywhere), sent the same way again.
        if (m.op === "print") onPrinted({
          devId: m.dev_id, name: m.project_name || name.replace(/\.gcode\.3mf$/, ""), bytes, plate: m.plate_index,
          // The name the printer reports while it prints this file (lan.mjs sendPrint's task).
          file: `${m.project_name || name.replace(/\.gcode\.3mf$/, "")}.gcode.3mf`,
          amsMapping: parse(m.ams_mapping, []), amsMapping2: parse(m.ams_mapping2, null),
          options: { bed_type: m.bed_type, timelapse: m.timelapse, bed_leveling: m.bed_leveling, flow_cali: m.flow_cali,
            vibration_cali: m.vibration_cali, layer_inspect: m.layer_inspect, ...(m.use_ams != null ? { use_ams: !!m.use_ams } : {}) },
        });
      } catch (e) {
        say(`${m.op} on ${m.dev_id} failed: ${e.message}`);
        answer({ stage: "error", error: e.message, code: e.code === "ACCESS_CODE" ? -2 : -1 });
      }
    }

    function camera(m) {
      watching.get(m.dev_id)?.();
      watching.delete(m.dev_id);
      if (m.on === false) return;
      const l = mine.get(m.dev_id);
      const model = heard.get(m.dev_id)?.model || "";
      const fail = (error) => send({ ev: "camera", dev_id: m.dev_id, ok: false, error });
      if (!l) return fail("Connect to the printer first.");
      if (!cameraInput && !rtspsCamera(model)) return fail("This printer has no live camera on the network (P1 and A1 printers send stills only).");
      const head = Buffer.from(`${m.dev_id}\n`);
      const stop = cameras.watch({ serial: m.dev_id, ip: l.ip, code: l.code },
        // A slow tab drops frames rather than queueing them.
        (jpeg) => { if (tab.backlog() < 2e6) tab.sendBinary(Buffer.concat([head, jpeg])); },
        (why) => { if (watching.get(m.dev_id) === stop) { watching.delete(m.dev_id); fail(why || "The camera stream ended."); } });
      watching.set(m.dev_id, stop);
    }

    // Printers heard so far, at once (the desktop plugin listens from start(); start_discovery only turns it on and off).
    tab.discovering = true;
    for (const p of heard.values()) send({ ev: "ssdp", info: ssdpInfo(p) });
    let pending = null; // a request waiting for its file
    tab.onText = (text) => {
      const m = parse(text, null);
      if (!m || typeof m !== "object") return;
      if (m.op === "discover") {
        tab.discovering = m.on !== false;
        if (tab.discovering) for (const p of heard.values()) send({ ev: "ssdp", info: ssdpInfo(p) });
      } else if (m.op === "connect") connect(m);
      else if (m.op === "disconnect") disconnect(m.dev_id);
      else if (m.op === "send") { const l = mine.get(m.dev_id); if (l?.link.isOpen()) l.link.request(parse(m.msg, {})); }
      else if (m.op === "detect") detect(m.ip).then((r) => send({ id: m.id, ...r }));
      else if (m.op === "verify") job(m, null);
      else if (m.op === "upload" || m.op === "print") pending = m;
      else if (m.op === "camera") camera(m);
    };
    tab.onBinary = (b) => { if (pending) { const m = pending; pending = null; job(m, b); } };
    tab.onClose = () => {
      tab.gone = true;
      tabs.delete(tab);
      for (const stop of watching.values()) stop();
      for (const id of [...mine.keys()]) disconnect(id);
      say("tab gone");
    };
  }

  const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("Boolean3d printer helper\n"); });
  server.on("upgrade", (req, sock) => wsAccept(req, sock, open));
  const ready = new Promise((r) => server.listen(port, host, () => r(server.address().port)));
  return { port: ready, heardPrinter, close: () => { server.close(); for (const t of tabs) t.end(); } };
}
