// farm-helper/bambu-home/lan.mjs — what the Bambu home helper shares between its two sides (the browser Bambu Studio's
// tab link, tablink.mjs; your Boolean3d account, helper.mjs): one link per printer, the shelf a printer fetches its
// files from, one way to start a print, one camera per printer. Node only, no packages. MIT licence (LICENSE).

import http from "node:http";
import net from "node:net";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { cameraVideo, ftpsUpload, jpegPictures, mqttLink } from "../bambu.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The links to the printers (MQTT over TLS), one per printer and access code, shared by whoever uses that printer:
 * take() it, give() it back; the last one to give it back closes it. A wrong access code never closes a good link.
 */
export function linkPool({ mqttPort = 8883, say = () => {} } = {}) {
  const all = new Map();   // `${serial}|${code}` -> {link, ip, users, ready}
  async function take(serial, ip, code) {
    const key = `${serial}|${code}`;
    let e = all.get(key);
    if (e && e.ip !== ip && !e.connecting) { e.link.close(); all.delete(key); e = null; }
    if (e && (e.connecting || e.link.isOpen())) {
      e.users++;
      try { await e.ready; } catch (err) { e.users--; throw err; }
      return e.link;
    }
    const link = mqttLink({ host: ip, port: mqttPort, serial, code });
    e = { link, ip, users: 1, connecting: true };
    all.set(key, e);
    e.ready = link.connect().then(() => {
      e.connecting = false;
      say(`linked to ${serial} at ${ip}`);
      link.on("close", () => { if (all.get(key) === e) all.delete(key); });
      link.on("error", () => {});
      link.pushall();
      link.request({ info: { sequence_id: "0", command: "get_version" } });
    }, (err) => { e.connecting = false; if (all.get(key) === e) all.delete(key); throw err; });
    try { await e.ready; } catch (err) { e.users--; throw err; }
    return link;
  }
  function give(link) {
    for (const [key, e] of all) {
      if (e.link !== link) continue;
      if (--e.users <= 0) { all.delete(key); link.close(); }
      return;
    }
  }
  /** An open link to that printer, whatever its code, or null. */
  const find = (serial) => [...all.entries()].find(([k, e]) => k.startsWith(`${serial}|`) && !e.connecting && e.link.isOpen())?.[1].link ?? null;
  const close = () => { for (const e of all.values()) e.link.close(); all.clear(); };
  return { take, give, find, close };
}

/** This computer's address on the way to `ip` (what the printer fetches a web link from); its LAN address when that fails. */
export function addressTowards(ip, port = 8883) {
  return new Promise((resolve) => {
    const lan = () => Object.values(os.networkInterfaces()).flat().find((i) => i?.family === "IPv4" && !i.internal)?.address ?? null;
    const s = net.connect({ host: ip, port, timeout: 3000 }, () => { const a = s.localAddress; s.destroy(); resolve(a); });
    s.on("timeout", () => s.destroy(new Error("timeout")));
    s.on("error", () => resolve(lan()));
  });
}

/**
 * The shelf: files an H2 printer fetches from a web link on the house network. Only this run's token opens them;
 * each goes when taken back (or after a day).
 */
export function fileShelf({ port = 0, host = null, say = () => {} } = {}) {
  const token = randomBytes(12).toString("hex");
  const files = new Map();   // name -> {bytes, at}
  const web = http.createServer((req, res) => {
    let u = "";
    try { u = decodeURIComponent((req.url || "").split("?")[0]); } catch { /* not ours */ }
    const f = u.startsWith(`/${token}/`) ? files.get(u.slice(token.length + 2)) : null;
    if (!f) { res.writeHead(404); return res.end(); }
    say(`printer fetches ${u.slice(token.length + 2)} (${f.bytes.length} bytes)`);
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": f.bytes.length });
    res.end(req.method === "HEAD" ? undefined : f.bytes);
  });
  const ready = new Promise((r) => web.listen(port, "0.0.0.0", () => r(web.address().port)));
  return {
    async put(name, bytes, towards) {
      const now = Date.now();
      for (const [n, f] of files) if (now - f.at > 86400000) files.delete(n);
      files.set(name, { bytes, at: now });
      const where = host || (await addressTowards(towards));
      if (!where) throw new Error("This computer has no address on the printer's network.");
      return `http://${where}:${await ready}/${token}/${encodeURIComponent(name)}`;
    },
    drop: (name) => files.delete(name),
    has: (name) => files.has(name),
    port: ready,
    close: () => web.close(),
  };
}

/** An H2 printer (model code O1…) fetches its file from a web link; X1/P1/A1 take it by FTPS onto their storage. */
export const fetchesByLink = (model) => /^O1/.test(String(model || ""));

/**
 * Put a printer file where the printer reads it and start it, as Bambu Studio does for a printer on the LAN, then wait
 * until the printer says it prepares or prints that task. `stage(name, percent?)` hears upload / sending.
 * @param {{link: object, ip: string, code: string, model: string, shelf: object, ftpPort?: number, name: string,
 *   bytes: Uint8Array, task?: string, plate?: number, amsMapping?: number[], amsMapping2?: object[], options?: object,
 *   upload?: boolean, waitMs?: number, stage?: (s: string, percent?: number) => void}} p
 *   `upload`: only put it there (Bambu Studio's "Send"), do not start it
 */
export async function sendPrint({ link, ip, code, model, shelf, ftpPort = 990, name, bytes, task = null, plate = 1, amsMapping = [],
  amsMapping2 = null, options = {}, upload = false, waitMs = 60000, stage = () => {} }) {
  stage("upload", 0);
  let url;
  if (fetchesByLink(model) && !upload) {
    // H2 printers in Developer Mode fetch the file from a web link on the house network (printer-test runs 2-3, 10-22).
    url = await shelf.put(name, bytes, ip);
  } else {
    const there = await ftpsUpload({ host: ip, port: ftpPort, code, name, bytes, timeout: 300000 });
    if (there !== bytes.length) throw new Error(`The printer kept ${there} of ${bytes.length} bytes.`);
    url = fetchesByLink(model) ? `ftp:///${name}` : `file:///sdcard/${name}`;
  }
  stage("upload", 100);
  if (upload) return { url };
  if (!link?.isOpen()) throw new Error("The helper has no link to the printer.");
  stage("sending");
  task ||= name.replace(/\.gcode\.3mf$/, "");
  const ams = Array.isArray(amsMapping) && amsMapping.length ? amsMapping : [0];
  const o = options;
  const cmd = {
    print: {
      sequence_id: String(Date.now() % 1e8), command: "project_file", param: `Metadata/plate_${Math.max(1, +plate || 1)}.gcode`, url,
      subtask_name: task, project_id: "0", profile_id: "0", task_id: "0", subtask_id: "0",
      bed_type: o.bed_type || "auto", timelapse: !!o.timelapse, bed_leveling: o.bed_leveling !== false, flow_cali: !!o.flow_cali,
      vibration_cali: !!o.vibration_cali, layer_inspect: !!o.layer_inspect,
      use_ams: o.use_ams ?? ams.some((n) => n < 254), ams_mapping: ams,
      ...(Array.isArray(amsMapping2) && amsMapping2.length ? { ams_mapping2: amsMapping2 } : {}),
    },
  };
  const was = link.report.print ?? {};
  const before = { state: was.gcode_state, error: Number(was.print_error) || 0 };
  link.request(cmd);
  // The printer takes it when it says it prepares or prints this task; a refusal says FAILED.
  const end = Date.now() + waitMs;
  for (;;) {
    await wait(500);
    const p = link.report.print ?? {};
    if (p.subtask_name === task && ["PREPARE", "RUNNING", "SLICING", "PAUSE"].includes(p.gcode_state)) return { url, task };
    // A refusal: FAILED with an error that is new (the last print may have ended FAILED too, with its own error).
    const err = Number(p.print_error) || 0;
    if (p.gcode_state === "FAILED" && err && (before.state !== "FAILED" || err !== before.error || p.subtask_name === task)) {
      throw new Error(`The printer refused it (error ${(Number(p.print_error) >>> 0).toString(16).toUpperCase().padStart(8, "0")}).`);
    }
    if (!link.isOpen()) throw new Error("The link to the printer closed while it was starting.");
    if (Date.now() > end) throw new Error(`The printer did not take the file within ${Math.round(waitMs / 1000)} s. Is its plate clear and the printer idle?`);
  }
}

/**
 * One camera per printer, shared by whoever watches: the first watcher starts ffmpeg on the printer's stream (its own
 * H.264, copied, never decoded: cameraVideo), the last one to stop stops it; a printer is read once whatever watches.
 * A "video" watcher hears every picture as it came ({data, key}, H.264); a "jpeg" watcher hears `fps` JPEGs a second
 * (a Buffer each), decoded here only while one watches. Each hears, once, why it ended.
 * `input`: ffmpeg's input arguments instead of the printer's stream (a test picture).
 */
export function cameraHub({ fps = 2, input = null, say = () => {}, video = cameraVideo, stills = jpegPictures } = {}) {
  const running = new Map();   // serial -> {watchers: Set, stop, jpeg}
  function endAll(r, why, kind = null) {
    for (const x of [...r.watchers]) if (!kind || x.kind === kind) { r.watchers.delete(x); x.onEnd(why); }
  }
  // The JPEG maker runs while a jpeg watcher does.
  function stillsFor(r) {
    const want = [...r.watchers].some((x) => x.kind === "jpeg");
    if (want && !r.jpeg) {
      const j = r.jpeg = { push: () => {}, stop: () => {} };
      stills({ fps,
        onFrame: (f) => { for (const x of r.watchers) if (x.kind === "jpeg") x.onFrame(f); },
        onEnd: (why) => { if (r.jpeg !== j) return; r.jpeg = null; if (why) say(`camera pictures: ${why}`); endAll(r, why, "jpeg"); },
      }).then((s) => { j.push = s.push; j.stop = s.stop; if (r.jpeg !== j) s.stop(); });
    } else if (!want && r.jpeg) { const j = r.jpeg; r.jpeg = null; j.stop(); }
  }
  function watch({ serial, ip, code }, onFrame, onEnd = () => {}, kind = "jpeg") {
    let r = running.get(serial);
    const w = { onFrame, onEnd, kind };
    if (!r) {
      r = { watchers: new Set(), stop: () => {}, jpeg: null };
      const me = r;
      running.set(serial, r);
      video({ host: ip, code, input,
        onFrame: (p) => { me.jpeg?.push(p); for (const x of me.watchers) if (x.kind === "video") x.onFrame(p); },
        onEnd: (why) => {
          if (running.get(serial) === me) running.delete(serial);
          if (why) say(`camera: ${why}`);
          if (me.jpeg) { const j = me.jpeg; me.jpeg = null; j.stop(); }
          endAll(me, why);
        } }).then((stop) => { me.stop = stop; if (!me.watchers.size) stop(); });
    }
    r.watchers.add(w);
    stillsFor(r);
    return () => {
      if (!r.watchers.delete(w)) return;
      stillsFor(r);
      if (r.watchers.size) return;
      if (running.get(serial) === r) running.delete(serial);
      r.stop();
    };
  }
  const close = () => { for (const r of running.values()) { r.jpeg?.stop(); r.stop(); } running.clear(); };
  return { watch, close };
}

/**
 * A file inside a zip (a printer file, .gcode.3mf, is one), read from its central directory: its bytes, or null when it
 * is not there. Stored and deflated entries only (all a 3MF uses).
 */
export function zipEntry(bytes, wanted) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  let at = b.readUInt32LE(end + 16);
  const count = b.readUInt16LE(end + 10);
  for (let n = 0; n < count && at + 46 <= b.length && b.readUInt32LE(at) === 0x02014b50; n++) {
    const method = b.readUInt16LE(at + 10), size = b.readUInt32LE(at + 20);
    const nameLen = b.readUInt16LE(at + 28), extra = b.readUInt16LE(at + 30), note = b.readUInt16LE(at + 32);
    const local = b.readUInt32LE(at + 42);
    const name = b.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extra + note;
    if (name !== wanted) continue;
    if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(start, start + size);
    if (method === 0) return Buffer.from(data);
    if (method === 8) { try { return inflateRawSync(data); } catch { return null; } }
    return null;
  }
  return null;
}

/** The plate's picture Bambu Studio puts in a printer file (Metadata/plate_<n>.png, the small one when there is one), or null. */
export function platePicture(bytes, plate = 1, most = 290000) {
  const n = Math.max(1, Number(plate) || 1);
  for (const name of [`Metadata/plate_${n}_small.png`, `Metadata/plate_${n}.png`]) {
    const png = zipEntry(bytes, name);
    if (png && png.length >= 8 && png.length <= most && png.readUInt32BE(0) === 0x89504e47) return png;
  }
  return null;
}

/** The bed-slinger models (A1, A1 mini): their Y and Z move the other way to a CoreXY's (Bambu Studio DevAxisCtrl.cpp). */
const BED_SLINGERS = /^(N1|N2S|A1)/i;
/**
 * The printer's own requests for one of the printers page's controls (the door's controlOf), as Bambu Studio sends them
 * on the LAN (BambuStudio src/slic3r/GUI/DeviceCore/DevAxisCtrl.cpp Ctrl_GoHome / Ctrl_Axis, DevLampCtrl.cpp
 * command_set_chamber_light, DeviceManager.cpp command_set_nozzle / command_set_bed / publish_gcode): G-code lines for
 * home, move and temperatures, ledctrl for the lamp. Speeds are Bambu Studio's (3000 mm/min across, 900 up and down).
 */
export function controlRequests(c, { model = null, printing = false } = {}) {
  const seq = () => String(Date.now() % 1e8);
  const gcode = (param) => ({ print: { sequence_id: seq(), command: "gcode_line", param } });
  if (c?.do === "home") return [gcode(printing ? "G28 X\n" : "G28 \n")];
  if (c?.do === "jog" && ["X", "Y", "Z"].includes(c.axis) && Number.isFinite(c.mm)) {
    const mm = BED_SLINGERS.test(String(model || "")) && c.axis !== "X" ? -c.mm : c.mm;
    return [gcode(`M211 S \nM211 X1 Y1 Z1\nM1002 push_ref_mode\nG91 \nG1 ${c.axis}${mm.toFixed(1)} F${c.axis === "Z" ? 900 : 3000}\nM1002 pop_ref_mode\nM211 R\n`)];
  }
  if (c?.do === "temp" && Number.isInteger(c.target)) return [gcode(`${c.heater === "bed" ? "M140" : "M104"} S${c.target}\n`)];
  if (c?.do === "light" && typeof c.on === "boolean") {
    return ["chamber_light", "chamber_light2"].map((node) => ({ system: { sequence_id: seq(), command: "ledctrl", led_node: node, led_mode: c.on ? "on" : "off",
      led_on_time: 500, led_off_time: 500, loop_times: 1, interval_time: 1000 } }));
  }
  return [];
}
