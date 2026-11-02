// farm-helper/drivers/bambu.mjs — the helper's driver for Bambu Lab printers in LAN-only mode with Developer Mode on
// (X1, P1, A1, H2 and P2 series): MQTT over TLS on 8883, implicit FTPS on 990 or a web link the printer fetches (H2),
// its SSDP announcements on UDP 2021, the RTSPS camera through ffmpeg. The wire code is in ../bambu.mjs and
// ../bambu-home/lan.mjs; this file fills the driver interface (../DRIVERS.md) with it. Bambu is the one driver whose
// printers the browser Bambu Studio also talks to through the helper (tablink.mjs), so its sessions share the helper's
// one link per printer, its file shelf and its cameras (`ctx`). Nothing here talks to Bambu's servers.
// Facts about the LAN protocol come from MIT tools credited in ../bambu.mjs; no Bambu code. MIT licence (../bambu-home/LICENSE).

import tls from "node:tls";
import { activeSlot, hmsCode, listenForPrinters, nozzleOf, rtspsCamera, searchForPrinters, slotNumber, slotsOf } from "../bambu.mjs";
import { controlRequests, sendPrint } from "../bambu-home/lan.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  // An H2 printer's chamber heater packs its target with its temperature in one number: (target << 16) | current.
  // An X1C says chamber_temper plainly.
  const ctc = n(p.device?.ctc?.info?.temp);
  const chamber = ctc !== null ? ctc & 0xffff : n(p.chamber_temper);
  const chamberTarget = ctc !== null ? (ctc >>> 16) & 0xffff : null;
  return {
    state, message,
    file: p.subtask_name ? `${p.subtask_name}.gcode.3mf` : null,
    percent: n(p.mc_percent), secondsLeft: state === "printing" || state === "paused" ? (n(p.mc_remaining_time) ?? 0) * 60 : null,
    layer: n(p.layer_num), layers: n(p.total_layer_num),
    temps: Object.fromEntries(Object.entries({
      nozzle: n(p.nozzle_temper), nozzleTarget: n(p.nozzle_target_temper), bed: n(p.bed_temper), bedTarget: n(p.bed_target_temper), chamber, chamberTarget,
    }).filter(([, v]) => v !== null)),
    nozzle: { diameter: nozzle.diameter, flow: nozzle.flow },
    trays: slotsOf(report).filter((s) => !s.empty).map((s) => ({ slot: slotNumber(s), material: s.material, colour: s.colour, name: s.name, active: slotNumber(s) === now })),
    hasCamera: camera && rtspsCamera(model),
    // The lamp as the printer reports it (lights_report, chamber_light); null when it reports none.
    light: Array.isArray(p.lights_report) && p.lights_report.some((l) => l?.node === "chamber_light")
      ? p.lights_report.find((l) => l.node === "chamber_light").mode === "on" : null,
  };
}

export default {
  kind: "bambu",
  name: "Bambu Lab (LAN-only mode)",
  brands: ["Bambu Lab X1 / X1C / X1E", "P1P / P1S", "A1 / A1 mini", "H2D / H2S / H2C", "P2S"],
  ready: true,
  /** Ports a browser slicer reaches: none through the tunnel (Bambu Studio talks to the helper's tab link instead). */
  ports: [],
  asks: [{ key: "code", words: "access code (printer screen: Settings > Network / LAN, 8 letters and numbers)", secret: true }],

  /** The printers' own announcements (UDP 2021): onFound({serial, ip, model, name}) for each. Returns stop(). */
  listen: (onFound, { port = 2021 } = {}) => listenForPrinters(onFound, { port }),
  /** An SSDP ask, and with `knock` a knock on 8883 across this computer's networks. Resolves with how many answered. */
  search: (onFound, o = {}) => searchForPrinters(onFound, o),
  /** Who answers at host: a Bambu printer's certificate names its serial. */
  probe(host, port = 8883, { timeoutMs = 2500 } = {}) {
    return new Promise((resolve) => {
      const c = tls.connect({ host, port, rejectUnauthorized: false }, () => {
        const cn = c.getPeerCertificate()?.subject?.CN || "";
        c.destroy();
        resolve(/^[0-9A-Z]{8,20}$/.test(cn) ? { kind: "bambu", id: cn, serial: cn, ip: host, host, port, name: cn, model: null, needs: ["code"] } : null);
      });
      c.unref?.();
      c.setTimeout(timeoutMs, () => { c.destroy(); resolve(null); });
      c.on("error", () => resolve(null));
    });
  },

  /**
   * One printer kept in an account: {serial, code, ip?, heardIp?, printerModel?, via?}. `ctx` is the helper's shared
   * {cfg, pool, shelf, cameras, heard, hasFfmpeg, say, saveOne}: one link per printer for the tabs and the account.
   */
  open(p, { cfg = {}, pool, shelf, cameras, heard, hasFfmpeg, say = () => {}, saveOne = () => {} }) {
    let link = null, connecting = false, linkError = null, said = null, closed = false;
    let ip = p.ip || p.heardIp || heard?.get(p.serial)?.ip || null, model = p.printerModel || null;
    function dropLink() { if (link) { const l = link; link = null; pool.give(l); } }
    async function linkUp() {
      if (!ip) ip = heard?.get(p.serial)?.ip ?? null;
      if (link?.isOpen() || connecting || !ip) return;
      dropLink();
      connecting = true;
      try {
        const l = await pool.take(p.serial, ip, p.code);
        if (closed) { pool.give(l); return; }
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
    const open = () => { if (!link?.isOpen()) throw new Error("The helper has no link to the printer."); return link; };
    let lastReport = null;
    return {
      get linked() { return !!link?.isOpen(); },
      async report() {
        await linkUp();
        if (!ip) return (lastReport = { state: "offline", message: "The helper has not heard the printer on this network yet. Is it on, in LAN-only mode?", temps: {} });
        if (!link?.isOpen() || !link.report.print) return (lastReport = { state: "offline", message: linkError || "Linking to the printer…", temps: {} });
        return (lastReport = reportOf(link.report, { model, camera: hasFfmpeg }));
      },
      async host() {
        const firmware = link?.report.info?.module?.find((m) => m.name === "ota")?.sw_ver;
        return firmware ? { firmware } : null;
      },
      /** The printer takes the file as from Bambu Studio on the LAN: plate, AMS slots and options as sent. */
      async print({ file, bytes, slots = [], job = {} }) {
        const l = open();
        try {
          await sendPrint({ link: l, ip, code: p.code, model: p.via === "web" ? "O1" : model, shelf, ftpPort: cfg.ftpPort, name: file, bytes,
            amsMapping: Array.isArray(slots) ? slots : [], plate: job.plate ?? 1, amsMapping2: job.amsMapping2 ?? null, options: job.options ?? {} });
        } catch (err) { shelf.drop(file); throw err; }
      },
      async cancel() { open().request({ print: { sequence_id: String(Date.now() % 1e8), command: "stop", param: "" } }); },
      /** The printers page's buttons, as Bambu Studio sends them on the LAN. */
      async control(c) {
        const l = open();
        for (const req of controlRequests(c, { model, printing: ["printing", "paused"].includes(lastReport?.state) })) l.request(req);
        return true;
      },
      /** The camera while someone looks: onPicture(jpeg) for each new one; returns stop(). Null when it has none. */
      camera(onPicture, onEnd) {
        if (!hasFfmpeg || !ip || !(rtspsCamera(model) || cfg.cameraInput)) return null;
        return cameras.watch({ serial: p.serial, ip, code: p.code }, onPicture, onEnd);
      },
      /** The printer was heard on the network: its address and model (an address can change when the router restarts). */
      heard(f) {
        if (f.model) model = f.model;
        if (f.ip && f.ip !== ip && !p.ip) { ip = f.ip; saveOne({ heardIp: ip, printerModel: model }); dropLink(); }
      },
      get link() { return link; },
      get model() { return model; },
      close() { closed = true; dropLink(); },
    };
  },
};
