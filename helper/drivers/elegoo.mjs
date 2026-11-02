// farm-helper/drivers/elegoo.mjs — Elegoo printers with their own network firmware (Centauri Carbon). NEEDS AN OWNER:
// a stub, never probed. What to read first (unverified here, check before writing code): Elegoo publishes SDCP, its
// printers' local protocol (github.com/cbd-tech/SDCP-Smart-Device-Control-Protocol-V3.0.0). The Neptune 4 series run
// Klipper with Moonraker: drivers/moonraker.mjs already covers those. MIT licence (../bambu-home/LICENSE).
import { stub } from "./stub.mjs";

export default stub({
  kind: "elegoo", name: "Elegoo (SDCP)", brands: ["Elegoo Centauri Carbon"],
  notes: "Needs an owner. Neptune 4 printers run Klipper: add them as Klipper (Moonraker).",
});
