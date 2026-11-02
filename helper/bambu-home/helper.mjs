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
//   node helper.mjs pair <CODE> --kind moonraker|prusalink|... --host <address> --server <address> [--password ..]
//                                any other printer kind into the account, by its address (the printers page's line)
//   node helper.mjs printers     the printers found on this network, of every kind (drivers/, DRIVERS.md)
//   node helper.mjs add <address> [--kind moonraker|prusalink] [--password <password>] [--user <user>] [--key <API key>]
//                                a printer by its address, kept on this computer (a Prusa printer: address, user and
//                                password on its screen, Settings > Network > PrusaLink); status then shows it too.
//                                `prusa <address> ...` is the same for a PrusaLink printer
//
// The helper file: ~/.boolean3d-bambu.json (or --file <path>); "tabPort": false there turns the tab link off;
// "origins": ["https://..."] adds pages it answers; its identity and the paired browsers live there too.
// MIT licence (LICENSE beside this file).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listenForPrinters, mqttLink } from "../bambu.mjs";
import { createHash } from "node:crypto";
import { cameraHub, fileShelf, linkPool, platePicture } from "./lan.mjs";
import { startTabLink } from "./tablink.mjs";
import { pairing as pairingOf, secretIn } from "./pairing.mjs";
import { autostart } from "./autostart.mjs";
import { DRIVERS, addressOf, driverOf, lookAt, printFileFor, sweep } from "../drivers/index.mjs";
import { reportOf } from "../drivers/bambu.mjs";

export { reportOf };
export const VERSION = "11";
/** Where Bambu Studio in a browser tab finds the helper (ws://<this computer>:8770). */
export const TAB_PORT = 8770;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Camera frames a second (a slower link drops frames, it does not queue them). */
const FRAME_FPS = 3;

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
  let stopped = false;

  // The printers it keeps in an account, each with its own helper key (the printers door's home_helpers row): the one
  // the helper file names at its top (helper.mjs pair), and those the printer helper app connected (`printers`).
  // Each is one driver's session (../drivers): a Bambu printer by its serial, any other kind by its address.
  const accounts = new Map();   // account id (a Bambu serial, or "<kind>:<host>:<port>") -> account link
  const shared = { cfg, get, say, loop, pool, shelf, cameras, heard, hasFfmpeg, drivers: cfg.drivers ?? DRIVERS, stopped: () => stopped };
  /** The helper file's printers list with one printer's facts changed (an address heard, its model). */
  const patched = (serial, patch) => (Array.isArray(cfg.printers) ? cfg.printers : []).map((p) => (String(p.serial).toUpperCase() === serial ? Object.assign(p, patch) : p));
  const top = cfg.key && cfg.server && complete(cfg) ? { ...cfg } : null;
  for (const p of [...(top ? [top] : []), ...(Array.isArray(cfg.printers) ? cfg.printers : [])]) {
    const id = accountId(p);
    if (!id || !p.key || !complete(p) || accounts.has(id)) continue;
    accounts.set(id, accountLink({ server: cfg.server, anon: cfg.anon, ...p, ...(p.serial ? { serial: id } : {}) }, shared,
      p === top ? (patch) => save(patch) : (patch) => save({ printers: patched(id, patch) })));
  }

  // The other printers on this network (Klipper, PrusaLink, ...: every driver but Bambu's, whose printers are `heard`):
  // the helper's own computer at start (a Klipper printer's Pi), the network when the person asks for a search, and the
  // ones the person added (`added` in the helper file: address and login, kept on this computer only).
  const found = new Map();      // "<kind>:<host>:<port>" -> {kind, id, host, port, name, model, needs, added, at}
  const drivers = cfg.drivers ?? DRIVERS;
  const added = addedOf(cfg);
  const onFound = (f) => {
    const id = `${f.kind}:${f.host}:${f.port ?? ""}`;
    const was = found.get(id);
    found.set(id, { ...was, ...f, at: Date.now() });
    if (!was) say(`found a ${driverOf(f.kind, drivers).name} printer "${f.name || f.host}" at ${f.host}${f.port ? `:${f.port}` : ""}`);
  };
  for (const a of added) found.set(`${a.kind}:${a.host}:${a.port ?? ""}`, { kind: a.kind, id: `${a.host}:${a.port ?? ""}`, host: a.host, port: a.port ?? null, name: a.name || a.host, model: null, needs: [], added: true });
  /** Every printer found, of every kind, as the pages and the tabs list them. */
  const printersFound = () => [
    ...[...heard.values()].map((p) => ({ kind: "bambu", name: p.name || p.serial, model: p.model || null, host: p.ip, port: null, serial: p.serial })),
    ...[...found.values()].map((p) => ({ kind: p.kind, name: p.name || p.host, model: p.model || null, host: p.host, port: p.port ?? null, added: !!p.added,
      needs: p.needs ?? [], slicerHost: driverOf(p.kind, drivers).slicerHost?.(p) ?? null })),
  ];

  // Who may talk to it (pairing.mjs): the helper file keeps its identity and the paired browsers. `pairing` false: open (tests).
  // `downloadSecret`: the one the downloaded program's own name carries (app.mjs), so the browser that downloaded it pairs by itself.
  const pair = cfg.pairing === false ? null : pairingOf(cfg, { save, say, secret: cfg.downloadSecret ?? null });
  const page = (req) => helperPage(req, { pairing: pair, printers: printersFound, name: cfg.name, forget: () => { pair?.forget(); say("every paired browser forgotten, as asked"); } });
  // tabPort false: no tab link on this network (a tab's line can still come through the box relay, attachTab).
  const tab = startTabLink({ port: cfg.tabPort === false ? false : (cfg.tabPort ?? TAB_PORT), host: cfg.tabHost, pool, shelf, cameras, heard,
    pairing: pair, name: cfg.name, version: VERSION, page, search: (o) => searchNow(o), mqttPort: cfg.mqttPort, ftpPort: cfg.ftpPort, cameraInput: cfg.cameraInput ?? null, say,
    printers: () => printersFound().filter((p) => p.kind !== "bambu"),
    onPrinted: (p) => accounts.get(String(p.devId || "").toUpperCase())?.keep(p) });
  tab.port.then((p) => {
    if (!p) return;
    say(`Slicers in a browser on this network (Bambu Studio, OrcaSlicer, PrusaSlicer) reach it at ws://<this computer>:${p}`);
    if (pair?.bySecret) say("The browser you downloaded this helper with links to it by itself: go back to the slicer's page.");
    if (pair) say(`${pair.bySecret ? "Another browser" : "To pair a browser"}, type this code in its page: ${pair.showCode}   (also at http://localhost:${p}/ on this computer)`);
  }, () => {});

  // The Bambu printers on this network, from their announcements (an address can change when the router restarts), and
  // from the helper's own search (the Bambu driver's search): a firewall with no rule for the helper drops the announcements.
  const onHeard = (f) => {
    const was = heard.get(f.serial), known = Object.fromEntries(Object.entries(f).filter(([, v]) => v != null));
    heard.set(f.serial, { ...was, ...known, at: Date.now() });
    if (!was || was.ip !== f.ip) say(`heard ${f.serial} (${f.model ?? was?.model ?? "model not said"}, "${f.name ?? was?.name ?? f.serial}") at ${f.ip}`);
    tab?.heardPrinter(f.serial);
    accounts.get(f.serial)?.heard(f);
  };
  const bambu = drivers.find((d) => d.kind === "bambu" && d.ready);
  const stopListen = discover && bambu ? bambu.listen(onHeard, { port: cfg.ssdpPort ?? 2021 }) : () => {};
  // By itself: an SSDP search soon after start, then each minute while no printer is known, else every ten minutes.
  // A tab's "Search my network" or typed address (tablink op search), or the app's "Search again", knocks too:
  // {knock: true, hosts?}: then every other driver looks at those addresses as well (drivers/index.mjs sweep).
  function searchNow(o = {}) {
    const hosts = o.hosts ?? cfg.searchHosts ?? null;
    const asks = [bambu ? bambu.search(onHeard, { port: cfg.mqttPort ?? 8883, ssdpPort: cfg.ssdpPort ?? 2021, hosts, stopped: () => stopped, ...o }).catch(() => 0) : 0];
    if (o.knock) asks.push(sweep(onFound, { hosts: hosts ?? undefined, drivers, fetch: get, stopped: () => stopped }).catch(() => 0));
    return Promise.all(asks).then((n) => n.reduce((a, b) => a + b, 0));
  }
  // The helper's own computer, once at start: Klipper's Moonraker or a printer's own page on this very computer.
  if (discover && cfg.search !== false) sweep(onFound, { hosts: ["127.0.0.1"], drivers, fetch: get, stopped: () => stopped }).catch(() => {});
  let searchTimer = null;
  const search = () => {
    if (stopped) return;
    searchNow().then(() => { if (!stopped) { searchTimer = setTimeout(search, heard.size ? 600000 : 60000); searchTimer.unref?.(); } });
  };
  if (discover && cfg.search !== false) { searchTimer = setTimeout(search, 1500); searchTimer.unref?.(); }

  if (loop && !accounts.size) say(`Boolean3d helper ${VERSION} running for your printers on this network (not linked to an account).`);
  const first = () => accounts.values().next().value ?? null;

  return {
    /** The first account printer's one call (the helper file's own printer, tests). */
    sync: () => first()?.sync() ?? Promise.resolve(null), get link() { return first()?.link ?? null; },
    heard, found, tabPort: tab?.port ?? Promise.resolve(null), webPort: shelf.port, pairing: pair, pool,
    /** Every printer found on this network, of every kind: {kind, name, model, host, port, serial?, slicerHost?, needs, added}. */
    printers: printersFound,
    /** What each account printer is doing now: {serial, id, name, model, linked, report, error}. */
    accounts: () => [...accounts.values()].map((a) => a.facts()),
    /** A printer the app connected and the account took (box-printer): kept in the account from now on. */
    addAccount(p, saveOne = () => {}) {
      const s = accountId(p);
      accounts.get(s)?.stop();
      const a = accountLink({ server: cfg.server, anon: cfg.anon, ...p, ...(p.serial ? { serial: s } : {}) }, shared, saveOne);
      accounts.set(s, a);
      if (heard.get(s)) a.heard(heard.get(s));
      return a;
    },
    dropAccount(id) { const s = accounts.has(id) ? id : String(id || "").toUpperCase(); accounts.get(s)?.stop(); accounts.delete(s); },
    /** Search now (the app's "Search again"): an SSDP ask; `knock`: the printer ports across the network too. */
    search: (o) => searchNow(o),
    /** A browser tab's line from elsewhere (the printer box's relay, box.mjs), served like a tab on this network. */
    attachTab: (line, opts) => tab?.attach(line, opts),
    stop() { stopped = true; clearTimeout(searchTimer); stopListen(); for (const a of accounts.values()) a.stop(); cameras.close(); tab?.close(); pool.close(); shelf.close(); },
  };
}

/** Which account printer a saved printer is: a Bambu printer's serial, any other kind's "<kind>:<host>:<port>". */
function accountId(p) {
  const kind = p.kind || "bambu";
  if (kind === "bambu") return String(p.serial || "").toUpperCase() || null;
  return p.host ? `${kind}:${p.host}:${p.port ?? ""}` : null;
}
/** Whether a saved printer has what its driver needs to be opened: a Bambu printer its serial and access code, the rest an address. */
function complete(p) { return (p.kind || "bambu") === "bambu" ? !!(p.serial && p.code) : !!p.host; }
/**
 * The printers the person added by address (`added` in the helper file: {kind, host, port, user?, password?, apiKey?, name?}).
 * A helper file from before drivers kept Prusa printers as `prusa: [{host, user, password, apiKey}]`: read as added PrusaLink printers.
 */
export function addedOf(cfg) {
  const out = Array.isArray(cfg.added) ? [...cfg.added] : [];
  for (const p of Array.isArray(cfg.prusa) ? cfg.prusa : []) {
    const a = addressOf(p.host);
    if (a && !out.some((x) => x.kind === "prusalink" && x.host === a.host)) out.push({ kind: "prusalink", ...p, host: a.host, port: a.port ?? 80 });
  }
  return out;
}

/**
 * One printer kept in a Boolean3d account: a call to the printers door every few seconds with what the printer says
 * (helper-sync), the prints sent to it from the account, its camera while someone looks, the printers page's buttons,
 * and each print a tab started on it kept in the account. The printer itself is its driver's session (../drivers,
 * DRIVERS.md): this side knows only the door. `p`: {server, anon, key, kind?, serial?, code?, host?, port?, ...the
 * driver's own facts}. `saveOne(patch)`: a fact to keep in the helper file (the printer's address heard, its model).
 */
function accountLink(p, { cfg, get, say, loop, pool, shelf, cameras, heard, hasFfmpeg, drivers, stopped: helperStopped }, saveOne) {
  const driver = driverOf(p.kind, drivers);
  const session = driver.open(p, { cfg, fetch: get, pool, shelf, cameras, heard, hasFfmpeg, say, saveOne });
  const label = p.serial || `${p.host}${p.port ? `:${p.port}` : ""}`;
  const events = [];
  let stopped = false, timer = null, poll = 5000, syncError = null;
  let cam = null;               // {stop, last, sending, until}
  let last = null;              // the last report sent
  const done = () => stopped || helperStopped();

  /** One print sent from the account: fetch the file, then the driver hands it to the printer. */
  async function start(s) {
    try {
      const answer = await get(s.url);
      if (!answer.ok) throw new Error(`The print file could not be fetched (${answer.status}).`);
      const bytes = new Uint8Array(await answer.arrayBuffer());
      if (s.bytes && bytes.length !== s.bytes) throw new Error(`Only ${bytes.length} of ${s.bytes} bytes of the print file arrived.`);
      const file = printFileFor(driver, s.file, bytes);
      await session.print({ file, bytes, slots: Array.isArray(s.slots) ? s.slots : [], job: s.job ?? {} });
      say(`started ${file}`);
      events.push({ print: s.print, ok: true, ...(file !== s.file ? { file } : {}) });
    } catch (err) {
      say(`could not start ${s.file}: ${err.message}`);
      events.push({ print: s.print, ok: false, error: String(err.message).slice(0, 300) });
    }
  }

  // ── A print a tab started on this printer goes into the account, one at a time, in the order they came ──
  let keeping = Promise.resolve();
  function keep(t) {
    keeping = keeping.then(() => keepOne(t)).catch((err) => say(`could not keep ${t.name} in the account: ${err.message}`));
  }
  async function keepOne(t) {
    const bytes = t.bytes;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    for (let tries = 1; ; tries++) {
      try {
        const k = await call("helper-keep", { sha256, bytes: bytes.length });
        if (k.upload) {
          const put = await get(k.upload, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
          if (!put.ok && put.status !== 409 && put.status !== 400) throw new Error(`the upload answered ${put.status}`);
        }
        const picture = platePicture(bytes, t.plate);
        await call("helper-kept", {
          sha256, bytes: bytes.length, name: t.name, file: t.file, slots: t.amsMapping, picture: picture ? picture.toString("base64") : null,
          job: { plate: Number(t.plate) || 1, amsMapping2: t.amsMapping2, options: t.options },
        });
        say(`kept ${t.name} in the account`);
        return;
      } catch (err) {
        if (tries >= 3 || ["full", "too_big", "unpaired", "bad_request"].includes(err.code)) throw err;
        await wait(10000 * tries);
      }
    }
  }

  // ── The camera, while someone looks in the account: frames as fast as the door takes them, the newest one only.
  //    A driver with a stream (session.camera) pushes them; one with only a still (session.picture) is asked `fps` times a second ──
  function camera(want) {
    if (!want) { if (cam && Date.now() > cam.until) { cam.stop(); cam = null; } return; }
    if (cam) { cam.until = Date.now() + 25000; return; }
    const c = { last: null, sending: false, until: Date.now() + 25000, stop: () => {} };
    const send = async () => {
      if (c.sending || !c.last || cam !== c) return;
      const frame = c.last; c.last = null; c.sending = true;
      try {
        const r = await call("helper-frame", { picture: Buffer.from(frame).toString("base64") });
        if (r.camera === false) { c.stop(); if (cam === c) cam = null; }
      } catch (err) { if (err.code === "rate_limited") await wait(2000); } finally { c.sending = false; }
      send();
    };
    const onPicture = (f) => { if (f && f.length <= 290000) { c.last = f; send(); } };
    const onEnd = () => { if (cam === c) cam = null; };
    const stream = session.camera?.(onPicture, onEnd) ?? null;
    if (stream) c.stop = stream;
    else if (session.picture) {
      let on = true, t = null;
      const tick = async () => {
        if (!on || cam !== c) return;
        const f = await session.picture().catch(() => null);
        if (f) onPicture(f);
        if (on) { t = setTimeout(tick, 1000 / (cfg.fps ?? FRAME_FPS)); t.unref?.(); }
      };
      c.stop = () => { on = false; clearTimeout(t); };
      cam = c; tick();
      return;
    } else return;
    cam = c;
  }

  async function call(where, body) {
    const answer = await get(`${p.server.replace(/\/+$/, "")}/${where}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-helper-key": p.key, ...(p.anon ? { apikey: p.anon, Authorization: `Bearer ${p.anon}` } : {}) },
      body: JSON.stringify(body),
    });
    const r = await answer.json().catch(() => ({ ok: false, error: `Boolean3d answered ${answer.status}.` }));
    if (!r.ok) throw Object.assign(new Error(r.error || "Boolean3d refused."), { code: r.code });
    return r;
  }

  let hostSent = false;
  async function sync() {
    const report = await session.report();
    last = report;
    const body = { version: VERSION, printer: report, events: events.splice(0) };
    if (!hostSent) {
      const h = await session.host?.().catch(() => null);
      if (h && Object.keys(h).length) body.host = { ...h, os: `${os.type()} ${os.arch()}` };
    }
    let r;
    try { r = await call("helper-sync", body); } catch (err) { events.unshift(...body.events); throw err; }
    if (body.host) hostSent = true;
    poll = Math.max(1000, Math.min(60000, Number(r.poll) || poll));
    camera(!!r.camera);
    for (const id of r.cancel || []) {
      try { await session.cancel(); say(`stopped the print, as asked (${id})`); } catch (err) { say(`could not stop the print (${id}): ${err.message}`); }
    }
    // The printers page's buttons (home, move, temperatures, lamp, pause, resume), as the driver's printer takes them.
    for (const c of r.controls || []) {
      try {
        if (c.do === "pause" && session.pause) await session.pause();
        else if (c.do === "resume" && session.resume) await session.resume();
        else await session.control(c);
        say(`did ${c.do}${c.axis ? ` ${c.axis}${c.mm}` : ""}${c.heater ? ` ${c.heater} ${c.target}` : ""}${c.do === "light" ? ` ${c.on ? "on" : "off"}` : ""}, as asked`);
      } catch (err) { say(`a control from the account was dropped: ${err.message}`); }
    }
    for (const s of r.send || []) await start(s);
    return r;
  }

  if (loop) (async function keepGoing() {
    say(`Boolean3d helper ${VERSION} running for ${p.name || "your printer"} (${driver.name}, ${label}).`);
    let down = null;
    while (!done()) {
      try { await sync(); syncError = null; if (down) { say("Boolean3d answers again."); down = null; } } catch (err) {
        syncError = { code: err.code ?? null, message: err.message };
        if (err.code === "unpaired") { say(err.message); break; }
        if (err.message !== down) say(`Boolean3d: ${err.message}`);
        down = err.message; poll = 15000;
      }
      await new Promise((r) => { timer = setTimeout(r, poll); });
    }
  })();

  return {
    sync, keep, get link() { return session.link ?? null; },
    /** The printer was heard on the network (Bambu: its address and model; an address can change when the router restarts). */
    heard(f) { session.heard?.(f); },
    facts: () => ({ kind: driver.kind, serial: p.serial ?? null, host: p.host ?? null, port: p.port ?? null, id: p.id ?? null, name: p.name || null,
      model: p.model || null, printerModel: session.model ?? null, linked: session.linked ?? last?.state !== "offline", report: last, error: syncError }),
    stop() { stopped = true; clearTimeout(timer); cam?.stop(); cam = null; session.close?.(); },
  };
}

// ── The helper's own page, http://localhost:8770/ on this computer only (tablink.mjs serves it to loopback): the code
//    to type, the printers heard, the paired browsers; /state.json the same as data; POST /forget unpairs every browser ──
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function helperPage(req, { pairing, printers: all = () => [], name = null, forget = () => {} }) {
  const url = new URL(req.url || "/", "http://x");
  const printers = all().map((p) => ({ kind: p.kind, name: p.name, model: p.model || "", ip: p.host, port: p.port ?? null, needs: p.needs ?? [] }));
  const state = { name: name || os.hostname(), version: VERSION, id: pairing?.helperId ?? null, code: pairing?.showCode ?? null,
    paired: pairing?.paired.length ?? 0, printers };
  if (url.pathname === "/state.json") return { type: "application/json", body: JSON.stringify(state) };
  if (url.pathname === "/forget" && req.method === "POST") { forget(); return { type: "text/plain", body: "forgotten\n" }; }
  if (url.pathname !== "/") return null;
  const list = printers.length
    ? `<ul>${printers.map((p) => `<li>${esc(p.name)} <span class=m>${esc(p.model)} at ${esc(p.ip)}${p.port ? `:${esc(p.port)}` : ""}${p.needs.length ? ` (needs its ${esc(p.needs.join(", "))}: helper add)` : ""}</span></li>`).join("")}</ul>`
    : `<p class=m>No printer found yet. Is it on, on this network? A Bambu Lab printer needs LAN-only mode and Developer Mode on; any other printer can be added by its address (helper add).</p>`;
  return { type: "text/html; charset=utf-8", body: `<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<meta http-equiv=refresh content=5><title>Boolean3d printer helper</title>
<style>body{font:16px system-ui,sans-serif;background:#16181c;color:#e8e8e8;max-width:32rem;margin:2rem auto;padding:0 1rem}
h1{font-size:1.4rem}.code{font:700 2.4rem ui-monospace,monospace;letter-spacing:.12em}.m{color:#9aa0a6}h2{font-size:1.05rem;margin-top:2rem}ul{padding-left:1.2rem}</style>
<body><h1>Boolean3d printer helper</h1>
${state.code ? `<p>In the slicer's page, under Device, type this code once to pair this browser:</p><p class=code>${esc(state.code)}</p>` : ""}
<p class=m>Running on ${esc(state.name)}, version ${esc(state.version)}. ${state.paired} browser${state.paired === 1 ? "" : "s"} paired.</p>
<h2>Printers it found</h2>${list}
<p class=m>This page is shown only on this computer. The helper answers Boolean3d's own pages, and only browsers paired with the code.</p>
</body></html>` };
}

function hasProgram(name) {
  // Windows finds a program by its name plus one of PATHEXT's endings (ffmpeg -> ffmpeg.exe).
  const ends = process.platform === "win32" ? ["", ...(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)] : [""];
  return (process.env.PATH || process.env.Path || "").split(path.delimiter).some((d) => d && ends.some((e) => fs.existsSync(path.join(d, name + e))));
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

  /** Asks the account for a helper key with the code the Print panel or the printers page shows (helper-pair). */
  const pairWith = async (code, server, anon, host) => {
    const answer = await fetch(`${server.replace(/\/+$/, "")}/helper-pair`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}) },
      body: JSON.stringify({ code, version: VERSION, host: { ...host, os: `${os.type()} ${os.arch()}` } }),
    });
    const r = await answer.json().catch(() => ({ ok: false, error: `Boolean3d answered ${answer.status}.` }));
    if (!r.ok) console.log(r.error);
    return r.ok ? r : null;
  };
  const loginOf = (kind) => ({ ...(arg(args, "--user") ? { user: arg(args, "--user") } : kind === "prusalink" ? { user: "maker" } : {}),
    ...(arg(args, "--password") ? { password: arg(args, "--password") } : {}), ...(arg(args, "--key") ? { apiKey: arg(args, "--key") } : {}) });

  if (cmd === "pair" && (arg(args, "--kind") || "bambu") !== "bambu") {
    // Any other kind: the printer by its address (helper add's words), then the account's key for it.
    const code = args[0] && !args[0].startsWith("--") ? args[0] : null;
    const kind = arg(args, "--kind") === "klipper" ? "moonraker" : arg(args, "--kind") === "prusa" ? "prusalink" : arg(args, "--kind");
    const server = arg(args, "--server") || cfg.server, a = addressOf(arg(args, "--host") || "");
    if (!code || !server || !a) { console.log("pair <CODE> --kind <kind> --host <address> --server <address>: the install line the printers page shows has them all."); return 2; }
    let d;
    try { d = driverOf(kind); } catch (err) { console.log(err.message); return 2; }
    const p = { kind, host: a.host, port: a.port ?? d.ports[0] ?? null, ...loginOf(kind) };
    const s = d.open(p, {});
    const report = await s.report().catch((err) => ({ state: "offline", message: err.message }));
    if (report.state === "offline") { console.log(report.message || `The printer does not answer at ${a.host}.`); return 1; }
    const anon = arg(args, "--anon") || cfg.anon;
    const r = await pairWith(code, server, anon, await s.host?.().catch(() => ({})) ?? {});
    if (!r) return 1;
    const kept = { ...p, key: r.key, name: r.name, model: r.model };
    write({ ...cfg, server, anon, printers: [...(cfg.printers ?? []).filter((x) => !(x.kind === kind && x.host === p.host && (x.port ?? null) === p.port)), kept] });
    console.log(`Paired: the ${d.name} printer at ${p.host}${p.port ? `:${p.port}` : ""} is ${r.name} in your Boolean3d account.`);
    return 0;
  }
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
    const r = await pairWith(code, server, anon, { firmware });
    if (!r) return 1;
    write({ ...cfg, server, anon, key: r.key, name: r.name, model: r.model, serial, code: access, ...(arg(args, "--ip") ? { ip } : {}), printerModel });
    console.log(`Paired: this printer is ${r.name} in your Boolean3d account.`);
    return 0;
  }
  if (cmd === "add" || cmd === "prusa") {
    // A printer by its address, kept on this computer only (`added`); `prusa` is the old word for a PrusaLink one.
    const text = args[0] && !args[0].startsWith("--") ? args[0] : null;
    const want = cmd === "prusa" ? "prusalink" : ({ klipper: "moonraker", prusa: "prusalink" }[arg(args, "--kind")] ?? arg(args, "--kind") ?? null);
    if (!text) { console.log("add <address> [--kind moonraker|prusalink|...] [--password <password>] [--user <user>] [--key <API key>]"); return 2; }
    const f = await lookAt(text, { kind: want });
    if (!f) { console.log(`No printer the helper knows answers at ${text}${want ? ` as ${want}` : ""}. Is it on, on this network?`); return 1; }
    const p = { kind: f.kind, host: f.host, port: f.port ?? null, name: f.name, ...loginOf(f.kind) };
    const report = await driverOf(f.kind).open(p, {}).report().catch((err) => ({ state: "offline", message: err.message }));
    if (report.state === "offline") { console.log(report.message || `The printer at ${text} answers but gives no state.`); return 1; }
    const added = addedOf(cfg).filter((x) => !(x.kind === p.kind && x.host === p.host && (x.port ?? null) === p.port));
    const { prusa, ...rest } = cfg;
    write({ ...rest, added: [...added, p] });
    console.log(`Saved: the ${driverOf(f.kind).name} printer "${f.name}" at ${f.host}${f.port ? `:${f.port}` : ""} (${report.state}).`);
    return 0;
  }
  if (cmd === "status") {
    // What every printer kept on this computer says now: the added ones, those in the account, the helper file's own.
    const all = [...addedOf(cfg), ...(cfg.printers ?? []).filter((p) => p.kind && p.kind !== "bambu")];
    for (const p of all) {
      try { console.log(JSON.stringify({ printer: `${p.kind} ${p.host}${p.port ? `:${p.port}` : ""}`, ...(await driverOf(p.kind).open(p, {}).report()) }, null, 2)); }
      catch (err) { console.log(`${p.host}: ${err.message}`); }
    }
    if (!cfg.serial) return all.length ? 0 : 1;
    let ip = cfg.ip || (await findPrinter(cfg.serial, 15000))?.ip;
    if (!ip) { console.log("The printer was not heard on this network."); return 1; }
    const link = mqttLink({ host: ip, serial: cfg.serial, code: cfg.code });
    await link.connect(); link.pushall(); await wait(4000); link.close();
    console.log(JSON.stringify(reportOf(link.report, { model: cfg.printerModel, camera: true }), null, 2));
    return 0;
  }
  if (cmd === "printers") {
    // Every kind: Bambu printers announce themselves; the others are looked for on this computer's networks.
    const seen = new Set();
    const line = (f) => console.log(`${f.kind.padEnd(10)} ${String(f.model || "").padEnd(10)} ${f.host}${f.port ? `:${f.port}` : ""}  ${f.name || ""}`);
    const stop = listenForPrinters((f) => { if (!seen.has(f.serial)) { seen.add(f.serial); line({ kind: "bambu", model: f.model, host: f.ip, name: `${f.name} (${f.serial})` }); } });
    await Promise.all([sweep((f) => { seen.add(`${f.kind}:${f.host}`); line(f); }, { hosts: arg(args, "--hosts")?.split(",") }).catch(() => 0), wait(12000)]);
    stop();
    if (!seen.size) console.log("No printer found on this network in 12 s. Is it on? A Bambu Lab printer needs LAN-only mode; any other can be added by its address (add).");
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
  printers   the printers found on this network, of every kind (--hosts a,b: only those addresses)
  status     what each printer kept on this computer says now
  add <address> [--kind moonraker|prusalink] [--password ..] [--key ..]   a printer by its address
  pair       see the top of helper.mjs`;

/** Runs the command line; `packaged`: the downloaded helper (no command = run). Resolves to an exit code, or null to keep going. */
export async function main(argv, { packaged = false, programPath = null } = {}) { return command(argv, packaged, programPath); }

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  // its own path: a copy unpacked into a folder named after a download secret pairs by it too (pairing.mjs 2b)
  main(process.argv.slice(2), { programPath: process.argv[1] }).then((code) => { if (code !== null) process.exit(code); });
}
