# Boolean3d printer helper

A small program that runs at home, next to your 3D printers, so a slicer in a browser tab (Bambu Studio, OrcaSlicer,
PrusaSlicer at slicers.boolean3d.com) and your Boolean3d account can find them, send them prints, show progress and
the camera, and stop a print. It only calls out: no port to open on your router, no VPN.

One program for every printer it knows, through one driver per kind of printer (`drivers/`, see `DRIVERS.md`):
Bambu Lab, Klipper (Moonraker) and PrusaLink today; anyone can add a brand by writing one file.

## Install

On any Linux computer on the printers' network that stays on (a Raspberry Pi, a home server, a Klipper printer's own
Pi), with Node 18 or newer:

    curl -fsSL https://boolean3d.com/farm-helper/bambu-home/install.sh | sh

It installs to `~/boolean3d-bambu`, starts with the computer and again whenever it stops (systemd service
`boolean3d-bambu`). Its page, `http://<that computer>/`, shows a code to link it to your Boolean3d account.

- One Bambu Lab printer straight into your account: the line the Print panel shows (`... | sh -s -- <CODE> ...`).
- On a Klipper printer: the line **Add a printer > Klipper** shows (`klipper/install.sh`, same helper).
- A Raspberry Pi with nothing to type: the printer box image (`scripts/pi-box/` in the Boolean3d repository).
- Windows: the downloadable app (`bambu-home/app.mjs`, the same helper core with a window).

## Commands

    node ~/boolean3d-bambu/bambu-home/helper.mjs printers                 the printers found on this network
    node ~/boolean3d-bambu/bambu-home/helper.mjs add <address> [--password ..]   a printer by its address
    node ~/boolean3d-bambu/bambu-home/helper.mjs status                   what each printer says now
    node ~/boolean3d-bambu/bambu-home/helper.mjs code                     the code a browser types to pair
    sudo systemctl stop boolean3d-bambu                                   stop it

## What stays home

Printer addresses, serial numbers, access codes, passwords and API keys stay in the helper's file on that computer
(`~/.boolean3d-bambu.json`, readable by its owner only). Your account gets each printer's state, progress,
temperatures, and a camera picture only while you look.

## Files

`FILES.txt` lists every file the helper runs from; the install copies exactly those. `bambu-home/` is the core (tab
link, account link, pairing, the printer box), `drivers/` one file per printer kind, `bambu.mjs` and `prusalink.mjs`
the Bambu LAN and PrusaLink protocols. Node's own modules only, no packages.

## Licence

MIT (`bambu-home/LICENSE`), Expresslane Equity LLC. Facts about Bambu Lab's LAN protocol come from MIT tools credited
in `bambu.mjs` (ha-bambulab, bambulabs_api); no Bambu code.
