// farm-helper/drivers/index.mjs — every printer brand the helper knows, one driver file each (the interface: ../DRIVERS.md).
// The helper core (bambu-home/helper.mjs) asks this list, never a brand file by name: adding a brand is one new file
// here and one line in DRIVERS below. MIT licence (../bambu-home/LICENSE).

import net from "node:net";
import { localHosts } from "../bambu.mjs";
import bambu from "./bambu.mjs";
import moonraker from "./moonraker.mjs";
import prusalink from "./prusalink.mjs";
import elegoo from "./elegoo.mjs";
import anycubic from "./anycubic.mjs";
import creality from "./creality.mjs";

/** The drivers, in the order a search tries them at one address. Stubs (ready false) are listed but never probed. */
export const DRIVERS = [bambu, moonraker, prusalink, elegoo, anycubic, creality];

/** The driver of a kind (a printer saved with no kind is a Bambu printer: the helper file before drivers). */
export function driverOf(kind, drivers = DRIVERS) {
  const d = drivers.find((x) => x.kind === (kind || "bambu"));
  if (!d) throw Object.assign(new Error(`The helper has no driver for "${kind}" printers.`), { code: "NO_DRIVER" });
  return d;
}

/**
 * The G-code format of a sliced file, from its bytes: "bgcode" (Prusa's binary G-code: the file starts "GCDE"; PrusaSlicer
 * makes it for MK4/XL/MINI/CORE One) or "gcode" (text). The account names every G-code print ".gcode", so the bytes decide.
 */
export function gcodeFormat(bytes) {
  return bytes?.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x43 && bytes[2] === 0x44 && bytes[3] === 0x45 ? "bgcode" : "gcode";
}

/**
 * The name a print goes to its printer under, for a driver (its `formats`, ["gcode"] when it says none): a binary G-code
 * file keeps ".bgcode" (a printer reads the name to know how to read the file), and one the printer cannot read is
 * refused in plain words before anything is sent. Files that are not G-code (a Bambu .gcode.3mf) pass as they are.
 */
export function printFileFor(driver, file, bytes) {
  const name = String(file);
  if (!/\.gcode$/i.test(name) || /\.gcode\.3mf$/i.test(name)) return name;
  const format = gcodeFormat(bytes);
  if (format === "gcode") return name;
  if (!(driver.formats ?? ["gcode"]).includes(format))
    throw Object.assign(new Error(`${driver.name} printers cannot read binary G-code (.bgcode). In PrusaSlicer: Printer Settings > General > Firmware, untick "Supports binary G-code", slice again and send.`), { code: "FORMAT" });
  return name.replace(/\.gcode$/i, ".bgcode");
}

/** "host", "host:port", "http://host:port/" -> {host, port|null}. */
export function addressOf(text) {
  const m = /^(?:https?:\/\/)?(\[[^\]]+\]|[^/:]+)(?::(\d+))?\/?$/.exec(String(text ?? "").trim());
  return m ? { host: m[1], port: m[2] ? Number(m[2]) : null } : null;
}

/** Whether a TCP port answers at host within `ms` (a quick look before an HTTP probe). */
export function portOpen(host, port, ms = 600) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(ms, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    s.unref?.();
  });
}

/**
 * Who answers at one address: each ready driver's probe on each of its ports (the port given, if one is). Resolves with
 * the first printer found, or null. `kind`: try only that driver.
 */
export async function lookAt(text, { kind = null, drivers = DRIVERS, fetch: get = fetch, timeoutMs = 2500 } = {}) {
  const a = addressOf(text);
  if (!a) return null;
  for (const d of drivers) {
    if (!d.ready || (kind && d.kind !== kind)) continue;
    for (const port of a.port ? [a.port] : (d.ports.length ? d.ports : [undefined])) {
      const f = await d.probe(a.host, port, { fetch: get, timeoutMs }).catch(() => null);
      if (f) return f;
    }
  }
  return null;
}

/**
 * Look across this computer's own networks (or `hosts`) for printers of every ready driver that has ports: a quick TCP
 * look at each port first, then that driver's probe. Only when the person asks (a search), and only at the addresses of
 * the networks this computer is on. onFound(printer) once per printer; resolves with how many were found.
 * One address answers at most once (a Klipper printer's Moonraker on 7125 and its web page on 80: the first that answers wins).
 */
export async function sweep(onFound, { hosts = null, drivers = DRIVERS, fetch: get = fetch, at = 48, timeoutMs = 600, stopped = () => false } = {}) {
  const list = hosts ?? localHosts();
  const jobs = [];
  for (const host of list) jobs.push(host);
  let next = 0, count = 0;
  const seen = new Set();
  const one = async (host) => {
    for (const d of drivers) {
      if (!d.ready || !d.ports.length) continue;
      for (const port of d.ports) {
        if (stopped() || seen.has(host)) break;
        if (!(await portOpen(host, port, timeoutMs))) continue;
        const f = await d.probe(host, port, { fetch: get, timeoutMs: 2500 }).catch(() => null);
        if (f && !seen.has(host)) { seen.add(host); count++; onFound(f); }
      }
    }
  };
  const worker = async () => { while (next < jobs.length && !stopped()) await one(jobs[next++]); };
  await Promise.all(Array.from({ length: Math.min(at, jobs.length) }, worker));
  return count;
}
