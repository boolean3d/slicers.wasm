// farm-helper/drivers/creality.mjs — Creality printers with their own network firmware (K1, K2, Hi series). NEEDS AN
// OWNER: a stub, never probed. These printers run Klipper inside; with root access turned on, Moonraker answers and
// drivers/moonraker.mjs covers them. What the stock firmware offers on the network (Creality Print's own link) is
// unverified here: read it before writing code. MIT licence (../bambu-home/LICENSE).
import { stub } from "./stub.mjs";

export default stub({
  kind: "creality", name: "Creality (stock firmware)", brands: ["Creality K1 / K1C / K1 Max", "Creality K2 Plus", "Creality Hi"],
  notes: "Needs an owner. With root access on, Moonraker answers: add it as Klipper (Moonraker).",
});
