// farm-helper/bambu-home/tablink.mjs — the Bambu home helper's link to Bambu Studio running in a browser tab on the
// same house network (the tab's own LAN agent, b3d_lan_agent.cpp + b3d-lan.js in the browser build). One websocket per
// tab; the helper speaks to the printers the way a printer in LAN Only + Developer Mode offers: MQTT over TLS (8883),
// implicit FTPS (990) or a web link the printer fetches (H2), its SSDP announcements (UDP 2021). Nothing here talks to
// Bambu's servers. MIT licence (LICENSE).
//
// From the tab (JSON text; a file follows its request as one binary message):
//   {op:"connect", dev_id, ip, code}      -> {ev:"connect", dev_id, status 0 ok | 1 failed (msg "5" = access code refused) | 2 lost,
//                                            may: ["watch","print","control"]}: what this line may do with that printer
//                                            (a local paired line: all three, the owner; a relayed line: what the account
//                                            said). An op beyond it: a request with an id -> {id, stage:"error", code:-4},
//                                            a camera -> {ev:"camera", ok:false}, a control message is dropped.
//                                            then every report as {ev:"msg", dev_id, msg:"<the printer's JSON>"}
//   {op:"disconnect", dev_id} · {op:"send", dev_id, msg} · {op:"discover", on}
//   {op:"detect", id, ip}                 -> {id, ok, dev_id, model_id, dev_name, version}
//   {op:"verify"|"upload"|"print", id, dev_id, ip, code, project_name, plate_index, ams_mapping, ams_mapping2, use_ams,
//    bed_type, timelapse, bed_leveling, flow_cali, vibration_cali, layer_inspect} [+ file]
//                                         -> {id, stage:"upload", percent} ... {id, stage:"sending"} {id, stage:"done"} | {id, stage:"error", error, code}
//   {op:"camera", dev_id, on, video:"h264"} -> binary messages, each UTF-8 "<dev_id>\n" then one picture of the
//                                            printer's own H.264, untouched (Annex B, starts 00 00 [00] 01; from the next
//                                            IDR picture on), as it comes, ~30 a second;
//   {op:"camera", dev_id, on}             -> (a tab without video) the same messages with one JPEG (FF D8) each, ~3 a second;
//                                            no camera, or it failed: {ev:"camera", dev_id, ok:false, error}
//   {op:"hello", camera_acks:true, name}  (first) -> {ev:"helper", id, name, version, paired}: who the helper is and whether
//                                            this line is paired (pairing.mjs). An unpaired line gets every request
//                                            answered with "pair this browser first" (connect: status 1, a request with
//                                            an id: stage "error", code -3) and {ev:"pair", need:true}, until
//   {op:"pair", code}                     -> {ev:"paired", ok, token?, error?}: the code the helper shows, once; the token
//                                            goes in the line's address next time (ws://…:8770/?token=…), as does a
//                                            tunnel's (?to=host:port&token=…, refused without one). A page whose
//                                            origin is not ours is refused at the handshake (403).
//   {op:"hello", camera_acks:true}        (first, from a page that confirms pictures) then {op:"camera_got", dev_id} for
//                                            every camera message it received: the helper keeps at most CAMERA_BYTES_IN_FLIGHT
//                                            unconfirmed per camera and drops the newer pictures, so the printer's
//                                            reports never queue behind video on a slow link. A page that says no hello
//                                            gets the old rule (pictures dropped once this end's send queue is full).

import http from "node:http";
import os from "node:os";
import tls from "node:tls";
import { rtspsCamera } from "../bambu.mjs";
import { sendPrint } from "./lan.mjs";
import { wsAccept } from "./ws.mjs";
import { tunnel } from "./tunnel.mjs";
import { PAIR_FIRST } from "./pairing.mjs";

/** The JSON Bambu Studio's DeviceManager::on_machine_alive reads, from a printer's announcement. */
export const ssdpInfo = (p) => ({
  dev_name: p.name || p.serial, dev_id: p.serial, dev_ip: p.ip, dev_type: p.model || "", dev_signal: "-44dBm",
  connect_type: "lan", bind_state: "free", sec_link: "secure", ssdp_version: "v1", connection_name: "",
});

/** What a line may do with a printer: watch (reports, camera), print (send files, start, stop), control (move, heat, lamp). */
export const OWNER = ["watch", "print", "control"];
const NOT_ALLOWED = "This account may not do that on this printer.";
/** Camera bytes a tab that confirms them may have on the way at once (sent, not yet confirmed): the most video a
 *  printer report can queue behind (0.23 s on a 9 Mbit link). Bytes, not pictures: a frame count that keeps a 30-a-second
 *  camera smooth on the house network starves it on a link with a 100+ ms round trip, and one big IDR picture weighs as
 *  much as dozens of the others. A picture always goes out when nothing is on the way, however big. */
export const CAMERA_BYTES_IN_FLIGHT = 256 * 1024;

const parse = (s, dflt) => { try { const v = typeof s === "string" ? JSON.parse(s) : s; return v ?? dflt; } catch { return dflt; } };
const safeName = (s) => String(s || "print").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 100);

/**
 * The tab link, listening on `port`. `pool`, `shelf`, `cameras`: the helper's shared ones (lan.mjs). `heard`: the
 * printers the helper heard on the network (serial -> {serial, ip, model, name}); the helper calls heardPrinter(serial)
 * on each announcement and the tabs that look for printers hear it. `onPrinted({devId, name, file, bytes, plate,
 * amsMapping, amsMapping2, options})`: a print the printer took. `pairing` (pairing.mjs): the door's rules; without it
 * every line is served (tests). `page(req)`: the helper's own page, answered only to a browser on this computer
 * ({type, body, status?} or null). `port` false: no listening, tabs come only through
 * attach(line, {may}) (the printer box: a tab's line through the box relay, ws.mjs; `may` {dev_id: [...]} or {"*": [...]}
 * from the account, OWNER when not given). Returns {port: Promise<number|null>, heardPrinter, attach(line, {may}), close()}.
 */
export function startTabLink({ port = 8770, host = "0.0.0.0", pool, shelf, cameras, heard = new Map(), pairing = null, name = null, version = null,
  mqttPort = 8883, ftpPort = 990, cameraInput = null, say = console.log, onPrinted = () => {}, page = null }) {
  const tabs = new Set();
  // bySecret: the browser that downloaded it may still pair by itself (pairing.mjs 2b), so a page holding a secret sends it
  const whoAmI = () => ({ id: pairing?.helperId ?? null, name: name || os.hostname(), version, bySecret: !!pairing?.bySecret });
  const heardPrinter = (serial) => {
    const p = heard.get(serial);
    if (p) for (const t of tabs) if (t.discovering && t.paired) t.sendText(JSON.stringify({ ev: "ssdp", info: ssdpInfo(p) }));
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

  /** A line, served. `paired`: it may reach printers (a token, or a line the relay vouched for); else only hello and pair. */
  function open(tab, { paired = true, origin = null, may = null } = {}) {
    tabs.add(tab);
    tab.paired = paired;
    // what this line may do, per printer: {dev_id: [...]}, or the same for every printer (OWNER for a line paired here)
    const mayOn = (devId) => (may && typeof may === "object" ? (Array.isArray(may[devId]) ? may[devId] : Array.isArray(may["*"]) ? may["*"] : []) : OWNER);
    const allowed = (devId, what) => mayOn(devId).includes(what);
    say(paired ? "tab linked" : `tab linked, not paired${origin ? ` (${origin})` : ""}`);
    const mine = new Map();     // dev_id -> {link, ip, code, off}   this tab's links
    const watching = new Map(); // dev_id -> stop()                  this tab's cameras
    const inFlight = new Map(); // dev_id -> {sizes, bytes}           pictures sent, not yet confirmed, oldest first (a tab that confirms them)
    const send = (o) => tab.sendText(JSON.stringify(o));

    async function connect(m) {
      const old = mine.get(m.dev_id);
      if (!allowed(m.dev_id, "watch")) return send({ ev: "connect", dev_id: m.dev_id, status: 1, msg: NOT_ALLOWED, may: mayOn(m.dev_id) });
      if (old?.link.isOpen() && old.code === m.code && old.ip === m.ip) { send({ ev: "connect", dev_id: m.dev_id, status: 0, msg: "", may: mayOn(m.dev_id) }); old.link.pushall(); return; }
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
      send({ ev: "connect", dev_id: m.dev_id, status: 0, msg: "", may: mayOn(m.dev_id) });
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
      const ended = (why) => { if (watching.get(m.dev_id) === stop) { watching.delete(m.dev_id); fail(why || "The camera stream ended."); } };
      // A slow tab drops pictures rather than queueing them: JPEGs one by one, video up to its next IDR picture (the
      // pictures between two IDRs depend on each other). A tab that confirms pictures has room while the picture keeps
      // the unconfirmed ones within CAMERA_BYTES_IN_FLIGHT: a slow link (or one that queues, as a browser's throttled
      // one does) holds at most that much video ahead of the printer's reports. Otherwise this end's own send queue decides.
      // kept across a camera restart: pictures of the last stream may still be on the way, and their confirmations follow
      const sent = inFlight.get(m.dev_id) || { sizes: [], bytes: 0 };
      inFlight.set(m.dev_id, sent);
      const room = (data, most) => (tab.cameraAcks
        ? sent.bytes === 0 || sent.bytes + head.length + data.length <= CAMERA_BYTES_IN_FLIGHT
        : tab.backlog() < most);
      const out = (data) => {
        const b = Buffer.concat([head, data]);
        sent.sizes.push(b.length); sent.bytes += b.length;
        tab.sendBinary(b);
      };
      let skipping = true;
      const stop = m.video === "h264"
        ? cameras.watch({ serial: m.dev_id, ip: l.ip, code: l.code }, (p) => {
          if (!room(p.data, 1e6)) { skipping = true; if (tab.cameraAcks) return; }
          if (skipping && !p.key) return;
          skipping = false;
          out(p.data);
        }, ended, "video")
        : cameras.watch({ serial: m.dev_id, ip: l.ip, code: l.code },
          (jpeg) => { if (room(jpeg, 2e6)) out(jpeg); }, ended, "jpeg");
      watching.set(m.dev_id, stop);
    }

    // Printers heard so far, at once (the desktop plugin listens from start(); start_discovery only turns it on and off);
    // to a paired line only: an unpaired page learns nothing about this network.
    tab.discovering = true;
    const heardSoFar = () => { for (const p of heard.values()) send({ ev: "ssdp", info: ssdpInfo(p) }); };
    if (tab.paired) heardSoFar();
    let pending = null; // a request waiting for its file
    // Before pairing: hello and pair only; every other request is answered with the words, nothing is reached.
    let askedToPair = false;
    function unpaired(m) {
      if (m.op === "discover") { tab.discovering = m.on !== false; return; }
      if (m.op === "disconnect" || m.op === "camera_got") return;
      if (!askedToPair) { askedToPair = true; send({ ev: "pair", need: true, helper: whoAmI() }); }
      if (m.op === "connect") send({ ev: "connect", dev_id: m.dev_id, status: 1, msg: PAIR_FIRST });
      else if (m.op === "detect") send({ id: m.id, ok: false, error: PAIR_FIRST });
      else if (m.id !== undefined) send({ id: m.id, stage: "error", error: PAIR_FIRST, code: -3 });
      else if (m.op === "camera") send({ ev: "camera", dev_id: m.dev_id, ok: false, error: PAIR_FIRST });
    }
    tab.onText = (text) => {
      const m = parse(text, null);
      if (!m || typeof m !== "object") return;
      if (m.op === "hello") {
        tab.cameraAcks = m.camera_acks === true;
        send({ ev: "helper", ...whoAmI(), paired: tab.paired });
        return;
      }
      if (m.op === "pair") {
        if (tab.paired || !pairing) return send({ ev: "paired", ok: true, helper: whoAmI() });
        const token = pairing.pair(m.code, { origin, name: typeof m.name === "string" ? m.name : null });
        if (!token) return send({ ev: "paired", ok: false, error: "That is not the code the helper shows. Look again: it changes after five wrong tries." });
        tab.paired = true;
        say("a browser paired");
        send({ ev: "paired", ok: true, token, helper: whoAmI() });
        if (tab.discovering) heardSoFar();
        return;
      }
      if (!tab.paired) return unpaired(m);
      // beyond what this line may do with that printer: refused in words, nothing reaches the printer
      const needs = { verify: "print", upload: "print", print: "print", camera: "watch", detect: "watch" }[m.op];
      if (needs && m.dev_id !== undefined && !allowed(m.dev_id, needs)) {
        if (m.id !== undefined) return send({ id: m.id, stage: "error", error: NOT_ALLOWED, code: -4 });
        if (m.op === "camera") return send({ ev: "camera", dev_id: m.dev_id, ok: false, error: NOT_ALLOWED });
        return;
      }
      if (m.op === "send" && !allowed(m.dev_id, "control")) {
        // a printer's own message: stop/pause/resume are printing, the rest (move, heat, lamp, settings) is control
        const r = parse(m.msg, {});
        const cmd = r?.print?.command;
        if (!(["stop", "pause", "resume"].includes(cmd) && allowed(m.dev_id, "print"))) return say(`dropped a ${cmd || "control"} message: not allowed on ${m.dev_id}`);
      }
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
      else if (m.op === "camera_got") { const f = inFlight.get(m.dev_id); if (f?.sizes.length) f.bytes -= f.sizes.shift(); }
    };
    tab.onBinary = (b) => { if (pending && tab.paired) { const m = pending; pending = null; job(m, b); } else pending = null; };
    tab.onClose = () => {
      tab.gone = true;
      tabs.delete(tab);
      for (const stop of watching.values()) stop();
      for (const id of [...mine.keys()]) disconnect(id);
      say("tab gone");
    };
  }

  // A line the box relay vouched for (the account's own tab): paired by that.
  const attach = (line, { may = null } = {}) => open(line, { paired: true, may });
  if (port === false) return { port: Promise.resolve(null), heardPrinter, attach, close: () => { for (const t of tabs) t.end(); } };
  const loopback = (sock) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(sock.remoteAddress);
  // Its own page: the pairing code, only to a browser on this computer (a page on the network must not read the code).
  const server = http.createServer((req, res) => {
    const own = page && loopback(req.socket) ? page(req) : null;
    if (own) { res.writeHead(own.status || 200, { "Content-Type": own.type, "Cache-Control": "no-store" }); return res.end(own.body); }
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("Boolean3d printer helper\n");
  });
  // The door: our pages only (Origin), then ?to=<host>:<port> (a slicer's TCP connection to a printer's own address on
  // this network, tunnel.mjs; a token required) or a tab link (paired by its token, or not yet).
  server.on("upgrade", (req, sock, head) => {
    const u = new URL(req.url, "http://x");
    const origin = req.headers.origin ?? null;
    if (pairing && origin !== null && !pairing.allowsOrigin(origin)) {
      say(`refused a page at ${String(origin).slice(0, 100)}`);
      sock.end("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nThis helper answers Boolean3d's pages only.\r\n");
      return;
    }
    const to = u.searchParams.get("to");
    // a token pairs the line it was made for: the same page origin (a browser names it); a program names none
    const who = pairing ? pairing.verify(u.searchParams.get("token")) : null;
    const paired = !pairing || (!!who && (!origin || !who.origin || who.origin === origin));
    if (to && !paired) {
      say(`refused a line to ${to}: not paired`);
      sock.end("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n" + PAIR_FIRST + "\r\n");
      return;
    }
    const line = wsAccept(req, sock, head);
    if (line) (to ? tunnel(line, to, { say }) : open(line, { paired, origin }));
  });
  const ready = new Promise((r) => server.listen(port, host, () => r(server.address().port)));
  return { port: ready, heardPrinter, attach, close: () => { server.close(); for (const t of tabs) t.end(); } };
}
