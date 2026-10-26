#!/usr/bin/env node
// farm-helper/bambu-home/helper.mjs — the Boolean3d printer helper for a Bambu Lab printer at home.
//
// Runs on any computer on the printer's own network that stays on (a Raspberry Pi, a home server; Node 18 or newer,
// nothing else; ffmpeg for the camera). Two sides, one program:
//   - Bambu Studio in a browser tab on this network finds your printers through it and prints on them, with the
//     printer's camera (tablink.mjs, ws://<this computer>:8770). Nothing to pair for that.
//   - Paired with your Boolean3d account, it tells the account what the printer is doing, starts the prints sent to it
//     from there, relays the camera while someone looks and passes on the printers page's buttons (home, move the
//     head, temperatures, the lamp). Every print a tab starts on that printer is kept in the
//     account too (the file, its plate picture, how it was sent), so Reprint works from any browser, away from home. It only calls out to Boolean3d: no open port to the
//     internet, no VPN. The printer's serial and access code stay in this computer's helper file.
//
// The printer must be in LAN-only mode with Developer Mode on (printer screen: Settings > Network / LAN).
//
//   node helper.mjs run          keep going (the service runs this): the tab link, and the account when paired
//   node helper.mjs code         the code a browser types to pair with the running helper (pairing.mjs)
//   node helper.mjs forget       every paired browser is forgotten; each pairs again with the code
//   node helper.mjs install      start the helper with this computer (uninstall: no longer); the downloaded helper does this
//   node helper.mjs pair <CODE> --server <address> --serial <serial> --access <access code> [--ip <address>] [--key <key>]
//   node helper.mjs status       what the paired printer says now, once
//   node helper.mjs printers     the printers heard on this network
//   node helper.mjs prusa <address> --password <password> [--user maker] [--key <API key>]
//                                a Prusa printer with PrusaLink on (its address, user and password on its screen:
//                                Settings > Network > PrusaLink); status then shows it too
//
// The helper file: ~/.boolean3d-bambu.json (or --file <path>); "tabPort": false there turns the tab link off;
// "origins": ["https://..."] adds pages it answers; its identity and the paired browsers live there too.
// MIT licence (LICENSE beside this file).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { activeSlot, hmsCode, listenForPrinters, mqttLink, searchForPrinters, nozzleOf, rtspsCamera, slotNumber, slotsOf } from "../bambu.mjs";
import { createHash } from "node:crypto";
import { cameraHub, controlRequests, fileShelf, linkPool, platePicture, sendPrint } from "./lan.mjs";
import { startTabLink } from "./tablink.mjs";
import { pairing as pairingOf, secretIn } from "./pairing.mjs";
import { autostart } from "./autostart.mjs";
import { prusaLink, reportOf as prusaReportOf } from "../prusalink.mjs";

export const VERSION = "9";
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
    // The lamp as the printer reports it (lights_report, chamber_light); null when it reports none.
    light: Array.isArray(p.lights_report) && p.lights_report.some((l) => l?.node === "chamber_light")
      ? p.lights_report.find((l) => l.node === "chamber_light").mode === "on" : null,
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

  // Who may talk to it (pairing.mjs): the helper file keeps its identity and the paired browsers. `pairing` false: open (tests).
  // `downloadSecret`: the one the downloaded program's own name carries (app.mjs), so the browser that downloaded it pairs by itself.
  const pair = cfg.pairing === false ? null : pairingOf(cfg, { save, say, secret: cfg.downloadSecret ?? null });
  const page = (req) => helperPage(req, { pairing: pair, heard, name: cfg.name, forget: () => { pair?.forget(); say("every paired browser forgotten, as asked"); } });
  // tabPort false: no tab link on this network (a tab's line can still come through the box relay, attachTab).
  const tab = startTabLink({ port: cfg.tabPort === false ? false : (cfg.tabPort ?? TAB_PORT), host: cfg.tabHost, pool, shelf, cameras, heard,
    pairing: pair, name: cfg.name, version: VERSION, page, search: (o) => searchNow(o), mqttPort: cfg.mqttPort, ftpPort: cfg.ftpPort, cameraInput: cfg.cameraInput ?? null, say, onPrinted: (p) => keep(p) });
  tab.port.then((p) => {
    if (!p) return;
    say(`Slicers in a browser on this network (Bambu Studio, OrcaSlicer, PrusaSlicer) reach it at ws://<this computer>:${p}`);
    if (pair?.bySecret) say("The browser you downloaded this helper with links to it by itself: go back to the slicer's page.");
    if (pair) say(`${pair.bySecret ? "Another browser" : "To pair a browser"}, type this code in its page: ${pair.showCode}   (also at http://localhost:${p}/ on this computer)`);
  }, () => {});

  // The printers on this network, from their announcements (an address can change when the router restarts), and from
  // the helper's own search (bambu.mjs searchForPrinters): a firewall with no rule for the helper drops the announcements.
  const onHeard = (f) => {
    const was = heard.get(f.serial), known = Object.fromEntries(Object.entries(f).filter(([, v]) => v != null));
    heard.set(f.serial, { ...was, ...known, at: Date.now() });
    if (!was || was.ip !== f.ip) say(`heard ${f.serial} (${f.model ?? was?.model ?? "model not said"}, "${f.name ?? was?.name ?? f.serial}") at ${f.ip}`);
    tab?.heardPrinter(f.serial);
    if (f.serial !== cfg.serial) return;
    if (f.model) model = f.model;
    if (f.ip && f.ip !== ip && !cfg.ip) { ip = f.ip; save({ heardIp: ip, printerModel: model }); dropLink(); }
  };
  const stopListen = discover ? listenForPrinters(onHeard, { port: cfg.ssdpPort ?? 2021 }) : () => {};
  // By itself: an SSDP search soon after start, then each minute while no printer is known, else every ten minutes.
  // A tab's "Search my network" or typed address (tablink op search) knocks too: {knock: true, hosts?}.
  function searchNow(o = {}) {
    return searchForPrinters(onHeard, { port: cfg.mqttPort ?? 8883, ssdpPort: cfg.ssdpPort ?? 2021, hosts: cfg.searchHosts ?? null, stopped: () => stopped, ...o })
      .catch(() => 0);
  }
  let searchTimer = null;
  const search = () => {
    if (stopped) return;
    searchNow().then(() => { if (!stopped) { searchTimer = setTimeout(search, heard.size ? 600000 : 60000); searchTimer.unref?.(); } });
  };
  if (discover && cfg.search !== false) { searchTimer = setTimeout(search, 1500); searchTimer.unref?.(); }

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
    // The printers page's buttons, as Bambu Studio sends them on the LAN.
    for (const c of r.controls || []) {
      if (!link?.isOpen()) { say("a control from the account was dropped: no link to the printer"); continue; }
      for (const req of controlRequests(c, { model, printing: ["printing", "paused"].includes(report.state) })) link.request(req);
      say(`did ${c.do}${c.axis ? ` ${c.axis}${c.mm}` : ""}${c.heater ? ` ${c.heater} ${c.target}` : ""}${c.do === "light" ? ` ${c.on ? "on" : "off"}` : ""}, as asked`);
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
  else if (loop) say(`Boolean3d helper ${VERSION} running for your printers on this network (not linked to an account).`);

  return {
    sync, get link() { return link; }, heard, tabPort: tab?.port ?? Promise.resolve(null), webPort: shelf.port, pairing: pair,
    /** A browser tab's line from elsewhere (the printer box's relay, box.mjs), served like a tab on this network. */
    attachTab: (line, opts) => tab?.attach(line, opts),
    stop() { stopped = true; clearTimeout(timer); clearTimeout(searchTimer); stopListen(); cam?.stop(); cameras.close(); tab?.close(); pool.close(); shelf.close(); },
  };
}

// ── The helper's own page, http://localhost:8770/ on this computer only (tablink.mjs serves it to loopback): the code
//    to type, the printers heard, the paired browsers; /state.json the same as data; POST /forget unpairs every browser ──
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function helperPage(req, { pairing, heard, name = null, forget = () => {} }) {
  const url = new URL(req.url || "/", "http://x");
  const printers = [...heard.values()].map((p) => ({ name: p.name || p.serial, model: p.model || "", ip: p.ip }));
  const state = { name: name || os.hostname(), version: VERSION, id: pairing?.helperId ?? null, code: pairing?.showCode ?? null,
    paired: pairing?.paired.length ?? 0, printers };
  if (url.pathname === "/state.json") return { type: "application/json", body: JSON.stringify(state) };
  if (url.pathname === "/forget" && req.method === "POST") { forget(); return { type: "text/plain", body: "forgotten\n" }; }
  if (url.pathname !== "/") return null;
  const list = printers.length
    ? `<ul>${printers.map((p) => `<li>${esc(p.name)} <span class=m>${esc(p.model)} at ${esc(p.ip)}</span></li>`).join("")}</ul>`
    : `<p class=m>No Bambu Lab printer heard yet. Is it on, on this network, with LAN-only mode and Developer Mode on?</p>`;
  return { type: "text/html; charset=utf-8", body: `<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<meta http-equiv=refresh content=5><title>Boolean3d printer helper</title>
<style>body{font:16px system-ui,sans-serif;background:#16181c;color:#e8e8e8;max-width:32rem;margin:2rem auto;padding:0 1rem}
h1{font-size:1.4rem}.code{font:700 2.4rem ui-monospace,monospace;letter-spacing:.12em}.m{color:#9aa0a6}h2{font-size:1.05rem;margin-top:2rem}ul{padding-left:1.2rem}</style>
<body><h1>Boolean3d printer helper</h1>
${state.code ? `<p>In the slicer's page, under Device, type this code once to pair this browser:</p><p class=code>${esc(state.code)}</p>` : ""}
<p class=m>Running on ${esc(state.name)}, version ${esc(state.version)}. ${state.paired} browser${state.paired === 1 ? "" : "s"} paired.</p>
<h2>Printers it hears</h2>${list}
<p class=m>This page is shown only on this computer. The helper answers Boolean3d's own pages, and only browsers paired with the code.</p>
</body></html>` };
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
async function command(argv, packaged, programPath) {
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
  if (cmd === "prusa") {
    const host = args[0] && !args[0].startsWith("--") ? args[0] : null;
    const p = { host, user: arg(args, "--user") || "maker", password: arg(args, "--password") || "", apiKey: arg(args, "--key") || null };
    if (!host || (!p.password && !p.apiKey)) { console.log("prusa <address> --password <password>: the address, user and password are on the printer's screen (Settings > Network > PrusaLink)."); return 2; }
    let v;
    try { v = await prusaLink(p).version(); } catch (err) { console.log(err.code === "LOGIN" ? err.message : `The printer does not answer at ${host}: ${err.message}. Is PrusaLink on?`); return 1; }
    if (!String(v?.text ?? "").startsWith("PrusaLink")) { console.log(`${host} answers, but not as PrusaLink.`); return 1; }
    write({ ...cfg, prusa: [...(cfg.prusa ?? []).filter((x) => x.host !== host), p] });
    console.log(`Saved: the Prusa printer at ${host} (${v.text}${v.hostname ? `, ${v.hostname}` : ""}).`);
    return 0;
  }
  if (cmd === "status") {
    for (const p of cfg.prusa ?? []) {
      try { console.log(JSON.stringify({ printer: p.host, ...prusaReportOf(await prusaLink(p).status()) }, null, 2)); }
      catch (err) { console.log(`${p.host}: ${err.message}`); }
    }
    if (!cfg.serial) return (cfg.prusa ?? []).length ? 0 : 1;
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
  if (cmd === "run" || (!cmd && packaged)) {
    // the download secret in the program's own name or folder (pairing.mjs 2b); never written to the helper file
    const h = startHelper({ ...cfg, downloadSecret: secretIn(programPath) }, { save: (patch) => write({ ...read(), ...patch }) });
    process.on("SIGINT", () => { h.stop(); process.exit(0); });
    process.on("SIGTERM", () => { h.stop(); process.exit(0); });
    return null;
  }
  const port = cfg.tabPort === false ? null : (cfg.tabPort ?? TAB_PORT);
  const running = async (p, init) => (port ? fetch(`http://127.0.0.1:${port}${p}`, init).catch(() => null) : null);
  if (cmd === "code") {
    const r = await running("/state.json");
    const st = r?.ok ? await r.json().catch(() => null) : null;
    if (!st?.code) { console.log("The helper is not running on this computer (start it: run), so there is no code yet."); return 1; }
    console.log(`Type this code in the slicer's page to pair that browser: ${st.code}`);
    return 0;
  }
  if (cmd === "forget") {
    const r = await running("/forget", { method: "POST" });
    if (!r?.ok) write({ ...cfg, paired: [] });
    console.log("Every paired browser is forgotten; each pairs again with the code the helper shows.");
    return 0;
  }
  if (cmd === "install" || cmd === "uninstall") {
    const program = packaged ? [process.execPath, "run"] : [process.execPath, fileURLToPath(import.meta.url), "run"];
    try { console.log(await autostart(cmd === "install", program, { file: arg(args, "--file") })); return 0; }
    catch (err) { console.log(`Could not ${cmd}: ${err.message}`); return 1; }
  }
  console.log(USAGE);
  return 2;
}

/** The helper's own words when asked for nothing it knows. */
const USAGE = `Boolean3d printer helper ${VERSION}
  run        keep going: Bambu Studio, OrcaSlicer or PrusaSlicer in a browser on this network reach your printers through it
  code       the code a browser types once to pair with the running helper
  forget     every paired browser is forgotten
  install    start the helper with this computer (uninstall: no longer)
  printers   the printers heard on this network
  status     what the paired printer says now
  pair, prusa: see the top of helper.mjs`;

/** Runs the command line; `packaged`: the downloaded helper (no command = run). Resolves to an exit code, or null to keep going. */
export async function main(argv, { packaged = false, programPath = null } = {}) { return command(argv, packaged, programPath); }

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  // its own path: a copy unpacked into a folder named after a download secret pairs by it too (pairing.mjs 2b)
  main(process.argv.slice(2), { programPath: process.argv[1] }).then((code) => { if (code !== null) process.exit(code); });
}
