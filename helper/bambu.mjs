// farm-helper/bambu.mjs
//
// Talking to a Bambu Lab printer on the farm's own network, the way the printer offers in LAN-only + Developer Mode:
// MQTT over TLS on 8883 and implicit FTPS on 990, user "bblp", password the printer's access code (its LAN screen).
// Node only, no packages: one file a farm can run anywhere.
//
// What is public and used here (no Bambu code; facts from MIT tools, credited):
// - The report topic device/<serial>/report, the request topic device/<serial>/request, "pushall", and the
//   "project_file" print command: ha-bambulab (greghesp/ha-bambulab, MIT) pybambu commands.py and
//   coordinator.py; bambulabs_api (BambuTools/bambulabs_api, MIT) mqtt_client.py.
// - The AMS fields (print.ams.ams[].tray[]: tray_type, tray_color RRGGBBAA; vt_tray / vir_slot the outside spool;
//   AMS HT units ams_id 128-135 = slots 16-23 in ams_mapping): ha-bambulab pybambu models.py.
// - Printers announce themselves by SSDP NOTIFY to UDP 2021 (Location = address, USN = serial,
//   DevModel.bambu.com = model code).
// - The FTPS data connection must resume the control connection's TLS session (the printer refuses otherwise).
// It says who it is: the MQTT client id is boolean3d-helper-*; it never sends a Bambu Studio name or certificate.

import tls from "node:tls";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";

const TLS = { rejectUnauthorized: false }; // the printer's own certificate (Bambu's CA, named by its serial)

// ── MQTT 3.1.1, the little a printer needs: connect, subscribe, publish (QoS 0), ping ──
const str = (s) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
function lengthBytes(n) {
  const out = [];
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0);
  return Buffer.from(out);
}
export const packet = (type, body) => Buffer.concat([Buffer.from([type]), lengthBytes(body.length), body]);
/** Whole packets out of a byte stream: [{type, flags, body}], and what is left over. */
export function readPackets(buf) {
  const out = [];
  let at = 0;
  for (;;) {
    if (buf.length - at < 2) break;
    let len = 0, mul = 1, i = at + 1, done = false;
    for (; i < buf.length && i < at + 5; i++) { len += (buf[i] & 127) * mul; mul *= 128; if (!(buf[i] & 128)) { done = true; i++; break; } }
    if (!done || buf.length < i + len) break;
    out.push({ type: buf[at] >> 4, flags: buf[at] & 15, body: buf.subarray(i, i + len) });
    at = i + len;
  }
  return { packets: out, rest: buf.subarray(at) };
}
export function publishPacket(topic, payload) { return packet(0x30, Buffer.concat([str(topic), Buffer.from(payload)])); }
/** A PUBLISH body as {topic, payload} (QoS 0 has no packet id). */
export function readPublish(p) {
  const n = p.body.readUInt16BE(0), topic = p.body.subarray(2, 2 + n).toString();
  const qos = (p.flags >> 1) & 3;
  return { topic, payload: p.body.subarray(2 + n + (qos ? 2 : 0)) };
}

/**
 * A printer's MQTT: emits 'report' (the merged report so far), 'close', 'error'.
 * @param {{host: string, port?: number, serial: string, code: string}} o
 */
export function mqttLink({ host, port = 8883, serial, code, keepalive = 30 }) {
  const ev = new EventEmitter();
  let sock = null, rest = Buffer.alloc(0), ping = null, open = false;
  const report = {};
  const send = (b) => sock && !sock.destroyed && sock.write(b);
  ev.connect = () => new Promise((resolve, reject) => {
    const fail = (err) => { if (!open) reject(err); };
    sock = tls.connect({ host, port, ...TLS, servername: undefined }, () => {
      const flags = 0x80 | 0x40 | 0x02; // user name, password, clean session
      const head = Buffer.concat([str("MQTT"), Buffer.from([4, flags, keepalive >> 8, keepalive & 255])]);
      send(packet(0x10, Buffer.concat([head, str(`boolean3d-helper-${process.pid}-${Math.random().toString(36).slice(2, 8)}`), str("bblp"), str(code)])));
    });
    sock.setTimeout(20000, () => { sock.destroy(new Error("The printer did not answer.")); });
    sock.on("error", (err) => { fail(err); if (open) ev.emit("error", err); });
    sock.on("close", () => { clearInterval(ping); const was = open; open = false; if (was) ev.emit("close"); else fail(new Error("The printer closed the connection.")); });
    sock.on("data", (d) => {
      const r = readPackets(Buffer.concat([rest, d])); rest = Buffer.from(r.rest);
      for (const p of r.packets) {
        if (p.type === 2) { // CONNACK
          if (p.body[1] !== 0) { sock.destroy(); return reject(Object.assign(new Error(p.body[1] === 4 || p.body[1] === 5 ? "The printer refused the access code." : `The printer refused the connection (${p.body[1]}).`), { code: p.body[1] === 4 || p.body[1] === 5 ? "ACCESS_CODE" : "REFUSED" })); }
          open = true; sock.setTimeout(keepalive * 3000);
          send(packet(0x82, Buffer.concat([Buffer.from([0, 1]), str(`device/${serial}/report`), Buffer.from([0])])));
          ping = setInterval(() => send(Buffer.from([0xc0, 0])), keepalive * 1000);
          resolve(ev);
        } else if (p.type === 3) {
          const { payload } = readPublish(p);
          let msg; try { msg = JSON.parse(payload.toString()); } catch { continue; }
          merge(report, msg);
          ev.emit("report", report, msg);
        }
      }
    });
  });
  ev.request = (obj) => send(publishPacket(`device/${serial}/request`, JSON.stringify(obj)));
  ev.pushall = () => ev.request({ pushing: { sequence_id: String(Date.now() % 1e8), command: "pushall" } });
  ev.close = () => { clearInterval(ping); open = false; if (sock && !sock.destroyed) { send(Buffer.from([0xe0, 0])); sock.end(); } };
  ev.report = report;
  ev.isOpen = () => open;
  return ev;
}
/** P1 printers send only what changed: keep the whole picture. Lists (AMS units, HMS) are replaced whole. */
export function merge(into, from) {
  for (const [k, v] of Object.entries(from || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) merge((into[k] && typeof into[k] === "object" && !Array.isArray(into[k])) ? into[k] : (into[k] = {}), v);
    else into[k] = v;
  }
  return into;
}

// ── What a report says, in the farm door's terms ───────────────────
const hex = (c) => { const s = String(c ?? "").replace(/^#/, ""); return /^[0-9a-f]{6}/i.test(s) && !/^0{8}$/.test(s) ? "#" + s.slice(0, 6).toUpperCase() : null; };
function slot(ams, tray, t) {
  const material = String(t?.tray_type ?? "").trim();
  return { ams, tray, material, colour: hex(t?.tray_color), name: String(t?.tray_sub_brands || t?.tray_id_name || "").trim() || null, empty: !material };
}
/** The loaded filament per slot: AMS units (incl. AMS HT, 128+), the outside spool(s). */
export function slotsOf(report) {
  const p = report?.print ?? {}, out = [];
  for (const unit of p.ams?.ams ?? []) for (const t of unit.tray ?? []) out.push(slot(Number(unit.id), Number(t.id), t));
  if (Array.isArray(p.vir_slot)) for (const v of p.vir_slot) out.push(slot(Number(v.id) || 254, 0, v));
  else if (p.vt_tray) out.push(slot(Number(p.vt_tray.id) || 254, 0, p.vt_tray));
  return out.filter((s) => Number.isFinite(s.ams) && Number.isFinite(s.tray));
}
/** An HMS entry as the printer's screen and Bambu's wiki show it: XXXX_XXXX_XXXX_XXXX. */
export const hmsCode = (h) => {
  const a = (h.attr >>> 0).toString(16).padStart(8, "0").toUpperCase(), c = (h.code >>> 0).toString(16).padStart(8, "0").toUpperCase();
  return `${a.slice(0, 4)}_${a.slice(4)}_${c.slice(0, 4)}_${c.slice(4)}`;
};
/** The few facts the farm door keeps of a report. */
export function stateOfReport(report) {
  const p = report?.print ?? {};
  return {
    gcodeState: p.gcode_state ?? null, percent: p.mc_percent ?? null, minutesLeft: p.mc_remaining_time ?? null,
    task: p.subtask_name || null, errorCode: Number(p.print_error) || 0, hms: (p.hms ?? []).map(hmsCode), slots: slotsOf(report),
  };
}
/** The number ams_mapping gives a slot: AMS ams*4+tray, AMS HT 16+, the outside spool its own id (254/255). */
export function slotNumber({ ams, tray }) {
  if (ams >= 254) return ams;
  if (ams >= 128) return 16 + (ams - 128);
  return ams * 4 + tray;
}
/** The slot a report says is printing now (tray_now: ams*4+tray, 254/255 the outside spool), or null. */
export function activeSlot(report) {
  const n = Number(report?.print?.ams?.tray_now);
  return Number.isFinite(n) && n !== 255 ? n : null;
}
/**
 * The printer's nozzle, as the slicer needs it: its diameter, and Standard or High Flow. H2 printers name the nozzle
 * by a code (device.nozzle.info[].type, also nozzle_type): hardened steel H + flow S (Standard) or H (High Flow), "HS01" /
 * "HH01" (printer-test run 1: the H2S's 0.4 HH01 is High Flow); X1/P1 say the material only (Standard).
 */
export function nozzleOf(report) {
  const p = report?.print ?? {};
  const info = p.device?.nozzle?.info?.[0];
  const type = String(info?.type ?? p.nozzle_type ?? "");
  const diameter = Number(info?.diameter ?? p.nozzle_diameter);
  return { diameter: Number.isFinite(diameter) && diameter > 0 ? diameter : null, flow: /^[A-Z]H\d\d$/.test(type) ? "High Flow" : "Standard", type: type || null };
}

/**
 * The print command (ha-bambulab coordinator.py / bambulabs_api mqtt_client.py): the plate's G-code inside the file,
 * the file where FTPS put it (H2: ftp:///<name>; X1/P1/A1: file:///sdcard/<name>), a slot per filament.
 */
export function printCommand({ fileName, task, slots, h2 = false, url = null }) {
  const ams = slots.some((s) => s.ams < 254);
  const c = {
    print: {
      sequence_id: String(Date.now() % 1e8), command: "project_file", param: "Metadata/plate_1.gcode",
      // `url`: a web link on the house network the printer fetches the file from itself (H2 firmware in Developer
      // Mode does, no storage needed: printer-test runs 2 and 3, 10-22).
      url: url ?? (h2 ? `ftp:///${fileName}` : `file:///sdcard/${fileName}`), subtask_name: task,
      project_id: "0", profile_id: "0", task_id: "0", subtask_id: "0",
      bed_type: "auto", timelapse: false, bed_leveling: true, flow_cali: false, vibration_cali: false, layer_inspect: false,
      use_ams: ams, ams_mapping: slots.length ? slots.map(slotNumber) : [0],
    },
  };
  if (h2) c.print.ams_mapping2 = slots.map((s) => ({ ams_id: s.ams, slot_id: s.tray }));
  return c;
}

// ── Implicit FTPS: upload one file, check its size ─────────────────
/** Upload `bytes` as /<name> on the printer's storage; resolves to the size the printer has. */
export function ftpsUpload({ host, port = 990, code, name, bytes, timeout = 60000 }) {
  return new Promise((resolve, reject) => {
    let session = null, buf = "", done = false;
    const lines = [], waiters = [];
    const ctl = tls.connect({ host, port, ...TLS });
    const finish = (err, v) => { if (done) return; done = true; clearTimeout(timer); ctl.destroy(); err ? reject(err) : resolve(v); };
    const timer = setTimeout(() => finish(new Error("The printer's storage did not answer in time.")), timeout);
    ctl.on("session", (s) => { session = s; });
    ctl.on("error", (err) => finish(err));
    ctl.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        // A multi-line reply ends on "NNN "; the lines before it are skipped.
        if (!/^\d{3} /.test(line)) continue;
        if (waiters.length) waiters.shift()(line); else lines.push(line);
      }
    });
    // Replies in the order they come, whether they came before or after we asked.
    const reply = () => (lines.length ? Promise.resolve(lines.shift()) : new Promise((r) => waiters.push(r)));
    const cmd = (c) => { ctl.write(c + "\r\n"); return reply(); };
    const want = (line, ...codes) => { if (!codes.some((c) => line.startsWith(c))) throw Object.assign(new Error(`The printer's storage said: ${line}`), { code: line.slice(0, 3) }); return line; };
    (async () => {
      want(await reply(), "220");
      const u = await cmd("USER bblp");
      if (!u.startsWith("230")) { const p = await cmd(`PASS ${code}`); if (!p.startsWith("230")) throw Object.assign(new Error("The printer refused the access code."), { code: "ACCESS_CODE" }); }
      want(await cmd("PBSZ 0"), "200");
      want(await cmd("PROT P"), "200");
      want(await cmd("TYPE I"), "200");
      const pasv = want(await cmd("PASV"), "227");
      const n = pasv.match(/(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
      if (!n) throw new Error(`The printer's storage said: ${pasv}`);
      const dataPort = +n[5] * 256 + +n[6];
      const data = tls.connect({ host, port: dataPort, ...TLS, session: session ?? ctl.getSession() });
      await new Promise((r, j) => { data.once("secureConnect", r); data.once("error", j); });
      want(await cmd(`STOR /${name}`), "150", "125");
      await new Promise((r, j) => { data.on("error", j); data.end(Buffer.from(bytes), r); });
      want(await reply(), "226", "250");
      const size = await cmd(`SIZE /${name}`);
      ctl.write("QUIT\r\n");
      finish(null, size.startsWith("213") ? Number(size.slice(4)) : -1);
    })().catch((err) => finish(err));
  });
}

// ── Finding printers: listen for their SSDP announcements (sends nothing) ──
export function listenForPrinters(onPrinter, { port = 2021 } = {}) {
  const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
  s.on("message", (b, from) => {
    const t = b.toString(), h = (k) => t.match(new RegExp(`^${k}:\\s*(.*)$`, "mi"))?.[1]?.trim();
    const serial = h("USN");
    if (!serial) return;
    onPrinter({ serial, ip: h("Location") ?? from.address, model: h("DevModel.bambu.com") ?? null, name: h("DevName.bambu.com") ?? null, firmware: h("DevVersion.bambu.com") ?? null });
  });
  s.on("error", () => {});
  s.bind(port);
  return () => s.close();
}

// ── The camera: X1 and H2 printers stream on RTSPS port 322 (user bblp, the access code) ──
/** Whether a printer model streams its camera on RTSPS (X1 Carbon BL-P001, X1 BL-P002, X1E C13, H2 series O1*); P1/A1 do not. */
export const rtspsCamera = (model) => /^(BL-P00[12]|C13|O1)/.test(String(model || ""));

/**
 * One ffmpeg, watched. A printer allows one live view at a time, so ffmpeg must never outlive its watchers: a stream
 * that sends nothing for `stallMs` is ended (ffmpeg waits on a silent stream for ever), and an ffmpeg still there
 * `graceMs` after SIGTERM (it finishes its blocked read first) gets SIGKILL. Returns {stop, stdin}.
 */
async function watchedFfmpeg(args, { onData, onEnd, spawn = null, stallMs = 20000, graceMs = 2000, stdin = false }) {
  const run = spawn ?? (await import("node:child_process")).spawn;
  const ff = run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...(stdin ? [] : ["-nostdin"]), ...args],
    { stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"] });
  let err = "", stalled = false, closed = false, killer = null, watchdog = null;
  const kill = () => {
    try { ff.stdin?.destroy(); } catch { /* gone already */ }
    try { ff.kill("SIGTERM"); } catch { /* gone already */ }
    if (!killer && !closed) { killer = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { /* gone already */ } }, graceMs); killer.unref?.(); }
  };
  const quiet = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => { stalled = true; kill(); }, stallMs);
    watchdog.unref?.();
  };
  quiet();
  ff.stdout.on("data", (d) => { quiet(); onData(d); });
  ff.stderr.on("data", (d) => { err = (err + d).slice(-400); });
  ff.stdin?.on("error", () => {});
  ff.on("error", (e) => onEnd(e.code === "ENOENT" ? "ffmpeg is not installed (sudo apt install ffmpeg)" : e.message));
  ff.on("close", (status) => {
    closed = true; clearTimeout(watchdog); clearTimeout(killer);
    onEnd(stalled ? "The camera stopped sending pictures." : status ? err.trim().split("\n").pop() || `ffmpeg stopped (${status})` : null);
  });
  return { stop: () => { clearTimeout(watchdog); kill(); }, stdin: ff.stdin };
}

/**
 * H.264 (Annex B, an access unit delimiter before every picture, as h264_metadata=aud=insert writes it) cut into
 * whole pictures: the returned push(bytes) hands each finished picture to onPicture({data, key}), `key` when it holds
 * an IDR slice (the printer sends its SPS and PPS with every one). A picture is finished when the next one's
 * delimiter arrives.
 */
export function accessUnits(onPicture, most = 8e6) {
  const aud = Buffer.from([0, 0, 1, 9]), start = Buffer.from([0, 0, 1]);
  let buf = Buffer.alloc(0);
  const keyOf = (au) => {
    for (let i = au.indexOf(start); i >= 0 && i + 3 < au.length; i = au.indexOf(start, i + 3))
      if ((au[i + 3] & 0x1f) === 5) return true;
    return false;
  };
  return (d) => {
    buf = buf.length ? Buffer.concat([buf, d]) : Buffer.from(d);
    for (;;) {
      let s = buf.indexOf(aud);
      if (s < 0) { if (buf.length > most) buf = Buffer.alloc(0); return; }
      if (s > 0 && buf[s - 1] === 0) s--;
      let e = buf.indexOf(aud, s + 4);
      if (e < 0) { buf = buf.subarray(s); if (buf.length > most) buf = Buffer.alloc(0); return; }
      if (buf[e - 1] === 0) e--;
      const au = Buffer.from(buf.subarray(s, e));
      buf = buf.subarray(e);
      onPicture({ data: au, key: keyOf(au) });
    }
  };
}

/**
 * The printer's certificate is not one a computer can check: ffmpeg 9 checks certificates by default and refused it
 * ("Peer certificate failed verification"), so it is told -tls_verify 0. Older ffmpeg (6.1, Ubuntu 24.04)
 * never checks and refuses that option on an RTSPS input ("Option not found", only once the stream is open), which
 * stopped every camera on such a machine. So the first camera tries it and, refused, drops it for good. The access code is the lock.
 */
let certArgs = ["-tls_verify", "0"];

/**
 * The camera's video, live and untouched: ffmpeg copies the printer's own H.264 (X1 and H2: RTSPS, 30 pictures a
 * second) without decoding it and hands each picture to onFrame({data, key}) as soon as it is whole. `input`: ffmpeg's
 * input arguments instead of the printer's stream (a test picture, encoded to H.264 the way the printer sends it: no
 * B-frames, an IDR every second). Returns stop(). See watchedFfmpeg for the one-live-view rule.
 */
export async function cameraVideo({ host, code, input = null, onFrame, onEnd = () => {}, spawn = null, stallMs = 20000, graceMs = 2000 }) {
  const from = () => input
    ? [...input, "-an", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-bf", "0", "-g", "30", "-pix_fmt", "yuv420p"]
    : ["-rtsp_transport", "tcp", ...certArgs, "-fflags", "nobuffer", "-flags", "low_delay",
      "-i", `rtsps://bblp:${encodeURIComponent(code)}@${host}:322/streaming/live/1`, "-an", "-c:v", "copy"];
  let ff = null, stopped = false;
  const start = async () => {
    const tried = certArgs;
    ff = await watchedFfmpeg([...from(), "-bsf:v", "h264_metadata=aud=insert", "-flush_packets", "1", "-f", "h264", "pipe:1"], {
      onData: accessUnits(onFrame), spawn, stallMs, graceMs,
      onEnd: (why) => {
        if (!input && !stopped && tried.length && /Option not found/.test(String(why))) { certArgs = []; start(); }
        else onEnd(why);
      },
    });
  };
  await start();
  return () => { stopped = true; ff.stop(); };
}

/**
 * JPEG pictures made here from the camera's video (cameraVideo) for whoever takes stills (the account page, an older
 * Bambu Studio tab): {push(picture), stop()}. It starts at the next IDR picture and hands about `fps` JPEGs a second,
 * each to onFrame (a Buffer). The printer is still read once; this only decodes what is already here.
 */
export async function jpegPictures({ fps = 4, width = 960, onFrame, onEnd = () => {}, spawn = null, stallMs = 20000, graceMs = 2000 }) {
  let buf = Buffer.alloc(0), started = false;
  const ff = await watchedFfmpeg(["-fflags", "nobuffer", "-flags", "low_delay", "-f", "h264", "-i", "pipe:0",
    "-an", "-vf", `fps=${fps},scale=${width}:-2`, "-q:v", "7", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], {
    stdin: true, spawn, stallMs, graceMs, onEnd,
    onData: (d) => {
      buf = Buffer.concat([buf, d]);
      // A JPEG runs from FF D8 to FF D9; ffmpeg's mjpeg frames carry no thumbnails, so the first FF D9 ends it.
      for (;;) {
        const s = buf.indexOf(Buffer.from([0xff, 0xd8]));
        if (s < 0) { buf = Buffer.alloc(0); break; }
        const e = buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2);
        if (e < 0) { buf = buf.subarray(s); break; }
        onFrame(Buffer.from(buf.subarray(s, e + 2)));
        buf = buf.subarray(e + 2);
      }
      if (buf.length > 4e6) buf = Buffer.alloc(0);
    },
  });
  return {
    push: (picture) => {
      if (!started && !picture.key) return;
      // A decoder that falls behind skips to the next IDR picture rather than queueing.
      if (ff.stdin?.writableLength > 2e6) { started = false; return; }
      started = true;
      try { ff.stdin?.write(picture.data); } catch { /* ended */ }
    },
    stop: ff.stop,
  };
}
