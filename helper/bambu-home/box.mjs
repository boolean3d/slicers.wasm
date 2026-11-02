#!/usr/bin/env node
// farm-helper/bambu-home/box.mjs — the printer box: the Bambu home helper (helper.mjs) on a Raspberry Pi flashed with
// Boolean3d's image (brief pi-box), or on any computer at home that stays on. Nothing to type on it:
//   1. Plugged in, it hears the Bambu Lab printers on its network (their own announcements) and calls out to Boolean3d
//      with what it hears (models and names only).
//   2. Boolean3d gives it a pairing code. Its own little page shows the code (http://boolean3d.local on the Pi, or
//      http://<this computer>:<pagePort>), with a button that opens the account page with the code filled in; the
//      account page on the same network also says "New box found".
//   3. Paired, it keeps one line open to the box relay. Bambu Studio in a browser tab, opened from the account (any
//      network), reaches the printers through it: the relay hands the box each tab, and the box serves that tab the
//      way the helper serves a tab on its own network (tablink.mjs): printer list, access code, status, camera, files.
// It only calls out: no port to open on the router. The printers' addresses, serials and access codes stay here.
//
//   node box.mjs run [--file <path>]    the service runs this
//   node box.mjs status [--file <path>] the box's state, once
//
// The box file (~/.boolean3d-box.json, or --file): {secret, identity, server, anon, relay, site, pagePort, tabPort, name}.
// `secret` is made on the first start and never leaves this computer but as the key it calls with; `identity` is the
// helper's key pair (pairing.mjs), whose id the account keeps. Settings in
// /boot/firmware/boolean3d.txt (KEY=value lines: server, anon, relay, site) win over the box file: a test image is
// pointed at a test server there.
// MIT licence (LICENSE beside this file).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { startHelper, VERSION } from "./helper.mjs";
import { wsConnect } from "./ws.mjs";
import { tunnel } from "./tunnel.mjs";
import { makeIdentity } from "./pairing.mjs";

/** Where the box calls when nothing else is said: Boolean3d's printers door and site. */
export const SERVER = "https://auth.boolean3d.com/functions/v1/printers";
export const SITE = "https://boolean3d.com";
const BOOT_SETTINGS = ["/boot/firmware/boolean3d.txt", "/boot/boolean3d.txt"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** KEY=value lines (# comments), as the boot partition's settings file is written. */
export function readSettings(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z][\w-]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/** The printers the box found, of every kind (helper.printers()), as Boolean3d keeps them: model and name only. */
const heardList = (h) => h.printers().map((p) => ({ model: p.model || null, name: p.name || null }));
/** Bambu Lab's model codes, in the words on the printer. */
const MODELS = { "BL-P001": "X1 Carbon", "BL-P002": "X1", C13: "X1E", C11: "P1P", C12: "P1S", N1: "A1 mini", N2S: "A1", O1D: "H2D", O1S: "H2S", O1C: "H2C" };
export const modelName = (m) => MODELS[m] || (String(m || "").startsWith("O1") ? "H2" : m || "printer");

/**
 * The box, running. `cfg`: the box file's settings. Returns {state(), helper, page: Promise<port>, stop()}.
 * @param {{secret: string, server: string, anon?: string, relay?: string, site?: string, pagePort?: number|false,
 *   tabPort?: number|false, ssdpPort?: number, mqttPort?: number, ftpPort?: number, cameraInput?: string[]}} cfg
 */
export function startBox(cfg, { fetch: get = fetch, say = console.log, helper = null, discover = true } = {}) {
  const h = helper ?? startHelper({ tabPort: cfg.tabPort ?? false, ssdpPort: cfg.ssdpPort, mqttPort: cfg.mqttPort, ftpPort: cfg.ftpPort,
    cameraInput: cfg.cameraInput, fileHost: cfg.fileHost, identity: cfg.identity, paired: cfg.paired, origins: cfg.origins }, { discover, say });
  const state = { paired: false, code: null, name: null, server: null, relay: null, relayUp: false, error: null, tabs: 0 };
  let stopped = false, timer = null, line = null, lineTry = null;

  async function hello() {
    const answer = await get(`${cfg.server.replace(/\/+$/, "")}/box-hello`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-helper-key": cfg.secret, ...(cfg.anon ? { apikey: cfg.anon, Authorization: `Bearer ${cfg.anon}` } : {}) },
      // helper: who this helper is (pairing.mjs): the id a tab or a relay knows it by, and the key that proves it
      body: JSON.stringify({ version: VERSION, os: `${os.type()} ${os.arch()}`, printers: heardList(h), ...(cfg.computer ? { computer: cfg.computer } : {}),
        ...(h.pairing ? { helper: { id: h.pairing.helperId, publicKey: h.pairing.publicKey } } : {}) }),
    });
    const r = await answer.json().catch(() => ({ ok: false, error: `Boolean3d answered ${answer.status}.` }));
    if (!r.ok) throw Object.assign(new Error(r.error || "Boolean3d refused."), { code: r.code });
    return r;
  }

  // ── The relay line: one, kept open while paired; each "open" on it is a browser tab to serve ──
  async function relayUp() {
    if (line || lineTry || stopped || !state.paired || !state.relay) return;
    lineTry = (async () => {
      try {
        const l = await wsConnect(`${state.relay.replace(/\/+$/, "")}/box`, { headers: { "x-helper-key": cfg.secret } });
        line = l; state.relayUp = true;
        say(`box relay: line open (${state.relay})`);
        const ping = setInterval(() => l.ping(), 25000);
        l.onText = (t) => { let m; try { m = JSON.parse(t); } catch { return; } if (m.op === "open" && /^[\w-]{8,64}$/.test(m.s || "")) tabLine(m.s, typeof m.to === "string" ? m.to : null); };
        l.onClose = () => { clearInterval(ping); if (line === l) { line = null; state.relayUp = false; say("box relay: line closed"); } };
      } catch (err) {
        if (state.error !== err.message) say(`box relay: ${err.message}`);
        state.error = err.message;
      } finally { lineTry = null; }
    })();
  }
  async function tabLine(s, to) {
    try {
      const t = await wsConnect(`${state.relay.replace(/\/+$/, "")}/pipe?s=${encodeURIComponent(s)}`, { headers: { "x-helper-key": cfg.secret } });
      state.tabs++;
      const close = t.onClose;
      t.onClose = () => { state.tabs--; close(); };
      if (to) tunnel(t, to, { say }); else h.attachTab(t);   // to: a printer's own address here (house network only)
    } catch (err) { say(`box relay: a tab could not be served (${err.message})`); }
  }

  (async function keepGoing() {
    let down = null;
    while (!stopped) {
      let poll = 10000;
      try {
        const r = await hello();
        if (down) { say("Boolean3d answers again."); down = null; }
        poll = Math.max(2000, Math.min(60000, Number(r.poll) || poll));
        if (r.paired) {
          if (!state.paired) say(`paired: this box is ${r.name} in a Boolean3d account`);
          state.paired = true; state.code = null; state.name = r.name;
          const relay = cfg.relay || r.relay || null;   // the box file wins: a box on a LAN reaches a test relay another way
          if (relay !== state.relay) { state.relay = relay; line?.end(); }
          relayUp();
        } else {
          if (state.code !== r.code) say(`not paired yet: its code is ${r.code} (on its page, http://boolean3d.local)`);
          if (state.paired) line?.end();
          state.paired = false; state.code = r.code; state.name = null;
        }
        state.error = null;
      } catch (err) {
        if (err.message !== down) say(`Boolean3d: ${err.message}`);
        down = err.message; state.error = err.message; poll = 15000;
      }
      // Wait for the next call, or call at once when what it hears changes (a printer switched on, or gone).
      const told = JSON.stringify(heardList(h));
      await new Promise((r) => {
        const end = Date.now() + poll;
        const tick = () => (stopped || Date.now() >= end || JSON.stringify(heardList(h)) !== told ? r() : (timer = setTimeout(tick, 500)));
        timer = setTimeout(tick, Math.min(500, poll));
      });
    }
  })();

  const page = cfg.pagePort === false ? Promise.resolve(null) : servePage(cfg, state, h);
  return {
    state: () => ({ ...state, printers: heardList(h) }), helper: h, page: page.then((p) => p?.port ?? null),
    stop() { stopped = true; clearTimeout(timer); line?.end(); page.then((p) => p?.close()); if (!helper) h.stop(); },
  };
}

// ── The box's own page: its code and what it hears, in words (nothing to set here) ──
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function pageHtml(cfg, st) {
  const site = (cfg.site || SITE).replace(/\/+$/, "");
  const printers = st.printers.length
    ? `<ul>${st.printers.map((p) => `<li>${esc(p.name || "Printer")} <span class=m>${esc(modelName(p.model))}</span></li>`).join("")}</ul>`
    : `<p class=m>No printer found yet. Is the printer on, on this Wi-Fi? A Bambu Lab printer needs LAN-only mode and Developer Mode on.</p>`;
  const top = st.paired
    ? `<h1>Paired</h1><p>This box is <b>${esc(st.name)}</b> in your Boolean3d account. ${st.relayUp ? "Bambu Studio in your browser reaches these printers through it." : "Connecting…"}</p>
       <p><a class=b href="${esc(site)}/#/slicers">Open Bambu Studio</a></p>`
    : st.code
      ? `<h1>Pair this box</h1><p>Its code</p><p class=code data-code>${esc(st.code)}</p>
         <p><a class=b href="${esc(site)}/#/settings?box=${encodeURIComponent(st.code)}">Pair it with my account</a></p>
         <p class=m>Or type the code on your account page, under Printer box.</p>`
      : `<h1>Starting…</h1><p class=m>${esc(st.error || "Calling Boolean3d.")}</p>`;
  return `<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<meta http-equiv=refresh content=5><title>Boolean3d printer box</title>
<style>body{font:16px system-ui,sans-serif;background:#16181c;color:#e8e8e8;max-width:32rem;margin:2rem auto;padding:0 1rem}
h1{font-size:1.4rem}.code{font:700 2.2rem ui-monospace,monospace;letter-spacing:.1em}.m{color:#9aa0a6}
a.b{display:inline-block;background:#3b82f6;color:#fff;padding:.6rem 1rem;border-radius:.4rem;text-decoration:none}
ul{padding-left:1.2rem}h2{font-size:1.05rem;margin-top:2rem}</style>
<body>${top}<h2>Printers it hears</h2>${printers}</body></html>`;
}
function servePage(cfg, state, h) {
  const server = http.createServer((req, res) => {
    const st = { ...state, printers: heardList(h) };
    if (req.url === "/state.json") { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(st)); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(pageHtml(cfg, st));
  });
  return new Promise((resolve) => {
    server.on("error", (e) => { console.log(`the box's page could not open on port ${cfg.pagePort ?? 80}: ${e.message}`); resolve(null); });
    server.listen(cfg.pagePort ?? 80, "0.0.0.0", () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}

// ── The command line ───────────────────────────────────────────────
function arg(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }
export function boxSettings(file, { boot = BOOT_SETTINGS } = {}) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first start */ }
  if (!cfg.secret || !cfg.identity) {
    cfg.secret ||= randomBytes(30).toString("base64url");
    cfg.identity ||= makeIdentity();   // the helper's key pair (pairing.mjs): its id for the account and the relay
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  }
  for (const f of boot) {
    if (!fs.existsSync(f)) continue;
    const s = readSettings(fs.readFileSync(f, "utf8"));
    for (const k of ["server", "anon", "relay", "site"]) if (s[k]) cfg[k] = s[k];
    for (const k of ["pageport", "tabport", "ssdpport"]) if (s[k]) cfg[k.replace("port", "Port")] = s[k] === "false" ? false : Number(s[k]);
    break;
  }
  cfg.server ||= SERVER;
  return cfg;
}

async function main(argv) {
  const [cmd, ...args] = argv;
  const file = arg(args, "--file") || path.join(os.homedir(), ".boolean3d-box.json");
  if (cmd === "run") {
    const cfg = boxSettings(file);
    console.log(`Boolean3d printer box ${VERSION}, calling ${cfg.server}`);
    const b = startBox(cfg);
    b.page.then((p) => p && console.log(`its page: http://${os.hostname()}.local${p === 80 ? "" : `:${p}`}`));
    const end = () => { b.stop(); process.exit(0); };
    process.on("SIGINT", end); process.on("SIGTERM", end);
    return null;
  }
  if (cmd === "status") {
    const cfg = boxSettings(file);
    const r = await fetch(`http://127.0.0.1:${cfg.pagePort || 80}/state.json`).then((a) => a.json()).catch(() => null);
    console.log(r ? JSON.stringify(r, null, 2) : "The box is not running here.");
    return r ? 0 : 1;
  }
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 21).join("\n"));
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).then((code) => { if (code !== null) process.exit(code); });
}
