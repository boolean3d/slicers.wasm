// scripts/farm/helper/standin-prusalink.mjs
//
// A stand-in Prusa printer for tests (brief prusa-send): no real printer is touched. It answers what a Prusa MK4 /
// CORE One answers on the house network with PrusaLink on: the HTTP API Prusa publishes (Prusa-Link-Web
// spec/openapi.yaml: /api/version, /api/v1/info, /api/v1/status, /api/v1/storage, /api/v1/files/<storage>/<path>
// GET/HEAD/PUT/DELETE/POST, /api/v1/job, /api/v1/job/{id} DELETE + pause/resume). Written from those published facts; no Prusa code. Login as on the printer's
// screen: HTTP digest (user "maker", the printer's password) or, as older firmware, the X-Api-Key header.
// The files it is sent stay in memory (and in `dir` when given). A PUT with Print-After-Upload ?1 runs a pretend
// print, PRINTING -> FINISHED in `printMs`, so a test sees the status move; it never touches anything real.
//
//   const p = await prusaStandIn({ password: 'abcd1234' });
//   p.port, p.files (path -> bytes), p.uploads (each PUT: {path, bytes, print}), p.requests (method + path), await p.stop()
//   node scripts/farm/helper/standin-prusalink.mjs [PORT=8090] [HOST=0.0.0.0] [PASSWORD=standin1] [MODEL=MK4] [DIR=<folder>] [PRINT_S=20]

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

const md5 = (s) => createHash("md5").update(s).digest("hex");
const REALM = "Printer API";

/** The printer kinds a stand-in can be, by the names PrusaLink's /api/version and /api/v1/info give. */
const MODELS = {
  MK4: { hostname: "prusa-mk4", firmware: "6.2.0+8834", nozzle: 0.4 },
  MK4S: { hostname: "prusa-mk4s", firmware: "6.2.0+8834", nozzle: 0.4 },
  COREONE: { hostname: "prusa-core-one", firmware: "6.2.0+8834", nozzle: 0.4 },
};

/** The digest fields of an Authorization header, or null. */
function digestOf(h) {
  if (!h || !/^Digest\s/i.test(h)) return null;
  const out = {};
  for (const m of h.slice(7).matchAll(/([a-z0-9_-]+)=(?:"([^"]*)"|([^,\s]*))/gi)) out[m[1].toLowerCase()] = m[2] ?? m[3];
  return out;
}

export async function prusaStandIn({ port = 0, host = "127.0.0.1", user = "maker", password = "standin1", apiKey = null,
  model = "MK4", name = `Stand-in ${model}`, printMs = 20000, dir = null, freeSpace = 7_500_000_000, say = () => {} } = {}) {
  const kind = MODELS[model] ?? MODELS.MK4;
  const files = new Map();      // "/usb/<path>" -> Buffer
  const uploads = [], requests = [];
  const nonces = new Set();
  let job = null;               // {id, path, started, ms}
  let jobId = 0;

  const authorised = (req) => {
    if (apiKey && req.headers["x-api-key"] === apiKey) return true;
    const d = digestOf(req.headers.authorization);
    if (!d || d.username !== user || !nonces.has(d.nonce)) return false;
    const ha1 = md5(`${user}:${REALM}:${password}`), ha2 = md5(`${req.method}:${d.uri}`);
    const want = d.qop ? md5(`${ha1}:${d.nonce}:${d.nc}:${d.cnonce}:${d.qop}:${ha2}`) : md5(`${ha1}:${d.nonce}:${ha2}`);
    return d.response === want;
  };

  const state = () => {
    if (job && !job.stopped && !job.pausedAt && Date.now() - job.started >= job.ms) job.done = true;
    return !job ? "IDLE" : job.stopped ? "STOPPED" : job.done ? "FINISHED" : job.pausedAt ? "PAUSED" : "PRINTING";
  };
  const temps = () => {
    const printing = state() === "PRINTING";
    return { temp_nozzle: printing ? 214.8 : 24.1, target_nozzle: printing ? 215 : 0, temp_bed: printing ? 59.6 : 23.8, target_bed: printing ? 60 : 0 };
  };
  const used = () => [...files.values()].reduce((n, b) => n + b.length, 0);
  const storage = () => ({ name: "usb", path: "/usb", type: "USB", read_only: false, available: true,
    free_space: freeSpace - used(), total_space: freeSpace, print_files: used(), system_files: 0 });
  const jobOf = () => {
    if (!job) return null;
    const ms = Math.min((job.pausedAt || job.stoppedAt || Date.now()) - job.started, job.ms);
    return { id: job.id, progress: Math.round((ms / job.ms) * 1000) / 10, time_printing: Math.round(ms / 1000), time_remaining: Math.round((job.ms - ms) / 1000) };
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = decodeURIComponent(url.pathname);
    requests.push(`${req.method} ${p}`);
    const send = (status, body, headers = {}) => {
      const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(status, { ...(body !== undefined && typeof body !== "string" ? { "Content-Type": "application/json" } : {}), ...headers, "Content-Length": Buffer.byteLength(text) });
      res.end(req.method === "HEAD" ? undefined : text);
    };
    if (!authorised(req)) {
      // The body of a refused upload is not read: curl sends it again with the login.
      const nonce = randomBytes(16).toString("hex");
      nonces.add(nonce);
      res.setHeader("Connection", "close");
      return send(401, { title: "Unauthorized", text: "Login with the printer's user and password." },
        { "WWW-Authenticate": `Digest realm="${REALM}", qop="auth", nonce="${nonce}", algorithm=MD5` });
    }

    if (req.method === "GET" && p === "/api/version") return send(200, {
      api: "2.0.0", server: "2.1.2", nozzle_diameter: kind.nozzle, text: "PrusaLink", hostname: kind.hostname,
      capabilities: { "upload-by-put": true },
    });
    if (req.method === "GET" && p === "/api/v1/info") return send(200, {
      name, location: "", farm_mode: false, nozzle_diameter: kind.nozzle, min_extrusion_temp: 170, serial: `STANDIN${model}0001`,
      sd_ready: false, active_camera: false, hostname: kind.hostname, port: "", network_error_chime: false, mmu: false,
    });
    if (req.method === "GET" && p === "/api/v1/status") {
      const s = state(), j = jobOf();
      return send(200, {
        printer: { state: s, ...temps(), axis_z: s === "PRINTING" ? 4.2 : 0, flow: 100, speed: 100, fan_hotend: s === "PRINTING" ? 4800 : 0, fan_print: s === "PRINTING" ? 3200 : 0 },
        storage: { path: "/usb/", name: "usb", read_only: false },
        ...(j ? { job: j } : {}),
      });
    }
    if (req.method === "GET" && p === "/api/v1/storage") return send(200, { storage_list: [storage()] });
    if (req.method === "GET" && p === "/api/v1/job") {
      if (!job) return send(204);
      return send(200, { ...jobOf(), state: state(), file: { name: path.basename(job.path), display_name: path.basename(job.path), path: path.dirname(job.path) } });
    }

    // A job's own calls: DELETE stops it, PUT .../pause and .../resume (PrusaLink's /api/v1/job/{id}).
    const jm = /^\/api\/v1\/job\/(\d+)(?:\/(pause|resume))?$/.exec(p);
    if (jm) {
      if (!job || job.id !== Number(jm[1])) return send(404, { title: "Not Found", text: "No such job." });
      const s = state();
      if (req.method === "DELETE" && !jm[2]) {
        if (s !== "PRINTING" && s !== "PAUSED") return send(409, { title: "Conflict", text: "Not printing." });
        job.stopped = true; job.stoppedAt = job.pausedAt || Date.now(); say(`job ${job.id} stopped`); return send(204);
      }
      if (req.method === "PUT" && jm[2] === "pause" && s === "PRINTING") { job.pausedAt = Date.now(); return send(204); }
      if (req.method === "PUT" && jm[2] === "resume" && s === "PAUSED") { job.started += Date.now() - job.pausedAt; job.pausedAt = null; return send(204); }
      return send(409, { title: "Conflict", text: `The job is ${s.toLowerCase()}.` });
    }

    const f = /^\/api\/v1\/files(\/usb|\/local)(\/.*)?$/.exec(p);
    if (f) {
      const key = `/usb${f[2] || "/"}`;
      if (req.method === "GET" || req.method === "HEAD") {
        if (!f[2] || f[2] === "/") {
          return send(200, { type: "FOLDER", name: "usb", ro: false, children: [...files.entries()].map(([k, b]) => ({ type: "PRINT_FILE", name: path.basename(k), display_name: path.basename(k), size: b.length })) });
        }
        const b = files.get(key);
        if (!b) return send(404, { title: "Not Found", text: "No such file." });
        return send(200, { type: "PRINT_FILE", name: path.basename(key), display_name: path.basename(key), ro: false, size: b.length, refs: {} });
      }
      if (req.method === "DELETE") { if (!files.delete(key)) return send(404); return send(204); }
      if (req.method === "PUT") {
        if (!f[2] || f[2].endsWith("/")) return send(400, { title: "Bad Request", text: "No file name." });
        const overwrite = req.headers.overwrite === "?1";
        if (files.has(key) && !overwrite) return send(409, { title: "Conflict", text: "File already exists." });
        const parts = [];
        req.on("data", (c) => parts.push(c));
        req.on("end", () => {
          const bytes = Buffer.concat(parts);
          const want = Number(req.headers["content-length"]);
          if (Number.isFinite(want) && want !== bytes.length) return send(400, { title: "Bad Request", text: "The file did not arrive whole." });
          files.set(key, bytes);
          if (dir) { const out = path.join(dir, key); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, bytes); }
          const print = req.headers["print-after-upload"] === "?1";
          uploads.push({ path: key, bytes: bytes.length, print, at: Date.now() });
          say(`got ${key}: ${bytes.length} bytes${print ? ", print after upload" : ""}`);
          if (print && state() !== "PRINTING") job = { id: ++jobId, path: key, started: Date.now(), ms: printMs };
          send(201);
        });
        return;
      }
      if (req.method === "POST") {
        if (!files.has(key)) return send(404);
        if (state() === "PRINTING" || state() === "PAUSED") return send(409, { title: "Conflict", text: "The printer is busy." });
        job = { id: ++jobId, path: key, started: Date.now(), ms: printMs };
        return send(204);
      }
    }
    send(404, { title: "Not Found", text: "Not found." });
  });
  await new Promise((r) => server.listen(port, host, r));
  return {
    port: server.address().port, files, uploads, requests, state,
    stop: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = Object.fromEntries(process.argv.slice(2).map((x) => x.split("=")));
  const p = await prusaStandIn({ port: Number(a.PORT) || 8090, host: a.HOST || "0.0.0.0", password: a.PASSWORD || "standin1",
    apiKey: a.APIKEY || null, model: a.MODEL || "MK4", dir: a.DIR || null, printMs: (Number(a.PRINT_S) || 20) * 1000, say: console.log });
  console.log(`Stand-in Prusa ${a.MODEL || "MK4"} (PrusaLink) on port ${p.port}: user maker, password ${a.PASSWORD || "standin1"}`);
  process.on("SIGTERM", () => p.stop().then(() => process.exit(0)));
  process.on("SIGINT", () => p.stop().then(() => process.exit(0)));
}
