// farm-helper/drivers/prusalink.mjs — the helper's driver for Prusa printers with PrusaLink on (MK4, MK4S, CORE One, XL,
// MINI, MK3.9): Prusa's own local, open HTTP API (Prusa-Link-Web spec/openapi.yaml). The wire calls are in
// ../prusalink.mjs; this file fills the driver interface (../DRIVERS.md) with them. Nothing here talks to Prusa Account
// or Prusa Connect. Node 18+ only, no packages. MIT licence (../bambu-home/LICENSE).

import { prusaLink, reportOf } from "../prusalink.mjs";

const hostPort = (host, port) => `${host}${port && port !== 80 ? `:${port}` : ""}`;

export default {
  kind: "prusalink",
  name: "Prusa (PrusaLink)",
  brands: ["Prusa MK4 / MK4S", "Prusa CORE One", "Prusa XL", "Prusa MINI", "Prusa MK3.9"],
  ready: true,
  ports: [80],
  /** Text G-code and Prusa's binary G-code (MK4, XL, MINI, CORE One read both). */
  formats: ["gcode", "bgcode"],
  /** What the person types once: the password on the printer's screen (Settings > Network > PrusaLink; user "maker"). */
  asks: [{ key: "password", words: "PrusaLink password (printer screen: Settings > Network > PrusaLink)", secret: true }],
  /** PrusaSlicer's physical printer: host type PrusaLink, this address, HTTP digest with user maker and that password. */
  slicerHost: (p) => hostPort(p.host, p.port),

  /** Who answers at host:port, if it is PrusaLink. One GET; with no login PrusaLink answers 401 with its digest realm. */
  async probe(host, port = 80, { fetch: get = fetch, timeoutMs = 2500 } = {}) {
    let r;
    try { r = await get(`http://${hostPort(host, port)}/api/version`, { signal: AbortSignal.timeout(timeoutMs) }); } catch { return null; }
    const realm = /realm="([^"]*)"/i.exec(r.headers.get("www-authenticate") || "")?.[1] ?? "";
    if (r.status === 401 && realm === "Printer API") return { kind: "prusalink", id: `${host}:${port}`, host, port, name: host, model: "Prusa", needs: ["password"] };
    if (!r.ok) return null;
    const v = await r.json().catch(() => null);
    if (!String(v?.text ?? "").startsWith("PrusaLink")) return null;
    return { kind: "prusalink", id: `${host}:${port}`, host, port, name: v.hostname || host, model: "Prusa", needs: [] };
  },

  /** A printer the person added: {host, port?, user?, password | apiKey}. */
  open(p, { fetch: get = fetch } = {}) {
    const link = prusaLink({ host: hostPort(p.host, p.port), user: p.user || "maker", password: p.password || "", apiKey: p.apiKey || null, fetch: get });
    let storage = null;
    const where = async () => {
      if (storage) return storage;
      const list = await link.storage().catch(() => []);
      storage = (list.find((s) => s.available !== false && !s.read_only) ?? { path: "/usb" }).path.replace(/\/+$/, "");
      return storage;
    };
    const jobId = async () => {
      const j = await link.job();
      if (!j?.id) throw new Error("The printer is not printing.");
      return j.id;
    };
    return {
      async report() {
        try {
          const [st, j] = await Promise.all([link.status(), link.job().catch(() => null)]);
          return { ...reportOf(st), file: j?.file?.display_name || j?.file?.name || null, hasCamera: false };
        } catch (err) {
          return { state: "offline", message: err.code === "LOGIN" ? err.message : `The printer does not answer at ${p.host} (${err.message}).`, temps: {} };
        }
      },
      async host() { const v = await link.version().catch(() => null); return v?.server ? { prusalink: String(v.server).slice(0, 40) } : {}; },
      /** Puts the file on the printer's storage (USB) and starts it (Print-After-Upload). */
      async print({ file, bytes }) {
        await link.upload(`${await where()}/${String(file).replace(/[/\\]/g, "")}`, bytes, { print: true });
      },
      cancel: async () => link.jobDo(await jobId(), "stop"),
      pause: async () => link.jobDo(await jobId(), "pause"),
      resume: async () => link.jobDo(await jobId(), "resume"),
      async control(c) {
        if (c?.do === "pause" || c?.do === "resume") { await link.jobDo(await jobId(), c.do); return true; }
        return false;   // PrusaLink has no call for moves and temperatures: the printer's own screen does those
      },
      picture: async () => null,
      close() {},
    };
  },
};
