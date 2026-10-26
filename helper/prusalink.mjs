// farm-helper/prusalink.mjs — the helper's Prusa module: a Prusa printer (MK4, CORE One, XL, MINI, MK3.9) with
// PrusaLink on, on the house network. PrusaLink is Prusa's own local, open HTTP API (published by Prusa: Prusa-Link-Web
// spec/openapi.yaml); login is the user and password on the printer's screen (Settings > Network > PrusaLink: user
// "maker"), by HTTP digest, or an API key on older firmware. Nothing here talks to Prusa Account or Prusa Connect.
// Written from Prusa's published API facts; no Prusa code. Node 18+ only, no packages. MIT licence (bambu-home/LICENSE).
//
// PrusaSlicer in a browser tab reaches the printer itself, through the helper's shared connection tunnel (the tab's
// own HTTP calls, unchanged); this module is what the helper itself reads: the printer's state for `status`.
//
//   const p = prusaLink({ host: "192.168.1.40", password: "…" });
//   await p.version()  await p.status()  await p.storage()  await p.upload("/usb/benchy.bgcode", bytes)
//   reportOf(await p.status()) -> the printer in the printers door's words

import { createHash, randomBytes } from "node:crypto";

const md5 = (s) => createHash("md5").update(s).digest("hex");

/** The digest login answer for one request (RFC 7616 with MD5, as PrusaLink asks), from its 401's WWW-Authenticate. */
export function digestAnswer(challenge, { user, password, method, uri, nc = 1 }) {
  const c = {};
  for (const m of String(challenge).replace(/^Digest\s+/i, "").matchAll(/([a-z0-9_-]+)=(?:"([^"]*)"|([^,\s]*))/gi)) c[m[1].toLowerCase()] = m[2] ?? m[3];
  const ha1 = md5(`${user}:${c.realm}:${password}`), ha2 = md5(`${method}:${uri}`);
  const qop = (c.qop || "").split(",").map((s) => s.trim()).includes("auth") ? "auth" : null;
  const cnonce = randomBytes(8).toString("hex"), ncs = String(nc).padStart(8, "0");
  const response = qop ? md5(`${ha1}:${c.nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${c.nonce}:${ha2}`);
  return `Digest username="${user}", realm="${c.realm}", nonce="${c.nonce}", uri="${uri}", algorithm=MD5, response="${response}"`
    + (qop ? `, qop=${qop}, nc=${ncs}, cnonce="${cnonce}"` : "") + (c.opaque ? `, opaque="${c.opaque}"` : "");
}

/** A PrusaLink printer at `host` (an address, with :port when not 80). */
export function prusaLink({ host, user = "maker", password = "", apiKey = null, fetch: get = fetch, timeoutMs = 10000 }) {
  const base = /^https?:\/\//.test(host) ? host.replace(/\/+$/, "") : `http://${host}`;
  let challenge = null;   // the last digest challenge: asked once, answered on every call after

  async function call(method, path, { body, headers = {} } = {}) {
    const uri = path.split("/").map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join("/");
    const once = (auth) => get(base + uri, {
      method, body, signal: AbortSignal.timeout(timeoutMs),
      headers: { ...headers, ...(apiKey ? { "X-Api-Key": apiKey } : {}), ...(auth ? { Authorization: auth } : {}) },
    });
    let r = await once(challenge && !apiKey ? digestAnswer(challenge, { user, password, method, uri }) : null);
    if (r.status === 401 && !apiKey && r.headers.get("www-authenticate")) {
      challenge = r.headers.get("www-authenticate");
      r = await once(digestAnswer(challenge, { user, password, method, uri }));
    }
    if (r.status === 401) throw Object.assign(new Error("The printer refused the login (check the PrusaLink user and password on its screen)."), { code: "LOGIN" });
    return r;
  }
  const json = async (path) => {
    const r = await call("GET", path);
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`The printer answered ${r.status} for ${path}.`);
    return r.json();
  };

  return {
    version: () => json("/api/version"),
    info: () => json("/api/v1/info"),
    status: () => json("/api/v1/status"),
    storage: async () => (await json("/api/v1/storage"))?.storage_list ?? [],
    /** Puts a file on the printer's storage ("/usb/<name>"). Never starts it: Print-After-Upload stays off. */
    async upload(path, bytes) {
      const r = await call("PUT", `/api/v1/files${path}`, { body: bytes, headers: { "Content-Type": "application/octet-stream", Overwrite: "?1", "Print-After-Upload": "?0" } });
      if (r.status !== 201 && r.status !== 204) throw new Error(`The printer did not take the file (${r.status}).`);
    },
  };
}

/** PrusaLink's printer state in the printers door's words (Moonraker's: standby, printing, paused, complete, cancelled, error). */
export function reportOf(status) {
  const p = status?.printer ?? {};
  const state = { IDLE: "standby", READY: "standby", BUSY: "printing", PRINTING: "printing", PAUSED: "paused", FINISHED: "complete",
    STOPPED: "cancelled", ERROR: "error", ATTENTION: "paused" }[p.state] ?? "unknown";
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const j = status?.job;
  return {
    state,
    message: p.state === "ATTENTION" ? "The printer needs you: see its screen." : p.state === "ERROR" ? "The printer reports an error: see its screen." : null,
    percent: j ? n(j.progress) : null,
    secondsLeft: j && (state === "printing" || state === "paused") ? n(j.time_remaining) : null,
    temps: Object.fromEntries(Object.entries({ nozzle: n(p.temp_nozzle), nozzleTarget: n(p.target_nozzle), bed: n(p.temp_bed), bedTarget: n(p.target_bed) })
      .filter(([, v]) => v !== null)),
  };
}
