// farm-helper/drivers/template.mjs — copy this file to add a printer brand to the helper (../DRIVERS.md says how).
//
// It is a whole, working driver for a made-up printer, the "Example 1", that speaks a small JSON API on port 8125:
//   GET  /example/info            {"product": "Example 1", "name": "<its name>", "firmware": "1.0"}
//   GET  /example/status          {"state": "idle|printing|paused|done|stopped|error", "file", "progress" 0..1,
//                                  "seconds_left", "nozzle", "nozzle_target", "bed", "bed_target", "error"}
//   PUT  /example/files/<name>    the file's bytes; ?start=1 starts it
//   POST /example/stop | /example/pause | /example/resume
//   (header X-Example-Key: <the key on the printer's screen>)
// The test (helper/test/helper-drivers.test.cjs) runs it against a stand-in that answers exactly that. Replace the calls
// with your printer's own; keep the names and the shapes of what each function returns.
// MIT licence (../bambu-home/LICENSE).

/** Your printer's states, in the words every driver reports (Moonraker's): standby, printing, paused, complete, cancelled, error. */
const STATES = { idle: "standby", printing: "printing", paused: "paused", done: "complete", stopped: "cancelled", error: "error" };

export default {
  /** One short word, unique among the drivers: saved in the helper file with each printer. */
  kind: "example",
  /** What a person reads in the helper's screens and pages. */
  name: "Example printer",
  brands: ["Example 1"],
  /** false: listed as "needs an owner", never probed or opened. Set true once it works on a real printer. */
  ready: true,
  /** TCP ports a browser slicer may reach on this printer through the helper's tunnel (its own upload page or API). */
  ports: [8125],
  // The G-code it reads: "gcode" (text) and, if your printer takes Prusa's binary G-code, "bgcode". The helper names
  // the file to match and refuses a format not listed here before sending anything.
  formats: ["gcode"],
  /** What the person types once, beyond the printer's address. Kept on this computer only, never sent to Boolean3d. */
  asks: [{ key: "apiKey", words: "key (printer screen: Settings > Network)", secret: true }],
  /** The address a slicer's own "print host" setting takes for this printer, if it has one. */
  slicerHost: (p) => `${p.host}:${p.port ?? 8125}`,

  /**
   * Who answers at host:port, if it is your printer: {kind, id, host, port, name, model, needs}, else null.
   * Called for every address on the house network when the person asks for a search: harmless GETs only, quick
   * (honour timeoutMs), never throws. `id` stays the same for the same printer (a serial when it says one).
   * `needs`: the `asks` keys this printer still wants before it can be opened.
   */
  async probe(host, port = 8125, { fetch: get = fetch, timeoutMs = 2500 } = {}) {
    try {
      const r = await get(`http://${host}:${port}/example/info`, { signal: AbortSignal.timeout(timeoutMs) });
      const info = r.ok ? await r.json() : null;
      if (info?.product !== "Example 1") return null;
      return { kind: "example", id: `${host}:${port}`, host, port, name: info.name || host, model: info.product, needs: ["apiKey"] };
    } catch { return null; }
  },

  /**
   * A session with one printer the person added ({host, port, ...the asks}). Every function is async and throws an
   * Error in plain words when the printer refuses. `ctx.fetch` is the helper's fetch (tests pass their own).
   */
  open(p, { fetch: get = fetch } = {}) {
    const base = `http://${p.host}:${p.port ?? 8125}/example`;
    const call = async (method, path, body) => {
      const r = await get(base + path, { method, body, headers: { "X-Example-Key": p.apiKey || "" }, signal: AbortSignal.timeout(method === "PUT" ? 600000 : 10000) });
      if (r.status === 401) throw Object.assign(new Error("The printer refused the key (see its screen: Settings > Network)."), { code: "LOGIN" });
      if (!r.ok) throw new Error(`The printer answered ${r.status} for ${path}.`);
      return r.status === 204 ? null : r.json().catch(() => null);
    };
    return {
      /** What it is doing: {state, message, file, percent, secondsLeft, temps: {nozzle, nozzleTarget, bed, bedTarget}}. Never throws: unreachable is state "offline". */
      async report() {
        try {
          const s = await call("GET", "/status");
          const state = STATES[s.state] ?? "unknown";
          return {
            state, message: s.error ? String(s.error).slice(0, 200) : null, file: s.file || null,
            percent: typeof s.progress === "number" ? Math.round(s.progress * 100) : null,
            secondsLeft: state === "printing" || state === "paused" ? (s.seconds_left ?? null) : null,
            temps: Object.fromEntries(Object.entries({ nozzle: s.nozzle, nozzleTarget: s.nozzle_target, bed: s.bed, bedTarget: s.bed_target })
              .filter(([, v]) => typeof v === "number")),
          };
        } catch (err) { return { state: "offline", message: err.code === "LOGIN" ? err.message : `The printer does not answer at ${p.host} (${err.message}).`, temps: {} }; }
      },
      /** Firmware and other versions, for the account's printer page. */
      async host() { const i = await call("GET", "/info").catch(() => null); return i?.firmware ? { firmware: String(i.firmware).slice(0, 40) } : {}; },
      /** Sends the sliced file and starts it. */
      async print({ file, bytes }) { await call("PUT", `/files/${encodeURIComponent(file)}?start=1`, bytes); },
      cancel: () => call("POST", "/stop"),
      pause: () => call("POST", "/pause"),
      resume: () => call("POST", "/resume"),
      /** One of the printers page's buttons ({do: "pause"|"resume"|"home"|"jog"|"temp"|"light", ...}); false when it has no such call. */
      async control(c) {
        if (c?.do === "pause" || c?.do === "resume") { await call("POST", `/${c.do}`); return true; }
        return false;
      },
      /** One camera picture (JPEG bytes) or null. Leave it out, or return null, when the printer has no camera. */
      picture: async () => null,
      close() {},
    };
  },
};
