// farm-helper/drivers/anycubic.mjs — Anycubic printers (Kobra series). NEEDS AN OWNER: a stub, never probed. Which
// local network calls each Kobra model offers is unverified here: read the model's own documentation and firmware
// notes first. A Kobra running Klipper (community firmware) is covered by drivers/moonraker.mjs.
// MIT licence (../bambu-home/LICENSE).
import { stub } from "./stub.mjs";

export default stub({
  kind: "anycubic", name: "Anycubic", brands: ["Anycubic Kobra series"],
  notes: "Needs an owner. A Kobra with Klipper firmware: add it as Klipper (Moonraker).",
});
