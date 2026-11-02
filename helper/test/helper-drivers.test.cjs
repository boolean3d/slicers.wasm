// The helper's printer drivers (farm-helper/drivers, DRIVERS.md): every driver keeps the one interface; the copy-me
// template, Moonraker and PrusaLink each find, print, report progress and cancel against a stand-in printer; and a
// brand added as one file (the template) goes through the helper core into an account with no other change.
'use strict';
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const at = (f) => import(pathToFileURL(path.resolve(__dirname, "../..", f)).href);
let DRIVERS, driverOf, lookAt, sweep, printFileFor, template, prusaStandIn, startHelper;
before(async () => {
  ({ DRIVERS, driverOf, lookAt, sweep, printFileFor } = await at("helper/drivers/index.mjs"));
  template = (await at("helper/drivers/template.mjs")).default;
  ({ prusaStandIn } = await at("helper/test/standin-prusalink.mjs"));
  ({ startHelper } = await at("helper/bambu-home/helper.mjs"));
});

const servers = [];
after(() => { for (const s of servers) s.close?.(); });
const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); servers.push(s); s.listen(0, "127.0.0.1", () => resolve(s)); });
const bodyOf = (req) => new Promise((resolve) => { const parts = []; req.on("data", (c) => parts.push(c)); req.on("end", () => resolve(Buffer.concat(parts))); });
async function until(what, check, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) { const v = await check(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 50)); }
}

/** The template's made-up "Example 1" printer, exactly as template.mjs's top says. */
async function exampleStandIn({ key = "K1" } = {}) {
  const m = { state: "idle", file: null, progress: 0, uploads: [], stops: 0 };
  const json = (res, v, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
  m.server = await listen(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/example/info") return json(res, { product: "Example 1", name: "Shed printer", firmware: "1.0" });
    if (req.headers["x-example-key"] !== key) return json(res, { error: "key" }, 401);
    if (u.pathname === "/example/status") return json(res, { state: m.state, file: m.file, progress: m.progress, seconds_left: 600, nozzle: 210, nozzle_target: 210, bed: 60, bed_target: 60 });
    if (req.method === "PUT" && u.pathname.startsWith("/example/files/")) {
      const name = decodeURIComponent(u.pathname.slice("/example/files/".length)), bytes = await bodyOf(req);
      m.uploads.push({ name, bytes: bytes.toString() });
      if (u.searchParams.get("start") === "1") { m.state = "printing"; m.file = name; m.progress = 0.1; }
      res.writeHead(204); return res.end();
    }
    if (req.method === "POST" && u.pathname === "/example/stop") { m.stops++; m.state = "stopped"; res.writeHead(204); return res.end(); }
    if (req.method === "POST" && u.pathname === "/example/pause") { m.state = "paused"; res.writeHead(204); return res.end(); }
    if (req.method === "POST" && u.pathname === "/example/resume") { m.state = "printing"; res.writeHead(204); return res.end(); }
    json(res, { error: "no such call" }, 404);
  });
  m.port = m.server.address().port;
  return m;
}

/** Moonraker as the driver uses it. */
async function moonStandIn() {
  const m = { state: "standby", file: "", progress: 0, uploads: [], cancels: 0 };
  const send = (res, result, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(status < 300 ? { result } : { error: { message: result } })); };
  m.server = await listen(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/server/info") return send(res, { moonraker_version: "v0.9-test", klippy_state: "ready" });
    if (u.pathname === "/printer/info") return send(res, { state: "ready", software_version: "v0.12-test", hostname: "voron" });
    if (u.pathname === "/server/webcams/list") return send(res, { webcams: [] });
    if (u.pathname === "/printer/objects/query") {
      return send(res, { status: { print_stats: { state: m.state, filename: m.file, print_duration: 60 }, virtual_sdcard: { progress: m.progress },
        webhooks: { state: "ready" }, extruder: { temperature: 214.8, target: 215 }, heater_bed: { temperature: 60.1, target: 60 } } });
    }
    if (u.pathname === "/server/files/upload" && req.method === "POST") {
      const raw = (await bodyOf(req)).toString("latin1");
      const name = raw.match(/name="file"; filename="([^"]+)"/)?.[1], print = /name="print"\r\n\r\ntrue/.test(raw);
      m.uploads.push({ name, print });
      if (print) { m.state = "printing"; m.file = name; m.progress = 0.1; }
      return send(res, { item: { path: name }, print_started: print });
    }
    if (u.pathname === "/printer/print/cancel" && req.method === "POST") { m.cancels++; m.state = "cancelled"; return send(res, "ok"); }
    send(res, "no such call", 404);
  });
  m.port = m.server.address().port;
  return m;
}

test("every driver keeps the one interface; stubs are listed, never ready, and say they need an owner", () => {
  const kinds = new Set();
  for (const d of [...DRIVERS, template]) {
    assert.equal(typeof d.kind, "string"); assert.ok(!kinds.has(d.kind), `kind ${d.kind} twice`); kinds.add(d.kind);
    assert.equal(typeof d.name, "string"); assert.equal(typeof d.ready, "boolean");
    assert.ok(Array.isArray(d.ports) && Array.isArray(d.asks) && Array.isArray(d.brands), d.kind);
    assert.equal(typeof d.probe, "function"); assert.equal(typeof d.open, "function");
  }
  for (const k of ["bambu", "moonraker", "prusalink"]) assert.equal(driverOf(k).ready, true, k);
  for (const k of ["elegoo", "anycubic", "creality"]) {
    const d = driverOf(k);
    assert.equal(d.ready, false); assert.equal(d.needsOwner, true);
    assert.throws(() => d.open({ host: "x" }), /needs an owner/);
  }
  assert.equal(driverOf(undefined).kind, "bambu", "a printer saved before drivers is a Bambu printer");
  assert.throws(() => driverOf("nope"), (e) => e.code === "NO_DRIVER");
  assert.ok(!DRIVERS.includes(template), "the template is a file to copy, not a driver the helper uses");
});

for (const [label, make, kind, extra] of [
  ["template (Example 1)", () => exampleStandIn(), "example", { apiKey: "K1" }],
  ["Moonraker (Klipper)", () => moonStandIn(), "moonraker", {}],
]) {
  test(`${label}: found at its address, prints, shows progress, cancels`, async () => {
    const m = await make();
    const drivers = [...DRIVERS, template];
    const f = await lookAt(`127.0.0.1:${m.port}`, { drivers });
    assert.equal(f?.kind, kind);
    let swept = [];
    await sweep((x) => swept.push(x), { hosts: ["127.0.0.1"], drivers: drivers.map((d) => (d.kind === kind ? { ...d, ports: [m.port] } : { ...d, ports: [] })) });
    assert.deepEqual(swept.map((x) => x.kind), [kind]);
    const s = driverOf(kind, drivers).open({ kind, host: "127.0.0.1", port: m.port, ...extra });
    assert.equal((await s.report()).state, "standby");
    await s.print({ file: "bin.gcode", bytes: new TextEncoder().encode("G28\n") });
    assert.equal(m.uploads.length, 1);
    const r = await s.report();
    assert.equal(r.state, "printing"); assert.equal(r.percent, 10); assert.equal(r.temps.nozzle > 200, true);
    await s.cancel();
    assert.equal((await s.report()).state, "cancelled");
    if (kind === "example") {
      const bad = driverOf(kind, drivers).open({ kind, host: "127.0.0.1", port: m.port, apiKey: "wrong" });
      assert.match((await bad.report()).message, /refused the key/);
    }
  });
}

test("PrusaLink: found (asks for its password), prints, shows progress, pauses, cancels", async () => {
  const p = await prusaStandIn({ password: "pw123456", printMs: 60000 });
  try {
    const f = await lookAt(`127.0.0.1:${p.port}`, { kind: "prusalink" });
    assert.equal(f?.kind, "prusalink"); assert.deepEqual(f.needs, ["password"]);
    const s = driverOf("prusalink").open({ kind: "prusalink", host: "127.0.0.1", port: p.port, user: "maker", password: "pw123456" });
    assert.equal((await s.report()).state, "standby");
    await s.print({ file: "bin.bgcode", bytes: new Uint8Array([1, 2, 3]) });
    const r = await until("printing", async () => ((await s.report()).state === "printing" ? s.report() : null));
    assert.equal(typeof r.percent, "number");
    await s.pause();
    assert.equal((await s.report()).state, "paused");
    await s.cancel();
    assert.notEqual((await s.report()).state, "printing");
  } finally { await p.stop(); }
});

// 11-02 walk: PrusaSlicer slices an MK4 to binary G-code; the account names every G-code print ".gcode", so the MK4 got
// binary bytes in a ".gcode" file (a real one reads that as text and fails). The bytes decide the name; a printer that
// cannot read binary G-code (Klipper) is refused in words before anything is sent.
test("binary G-code from PrusaSlicer reaches a PrusaLink printer as .bgcode; a Klipper printer refuses it in words", async () => {
  const BIN = new Uint8Array([0x47, 0x43, 0x44, 0x45, 1, 0, 0, 0]);   // "GCDE", version 1
  assert.equal(printFileFor(driverOf("prusalink"), "Box 8e8466.gcode", BIN), "Box 8e8466.bgcode");
  assert.equal(printFileFor(driverOf("prusalink"), "Box 8e8466.gcode", new TextEncoder().encode("G28\n")), "Box 8e8466.gcode");
  assert.equal(printFileFor(driverOf("bambu"), "Box 8e8466.gcode.3mf", BIN), "Box 8e8466.gcode.3mf");
  assert.throws(() => printFileFor(driverOf("moonraker"), "Box 8e8466.gcode", BIN), /cannot read binary G-code.*Supports binary G-code/);

  const p = await prusaStandIn({ password: "pw123456", printMs: 60000 });
  const door = { syncs: [], sends: 0 };
  const site = await listen(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/files/box.gcode") { res.writeHead(200); return res.end(Buffer.from(BIN)); }
    const body = JSON.parse((await bodyOf(req)).toString() || "{}");
    const answer = (v) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, poll: 1000, ...v })); };
    if (u.pathname === "/printers/helper-sync") {
      door.syncs.push(body);
      if (!door.sends++) return answer({ send: [{ print: "p1", file: "Box 8e8466.gcode", url: `${siteAt}/files/box.gcode` }] });
    }
    answer({});
  });
  const siteAt = `http://127.0.0.1:${site.address().port}`;
  const h = startHelper({ server: `${siteAt}/printers`, tabPort: false, search: false, pairing: false,
    printers: [{ kind: "prusalink", host: "127.0.0.1", port: p.port, key: "HK", user: "maker", password: "pw123456", name: "Workshop MK4" }] },
  { discover: false, say: () => {} });
  try {
    await until("started from the account", () => door.syncs.some((s) => s.events.some((e) => e.print === "p1")));
    const ev = door.syncs.flatMap((s) => s.events).find((e) => e.print === "p1");
    assert.equal(ev.ok, true, ev.error);
    assert.deepEqual(p.uploads.map((x) => x.path), ["/usb/Box 8e8466.bgcode"]);
    assert.equal(ev.file, "Box 8e8466.bgcode", "the helper tells the account the name the printer will show");
  } finally { h.stop(); await p.stop(); }
});

test("a brand added as one driver file goes into an account through the helper core, unchanged", async () => {
  const m = await exampleStandIn();
  const door = { syncs: [], sends: 0, cancel: false };
  const site = await listen(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/files/bin.gcode") { res.writeHead(200); return res.end("G28\n"); }
    const body = JSON.parse((await bodyOf(req)).toString() || "{}");
    const answer = (v) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, poll: 1000, ...v })); };
    if (u.pathname === "/printers/helper-sync") {
      assert.equal(req.headers["x-helper-key"], "HK");
      door.syncs.push(body);
      if (!door.sends++) return answer({ send: [{ print: "p1", file: "bin.gcode", url: `${siteAt}/files/bin.gcode` }] });
      if (door.cancel) { door.cancel = false; return answer({ cancel: ["p1"] }); }
      return answer({});
    }
    answer({});
  });
  const siteAt = `http://127.0.0.1:${site.address().port}`;
  const h = startHelper({ server: `${siteAt}/printers`, tabPort: false, search: false, pairing: false,
    drivers: [...DRIVERS, template], printers: [{ kind: "example", host: "127.0.0.1", port: m.port, key: "HK", apiKey: "K1", name: "Shed" }] },
  { discover: false, say: () => {} });
  // `key` is the account's helper key, `apiKey` the printer's own login (the template's ask): both kept in the helper file
  try {
    await until("started from the account", () => door.syncs.some((s) => s.events.some((e) => e.print === "p1")));
    const ev = door.syncs.flatMap((s) => s.events).find((e) => e.print === "p1");
    assert.equal(ev.ok, true, ev.error);
    assert.deepEqual(m.uploads, [{ name: "bin.gcode", bytes: "G28\n" }]);
    await until("printing shown in the account", () => door.syncs.at(-1)?.printer.state === "printing");
    assert.equal(door.syncs.at(-1).printer.percent, 10);
    door.cancel = true;
    await until("the printer told to stop", () => m.stops === 1);
    await until("cancelled shown in the account", () => door.syncs.at(-1)?.printer.state === "cancelled");
    assert.equal(h.accounts()[0].kind, "example");
  } finally { h.stop(); }
});
