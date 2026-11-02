// farm-helper/drivers/stub.mjs — a printer brand the helper knows of but cannot talk to yet. A stub is listed (so the
// helper's pages can say "not yet"), never probed and never opened. Turning one into a driver: copy template.mjs,
// fill it from the brand's published protocol, and replace the stub's line in index.mjs (../DRIVERS.md).
// MIT licence (../bambu-home/LICENSE).

/** A driver that needs an owner: {kind, name, brands, notes} -> a driver with ready false. */
export function stub({ kind, name, brands, notes }) {
  return {
    kind, name, brands, ready: false, needsOwner: true, notes, ports: [], asks: [],
    probe: async () => null,
    open() { throw Object.assign(new Error(`${name} printers are not supported by the helper yet (the driver needs an owner).`), { code: "NO_DRIVER" }); },
  };
}
