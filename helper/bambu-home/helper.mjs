#!/usr/bin/env node
// farm-helper/bambu-home/helper.mjs — the Boolean3d printer helper for a Bambu Lab printer at home.
//
// Runs on any computer on the printer's own network that stays on (a Raspberry Pi, a home server; Node 18 or newer,
// nothing else; ffmpeg for the camera). Two sides, one program:
//   - Bambu Studio in a browser tab on this network finds your printers through it and prints on them, with the
//     printer's camera (tablink.mjs, ws://<this computer>:8770). Nothing to pair for that.
//   - Paired with your Boolean3d account, it tells the account what the printer is doing, starts the prints sent to it
//     from there and relays the camera while someone looks. Every print a tab starts on that printer is kept in the
//     account too (the file, its plate picture, how it was sent), so Reprint works from any browser, away from home. It only calls out to Boolean3d: no open port to the
//     internet, no VPN. The printer's serial and access code stay in this computer's helper file.
//
// The printer must be in LAN-only mode with Developer Mode on (printer screen: Settings > Network / LAN).
//
//   node helper.mjs run          keep going (the service runs this): the tab link, and the account when paired
//   node helper.mjs pair <CODE> --server <address> --serial <serial> --access <access code> [--ip <address>] [--key <key>]
//   node helper.mjs status       what the paired printer says now, once
//   node helper.mjs printers     the printers heard on this network
//
// The helper file: ~/.boolean3d-bambu.json (or --file <path>); "tabPort": false there turns the tab link off.
// MIT licence (LICENSE beside this file).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { activeSlot, hmsCode, listenForPrinters, mqttLink, nozzleOf, rtspsCamera, slotNumber, slotsOf } from "../bambu.mjs";
import { createHash } from "node:crypto";
import { cameraHub, fileShelf, linkPool, platePicture, sendPrint } from "./lan.mjs";
import { startTabLink } from "./tablink.mjs";

export const VERSION = "3";
/** Where Bambu Studio in a browser tab finds the helper (ws://<this computer>:8770). */
export const TAB_PORT = 8770;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Camera frames a second (a slower link drops frames, it does not queue them). */
const FRAME_FPS = 3;

/** A printer's state in the words the printers door reads (Moonraker's: standby, printing, paused, complete, cancelled, error). */
export function reportOf(report, { model = null, camera = false } = {}) {
  const p = report?.print ?? {};
  const g = String(p.gcode_state ?? "");
  const err = Number(p.print_error) || 0;
  // 0300400C: the print was stopped (the printer's own words "Printing was cancelled").
  const state = { IDLE: "standby", PREPARE: "printing", SLICING: "printing", RUNNING: "printing", PAUSE: "paused", FINISH: "complete" }[g]
    ?? (g === "FAILED" ? (err === 0x0300400c ? "cancelled" : "error") : g ? "unknown" : "unknown");
  const code = err ? (err >>> 0).toString(16).toUpperCase().padStart(8, "0").replace(/^(.{4})/, "$1-") : null;
  const hms = (p.hms ?? []).map(hmsCode);
  const message = (state === "error" || state === "paused") && (code || hms.length)
    ? `The printer says ${[code ? `error ${code}` : null, ...hms.map((h) => `HMS ${h}`)].filter(Boolean).join(", ")}: see its screen.`
    : null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const now = activeSlot(report);
  const nozzle = nozzleOf(report);
  const chamber = n(p.device?.ctc?.info?.temp ?? p.chamber_temper);
  return {
    state, message,
    file: p.subtask_name ? `${p.subtask_name}.gcode.3mf` : null,
    percent: n(p.mc_percent), secondsLeft: state === "printing" || state === "paused" ? (n(p.mc_remaining_time) ?? 0) * 60 : null,
    layer: n(p.layer_num), layers: n(p.total_layer_num),
    temps: Object.fromEntries(Object.entries({
      nozzle: n(p.nozzle_temper), nozzleTarget: n(p.nozzle_target_temper), bed: n(p.bed_temper), bedTarget: n(p.bed_target_temper), chamber,
    }).filter(([, v]) => v !== null)),
    nozzle: { diameter: nozzle.diameter, flow: nozzle.flow },
    trays: slotsOf(report).filter((s) => !s.empty).map((s) => ({ slot: slotNumber(s), material: s.material, colour: s.colour, name: s.name, active: slotNumber(s) === now })),
    hasCamera: camera && rtspsCamera(model),
  };
}

/**
 * The helper, running: the tab link for Bambu Studio in a browser on this network (tablink.mjs), and, once paired with
 * a Boolean3d account, a call to the printers door every few seconds with what the printer says, the prints sent to it
 * and its camera while someone looks. Both sides share one link per printer, the shelf an H2 printer fetches its files
 * from and one camera per printer (lan.mjs). Returns {sync, link, tabPort, webPort, stop}.
 * @param {{server?: string, key?: string, anon?: string, serial?: string, code?: string, ip?: string, printerModel?: string,
 *   name?: string, mqttPort?: number, ftpPort?: number, filePort?: number, fileHost?: string, tabPort?: number|false,
 *   tabHost?: string, cameraInput?: string[], fps?: number, ssdpPort?: number}} cfg
 *   `key`: paired with an account (no key: the tab link alone); `tabPort` false: no tab link
 */
export function startHelper(cfg, { fetch: get = fetch, discover = true, loop = true, say = console.log, save = () => {} } = {}) {
  const pool = linkPool({ mqttPort: cfg.mqttPort, say });
  const shelf = fileShelf({ port: cfg.filePort ?? 0, host: cfg.fileHost || null, say });
  const cameras = cameraHub({ fps: cfg.fps ?? FRAME_FPS, input: cfg.cameraInput ?? null, say });
  const heard = new Map();      // serial -> {serial, ip, model, name}
  const hasFfmpeg = !!cfg.cameraInput || hasProgram("ffmpeg");
  const paired = !!(cfg.key && cfg.server && cfg.serial && cfg.code);
  const events = [];
  let stopped = false, timer = null, poll = 5000, link = null, connecting = false, linkError = null, said = null;
  let ip = cfg.ip || cfg.heardIp || null, model = cfg.printerModel || null;
  let cam = null;               // {stop, last, sending, until}

  const tab = cfg.tabPort === false ? null : startTabLink({ port: cfg.tabPort ?? TAB_PORT, host: cfg.tabHost, pool, shelf, cameras, heard,
    mqttPort: cfg.mqttPort, ftpPort: cfg.ftpPort, cameraInput: cfg.cameraInput ?? null, say, onPrinted: (p) => keep(p) });
  tab?.port.then((p) => say(`Bambu Studio in a browser on this network: its printer link is ws://<this computer>:${p}`), () => {});

  // The printers on this network, from their announcements (an address can change when the router restarts).
  const stopListen = discover ? listenForPrinters((f) => {
    const was = heard.get(f.serial);
    heard.set(f.serial, { ...was, ...f, at: Date.now() });
    if (!was || was.ip !== f.ip) say(`heard ${f.serial} (${f.model}, "${f.name}") at ${f.ip}`);
    tab?.heardPrinter(f.serial);
    if (f.serial !== cfg.serial) return;
    if (f.model) model = f.model;
    if (f.ip && f.ip !== ip && !cfg.ip) { ip = f.ip; save({ heardIp: ip, printerModel: model }); dropLink(); }
  }, { port: cfg.ssdpPort ?? 2021 }) : () => {};

  function dropLink() { if (link) { const l = link; link = null; pool.give(l); } }

  async function linkUp() {
    if (link?.isOpen() || connecting || !ip) return;
    dropLink();
    connecting = true;
    try {
      const l = await pool.take(cfg.serial, ip, cfg.code);
      link = l; linkError = null;
      l.on("close", () => { if (link === l) { link = null; pool.give(l); } });
      await wait(1500);
      say(`linked to the printer at ${ip}`);
    } catch (err) {
      linkError = err.code === "ACCESS_CODE" ? "The printer refused the access code (it changes when LAN-only mode is switched off and on)." : `The printer does not answer at ${ip} (${err.message}).`;
      if (linkError !== said) say(linkError);
      said = linkError;
    } finally { connecting = false; }
  }

  const printerReport = () => {
    if (!ip) return { state: "offline", message: "The helper has not heard the printer on this network yet. Is it on, in LAN-only mode?", temps: {} };
    if (!link?.isOpen() || !link.report.print) return { state: "offline", message: linkError || "Linking to the printer…", temps: {} };
    return reportOf(link.report, { model, camera: hasFfmpeg });
  };

  /** One print sent from the account: fetch the file, then the printer takes it as from Bambu Studio on the LAN. */
  async function start(s) {
    try {
      if (!link?.isOpen()) throw new Error("The helper has no link to the printer.");
      const answer = await get(s.url);
      if (!answer.ok) throw new Error(`The print file could not be fetched (${answer.status}).`);
      const bytes = new Uint8Array(await answer.arrayBuffer());
      if (s.bytes && bytes.length !== s.bytes) throw new Error(`Only ${bytes.length} of ${s.bytes} bytes of the print file arrived.`);
      const job = s.job ?? {};
      await sendPrint({ link, ip, code: cfg.code, model: cfg.via === "web" ? "O1" : model, shelf, ftpPort: cfg.ftpPort, name: s.file, bytes,
        amsMapping: Array.isArray(s.slots) ? s.slots : [], plate: job.plate ?? 1, amsMapping2: job.amsMapping2 ?? null, options: job.options ?? {} });
      say(`started ${s.file}`);
      events.push({ print: s.print, ok: true });
    } catch (err) {
      say(`could not start ${s.file}: ${err.message}`);
      events.push({ print: s.print, ok: false, error: String(err.message).slice(0, 300) });
      shelf.drop(s.file);
    }
  }

  // ── A print a tab started on the paired printer goes into the account, one at a time, in the order they came ──
  let keeping = Promise.resolve();
  function keep(p) {
    if (!paired || p.devId !== cfg.serial) return;
    keeping = keeping.then(() => keepOne(p)).catch((err) => say(`could not keep ${p.name} in the account: ${err.message}`));
  }
  async function keepOne(p) {
    const bytes = p.bytes;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    for (let tries = 1; ; tries++) {
      try {
        const k = await call("helper-keep", { sha256, bytes: bytes.length });
        if (k.upload) {
          const put = await get(k.upload, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
          if (!put.ok && put.status !== 409 && put.status !== 400) throw new Error(`the upload answered ${put.status}`);
        }
        const picture = platePicture(bytes, p.plate);
        await call("helper-kept", {
          sha256, bytes: bytes.length, name: p.name, file: p.file, slots: p.amsMapping, picture: picture ? picture.toString("base64") : null,
          job: { plate: Number(p.plate) || 1, amsMapping2: p.amsMapping2, options: p.options },
        });
        say(`kept ${p.name} in the account`);
        return;
      } catch (err) {
        if (tries >= 3 || ["full", "too_big", "unpaired", "bad_request"].includes(err.code)) throw err;
        await wait(10000 * tries);
      }
    }
  }

  // ── The camera, while someone looks in the account: frames as fast as the door takes them, the newest one only ──
  function camera(want) {
    if (!want) { if (cam && Date.now() > cam.until) { cam.stop(); cam = null; } return; }
    if (cam) { cam.until = Date.now() + 25000; return; }
    if (!hasFfmpeg || !ip || !(rtspsCamera(model) || cfg.cameraInput)) return;
    const c = { last: null, sending: false, until: Date.now() + 25000, stop: () => {} };
    cam = c;
    const send = async () => {
      if (c.sending || !c.last || cam !== c) return;
      const frame = c.last; c.last = null; c.sending = true;
      try {
        const r = await call("helper-frame", { picture: frame.toString("base64") });
        if (r.camera === false) { c.stop(); if (cam === c) cam = null; }
      } catch (err) { if (err.code === "rate_limited") await wait(2000); } finally { c.sending = false; }
      send();
    };
    c.stop = cameras.watch({ serial: cfg.serial, ip, code: cfg.code },
      (f) => { if (f.length <= 290000) { c.last = f; send(); } },
      () => { if (cam === c) cam = null; });
  }

  async function call(p, body) {
    const answer = await get(`${cfg.server.replace(/\/+$/, "")}/${p}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-helper-key": cfg.key, ...(cfg.anon ? { apikey: cfg.anon, Authorization: `Bearer ${cfg.anon}` } : {}) },
      body: JSON.stringify(body),
    });
    const r = await answer.json().catch(() => ({ ok: false, error: `Boolean3d answered ${answer.status}.` }));
    if (!r.ok) throw Object.assign(new Error(r.error || "Boolean3d refused."), { code: r.code });
    return r;
  }

  if (!ip && cfg.serial) ip = heard.get(cfg.serial)?.ip ?? null;
  let hostSent = false;
  async function sync() {
    if (!ip && cfg.serial) ip = heard.get(cfg.serial)?.ip ?? null;
    await linkUp();
    const report = printerReport();
    const firmware = link?.report.info?.module?.find((m) => m.name === "ota")?.sw_ver;
    const body = { version: VERSION, printer: report, events: events.splice(0) };
    if (!hostSent && firmware) body.host = { firmware, os: `${os.type()} ${os.arch()}` };
    let r;
    try { r = await call("helper-sync", body); } catch (err) { events.unshift(...body.events); throw err; }
    if (body.host) hostSent = true;
    poll = Math.max(1000, Math.min(60000, Number(r.poll) || poll));
    camera(!!r.camera);
    for (const id of r.cancel || []) {
      if (link?.isOpen()) { link.request({ print: { sequence_id: String(Date.now() % 1e8), command: "stop", param: "" } }); say(`stopped the print, as asked (${id})`); }
    }
    for (const s of r.send || []) await start(s);
    return r;
  }

  if (loop && paired) (async function keepGoing() {
    say(`Boolean3d helper ${VERSION} running for ${cfg.name || "your printer"} (${cfg.serial}).`);
    let down = null;
    while (!stopped) {
      try { await sync(); if (down) { say("Boolean3d answers again."); down = null; } } catch (err) {
        if (err.code === "unpaired") { say(err.message); break; }
        if (err.message !== down) say(`Boolean3d: ${err.message}`);
        down = err.message; poll = 15000;
      }
      await new Promise((r) => { timer = setTimeout(r, poll); });
    }
  })();
  else if (loop) say(`Boolean3d helper ${VERSION} running for Bambu Studio on this network (not linked to an account).`);

  return {
    sync, get link() { return link; }, heard, tabPort: tab?.port ?? Promise.resolve(null), webPort: shelf.port,
    stop() { stopped = true; clearTimeout(timer); stopListen(); cam?.stop(); cameras.close(); tab?.close(); pool.close(); shelf.close(); },
  };
}

function hasProgram(name) {
  return (process.env.PATH || "").split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, name)));
}

/** The printer's address: as given, or heard on the network within `ms`. */
async function findPrinter(serial, ms = 20000) {
  return new Promise((resolve) => {
    const stop = listenForPrinters((f) => { if (f.serial === serial) { stop(); clearTimeout(t); resolve(f); } });
    const t = setTimeout(() => { stop(); resolve(null); }, ms);
  });
}

// ── The command line ───────────────────────────────────────────────
function arg(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }
async function main(argv) {
  const [cmd, ...args] = argv;
  const file = arg(args, "--file") || path.join(os.homedir(), ".boolean3d-bambu.json");
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
  const write = (c) => fs.writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  const cfg = read();

  if (cmd === "pair") {
    const code = args[0] && !args[0].startsWith("--") ? args[0] : null;
    const server = arg(args, "--server") || cfg.server, serial = (arg(args, "--serial") || cfg.serial || "").trim().toUpperCase();
    const access = (arg(args, "--access") || cfg.code || "").trim();
    if (!code || !server || !serial || !access) { console.log("pair <CODE> --server <address> --serial <serial> --access <access code>: all are in the install line the Print panel shows."); return 2; }
    let ip = arg(args, "--ip") || null, printerModel = null;
    if (!ip) {
      console.log(`Listening for printer ${serial} on this network…`);
      const f = await findPrinter(serial);
      if (!f) { console.log("The printer was not heard. Is it on, on this network, in LAN-only mode? Or add its address: --ip 192.168.1.x"); return 1; }
      ip = f.ip; printerModel = f.model;
    }
    const link = mqttLink({ host: ip, port: Number(arg(args, "--mqtt-port")) || undefined, serial, code: access });
    try { await link.connect(); } catch (err) {
      console.log(err.code === "ACCESS_CODE" ? "The printer refused the access code. Check it on the printer's screen (Settings > Network / LAN)." : `The printer does not answer at ${ip}: ${err.message}. Is Developer Mode on?`);
      return 1;
    }
    link.request({ info: { sequence_id: "1", command: "get_version" } });
    await wait(1500); link.close();
    const firmware = link.report.info?.module?.find((m) => m.name === "ota")?.sw_ver ?? null;
    const anon = arg(args, "--key") || cfg.anon;
    const answer = await fetch(`${server.replace(/\/+$/, "")}/helper-pair`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}) },
      body: JSON.stringify({ code, version: VERSION, host: { firmware, os: `${os.type()} ${os.arch()}` } }),
    });
    const r = await answer.json().catch(() => ({ ok: false, error: `Boolean3d answered ${answer.status}.` }));
    if (!r.ok) { console.log(r.error); return 1; }
    write({ ...cfg, server, anon, key: r.key, name: r.name, model: r.model, serial, code: access, ...(arg(args, "--ip") ? { ip } : {}), printerModel });
    console.log(`Paired: this printer is ${r.name} in your Boolean3d account.`);
    return 0;
  }
  if (cmd === "status") {
    let ip = cfg.ip || (await findPrinter(cfg.serial, 15000))?.ip;
    if (!ip) { console.log("The printer was not heard on this network."); return 1; }
    const link = mqttLink({ host: ip, serial: cfg.serial, code: cfg.code });
    await link.connect(); link.pushall(); await wait(4000); link.close();
    console.log(JSON.stringify(reportOf(link.report, { model: cfg.printerModel, camera: true }), null, 2));
    return 0;
  }
  if (cmd === "printers") {
    const seen = new Map();
    const stop = listenForPrinters((f) => { if (!seen.has(f.serial)) { seen.set(f.serial, f); console.log(`${f.serial}  ${f.model}  ${f.ip}  ${f.name}`); } });
    await wait(12000); stop();
    if (!seen.size) console.log("No Bambu Lab printer heard on this network in 12 s. Is it on, in LAN-only mode?");
    return 0;
  }
  if (cmd === "run") {
    const h = startHelper(cfg, { save: (patch) => write({ ...read(), ...patch }) });
    process.on("SIGINT", () => { h.stop(); process.exit(0); });
    process.on("SIGTERM", () => { h.stop(); process.exit(0); });
    return null;
  }
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 23).join("\n"));
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const code = await main(process.argv.slice(2));
  if (code !== null) process.exit(code);
}
