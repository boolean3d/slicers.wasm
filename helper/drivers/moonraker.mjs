// farm-helper/drivers/moonraker.mjs — the helper's driver for Klipper printers: Moonraker's own local HTTP API (the one
// Mainsail and Fluidd use; Moonraker docs, docs/web_api.md). Voron, RatRig, Sovol SV08, a rooted Creality K1 and any
// other printer that runs Klipper with Moonraker. Nothing here talks to any printer maker's servers.
// Node 18+ only, no packages. MIT licence (../bambu-home/LICENSE).
//
// What it reads: /server/info (it is Moonraker), /printer/info (Klipper's state, the computer's name),
// /printer/objects/query (print_stats, virtual_sdcard, heaters), /server/webcams/list (the camera's snapshot address).
// What it does: POST /server/files/upload (root gcodes, print true), /printer/print/cancel|pause|resume,
// /printer/gcode/script for the printers page's buttons (home, move, temperatures).
// The driver interface it fills is in ../DRIVERS.md.

const QUERY = "print_stats&display_status&virtual_sdcard&extruder&heater_bed&webhooks&temperature_sensor%20chamber&heater_generic%20chamber";
/** JPEG bytes a camera picture may have at most (the printers door's limit). */
const MOST_PICTURE = 290000;

const baseOf = (host, port) => (/^https?:\/\//.test(host) ? host.replace(/\/+$/, "") : `http://${host}${port && port !== 80 ? `:${port}` : ""}`);

/** Moonraker's answer to one call (its `result`), or an error in plain words. */
async function api(get, base, path, { method = "GET", body, apiKey = null, timeoutMs = 10000 } = {}) {
  const r = await get(base + path, { method, body, signal: AbortSignal.timeout(timeoutMs), headers: apiKey ? { "X-Api-Key": apiKey } : {} });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("Moonraker asks for an API key (Mainsail: Settings > Interface > API key)."), { code: "LOGIN" });
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ? String(j.error.message).slice(0, 200) : `Moonraker answered ${r.status} for ${path}.`), { status: r.status });
  return j?.result;
}

/** Klipper's state in the printers door's words (Moonraker's own: standby, printing, paused, complete, cancelled, error). */
export function reportOf(status, info = null) {
  const s = status ?? {};
  const ps = s.print_stats ?? {}, wh = s.webhooks ?? {};
  let state = ps.state || "standby";
  let message = ps.message || s.display_status?.message || null;
  if (["shutdown", "error"].includes(wh.state)) { state = "error"; message = String(wh.state_message || "Klipper shut down.").trim().split("\n")[0]; }
  let progress = s.virtual_sdcard?.progress;
  if (typeof progress !== "number") progress = s.display_status?.progress;
  const percent = typeof progress === "number" ? Math.round(100 * progress) : null;
  const took = Number(ps.print_duration) || 0;
  const secondsLeft = ["printing", "paused"].includes(state) && progress > 0.01 && took > 0 ? Math.round(took / progress - took) : null;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ext = s.extruder ?? {}, bed = s.heater_bed ?? {}, ch = s["temperature_sensor chamber"] ?? s["heater_generic chamber"] ?? {};
  const temps = Object.fromEntries(Object.entries({ nozzle: n(ext.temperature), nozzleTarget: n(ext.target), bed: n(bed.temperature), bedTarget: n(bed.target), chamber: n(ch.temperature) })
    .filter(([, v]) => v !== null));
  return { state, message: message ? String(message).slice(0, 200) : null, file: ps.filename || null, percent, secondsLeft, temps,
    ...(info?.hostname ? { name: info.hostname } : {}) };
}

/** The Klipper G-code for one of the printers page's buttons, or null. A move is relative and leaves the printer's own mode as it was. */
export function controlScript(c) {
  if (c?.do === "home") return "G28";
  if (c?.do === "jog" && ["X", "Y", "Z"].includes(c.axis) && Number.isFinite(c.mm)) {
    return `SAVE_GCODE_STATE NAME=b3d_move\nG91\nG1 ${c.axis}${Number(c.mm).toFixed(1)} F${c.axis === "Z" ? 900 : 3000}\nRESTORE_GCODE_STATE NAME=b3d_move`;
  }
  if (c?.do === "temp" && Number.isInteger(c.target)) return `${c.heater === "bed" ? "M140" : "M104"} S${c.target}`;
  return null;
}

export default {
  kind: "moonraker",
  name: "Klipper (Moonraker)",
  brands: ["Voron", "RatRig", "Sovol", "Creality (rooted K1/K2)", "any printer running Klipper with Moonraker"],
  ready: true,
  /** The ports a browser slicer's tunnel reaches on this printer: Moonraker itself, and the web page in front of it. */
  ports: [7125, 80],
  /** Klipper reads text G-code only. */
  formats: ["gcode"],
  /** What the person types once, beyond the address: only when the printer asks for an API key. */
  asks: [{ key: "apiKey", words: "API key (only if Moonraker asks for one)", secret: true, optional: true }],
  /** Where a slicer points its print host: Orca and Bambu Studio "Octo/Klipper", PrusaSlicer "OctoPrint". */
  slicerHost: (p) => `${p.host}${p.port && p.port !== 80 ? `:${p.port}` : ""}`,

  /** Who answers at host:port, if it is Moonraker. GET only, harmless. */
  async probe(host, port = 7125, { fetch: get = fetch, timeoutMs = 2500 } = {}) {
    const base = baseOf(host, port);
    let server;
    try { server = await api(get, base, "/server/info", { timeoutMs }); } catch (err) { if (err.code !== "LOGIN") return null; server = {}; }
    if (!server || (server.moonraker_version === undefined && server.klippy_state === undefined && !Array.isArray(server.components))) return null;
    const info = await api(get, base, "/printer/info", { timeoutMs }).catch(() => null);
    return { kind: "moonraker", id: `${host}:${port}`, host, port, name: info?.hostname || host, model: "Klipper",
      version: server.moonraker_version ?? null, needs: server.moonraker_version === undefined ? ["apiKey"] : [] };
  },

  /** A printer the person added: {host, port, apiKey?}. */
  open(p, { fetch: get = fetch } = {}) {
    const base = baseOf(p.host, p.port ?? 7125), apiKey = p.apiKey || null;
    const call = (path, o) => api(get, base, path, { apiKey, ...o });
    let webcam = null, webcamAt = 0;
    async function snapshotAddress() {
      if (Date.now() - webcamAt < 600000) return webcam;
      webcamAt = Date.now(); webcam = null;
      try {
        const cams = (await call("/server/webcams/list"))?.webcams ?? [];
        const c = cams.find((w) => w.enabled !== false && w.snapshot_url);
        // relative: to the printer's web page (Mainsail/Fluidd on port 80 of the same computer)
        if (c) webcam = c.snapshot_url.startsWith("/") ? `http://${p.host}${c.snapshot_url}` : c.snapshot_url;
      } catch { /* no camera list */ }
      return webcam;
    }
    async function picture() {
      const url = await snapshotAddress();
      if (!url) return null;
      try {
        const r = await get(url, { signal: AbortSignal.timeout(5000) });
        const b = Buffer.from(await r.arrayBuffer());
        return r.ok && b.length <= MOST_PICTURE && b[0] === 0xff && b[1] === 0xd8 ? b : null;
      } catch { return null; }
    }
    return {
      async report() {
        try {
          const st = (await call(`/printer/objects/query?${QUERY}`))?.status;
          return { ...reportOf(st), hasCamera: !!(await snapshotAddress()) };
        } catch (err) {
          if (err.code === "LOGIN") return { state: "offline", message: err.message, temps: {} };
          if (err.status) {
            // Klipper itself not ready (shut down, starting, a config error): Moonraker answers but cannot query.
            const info = await call("/printer/info").catch(() => null);
            return { state: ["error", "shutdown"].includes(info?.state) ? "error" : "unknown",
              message: String(info?.state_message || "Klipper is not ready.").trim().split("\n")[0].slice(0, 200), temps: {} };
          }
          return { state: "offline", message: `Moonraker does not answer at ${base} (${err.message}).`, temps: {} };
        }
      },
      async host() {
        const [i, s] = await Promise.all([call("/printer/info").catch(() => null), call("/server/info").catch(() => null)]);
        return { ...(i?.software_version ? { klipper: String(i.software_version).slice(0, 40) } : {}), ...(s?.moonraker_version ? { moonraker: String(s.moonraker_version).slice(0, 40) } : {}) };
      },
      /** Puts the file in Moonraker's gcodes folder and starts it. */
      async print({ file, bytes }) {
        const form = new FormData();
        form.append("root", "gcodes");
        form.append("print", "true");
        form.append("file", new Blob([bytes]), String(file).replace(/["/\\]/g, ""));
        const r = await call("/server/files/upload", { method: "POST", body: form, timeoutMs: 600000 });
        if (r?.print_started === false) throw new Error("The file is on the printer but it did not start (is it busy, or Klipper not ready?).");
      },
      cancel: () => call("/printer/print/cancel", { method: "POST" }),
      pause: () => call("/printer/print/pause", { method: "POST" }),
      resume: () => call("/printer/print/resume", { method: "POST" }),
      async control(c) {
        if (c?.do === "pause" || c?.do === "resume") return call(`/printer/print/${c.do}`, { method: "POST" });
        const script = controlScript(c);
        if (!script) return false;
        await call(`/printer/gcode/script?script=${encodeURIComponent(script)}`, { method: "POST", timeoutMs: 60000 });
        return true;
      },
      picture,
      close() {},
    };
  },
};
