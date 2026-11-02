# Printer drivers: how to add a printer brand to the helper

The Boolean3d printer helper is one program (`bambu-home/helper.mjs`, and `bambu-home/box.mjs` for the printer box)
that talks to printers only through **drivers**: one file per kind of printer in `drivers/`. The helper core finds
printers, keeps them in an account, sends them prints from the account and from slicers in a browser, shows their
progress and camera, and passes on the printers page's buttons. A driver only says how *its* printers do each of those.

Drivers today:

| kind | file | printers | state |
|---|---|---|---|
| `bambu` | `drivers/bambu.mjs` | Bambu Lab (LAN-only mode, Developer Mode) | works |
| `moonraker` | `drivers/moonraker.mjs` | anything running Klipper + Moonraker (Voron, RatRig, Sovol, Neptune 4, rooted K1) | works |
| `prusalink` | `drivers/prusalink.mjs` | Prusa MK4 / Core One / XL / MINI with PrusaLink | works |
| `elegoo` | `drivers/elegoo.mjs` | Elegoo SDCP (Centauri Carbon) | stub: needs an owner |
| `anycubic` | `drivers/anycubic.mjs` | Anycubic Kobra | stub: needs an owner |
| `creality` | `drivers/creality.mjs` | Creality K1, K2 Plus, Hi on stock firmware | stub: needs an owner |

## Adding a brand: one file, one line

1. Copy `drivers/template.mjs` to `drivers/<yourbrand>.mjs`. The template is a whole, working driver for a made-up
   printer (the "Example 1", a small JSON API on port 8125), commented line by line.
2. Change `kind` (one short unique word), `name`, `brands`, `ports`, `asks`, and replace each HTTP call with your
   printer's own. Keep the function names and the shapes they return (below).
3. Add one import and one entry to `DRIVERS` in `drivers/index.mjs` (replace the stub if your brand has one).
4. Add your file to `FILES.txt` (the install copies only what is listed; a test checks every import is there).
5. Copy the template's tests in `helper/test/helper-drivers.test.cjs`: a stand-in that answers like your printer, then
   find, print, progress, cancel. Run them: `node --test helper/test/helper-drivers.test.cjs`.

Nothing else in the helper changes: the account, the pages, the box and the browser slicers all go through the driver.

## The interface

A driver file's default export:

| field | what |
|---|---|
| `kind` | short unique word, saved with each printer in the helper file |
| `name` | what a person reads ("Klipper (Moonraker)") |
| `brands` | printers it covers, for the pages |
| `ready` | `false`: listed as "needs an owner", never probed or opened |
| `formats` | the G-code it reads: `["gcode"]` (the default) or `["gcode", "bgcode"]` for Prusa's binary G-code. The helper names the file `.bgcode` when the bytes are binary, and refuses a format not listed before sending |
| `ports` | TCP ports it is found on, and that a browser slicer may reach through the helper's tunnel |
| `asks` | `[{key, words, secret, optional}]`: what the person types once beyond the address (password, API key). Kept on that computer only, never sent to Boolean3d |
| `slicerHost(p)` | the address a slicer's own "print host" setting takes, if any |
| `probe(host, port, {fetch, timeoutMs})` | who answers there: `{kind, id, host, port, name, model, needs}` or `null`. GETs only, quick, never throws. `needs` = the `asks` still missing |
| `open(p, ctx)` | a session with one printer `p` = `{kind, host, port, ...asks}` (`ctx.fetch`, and for Bambu the helper's shared links) |

The session `open` returns:

| function | what |
|---|---|
| `report()` | `{state, message, file, percent, secondsLeft, temps: {nozzle, nozzleTarget, bed, bedTarget}}`. States: `standby printing paused complete cancelled error offline unknown`. Never throws: unreachable is `offline` with a message in plain words |
| `host()` | firmware versions for the account's printer page, `{}` if none |
| `print({file, bytes, slots, job})` | send the sliced file and start it; throw an `Error` in plain words when the printer refuses |
| `cancel()`, `pause()`, `resume()` | the print's own buttons |
| `control(c)` | the printers page's other buttons (`{do: "home"\|"jog"\|"temp"\|"light", ...}`); return `false` for one it has no call for |
| `picture()` or `camera(onPicture, onEnd)` | a JPEG still, or a stream (returns its stop function); leave out for no camera |
| `close()` | let go of anything open |

Names a driver must not use for its `asks`, because the helper file keeps them beside each printer:
`kind host port key server anon id name model serial code`. Use `apiKey`, `password`, `user` or your own.

## What a driver must never do

- Call anywhere but the printer: the helper core alone talks to Boolean3d.
- Send the printer's address, serial, password or key anywhere.
- Probe with anything but harmless reads, or probe addresses the person did not ask it to search.

## Licence

MIT (`bambu-home/LICENSE`), like the rest of the helper. A driver ported from a vendor's published protocol notes
its source at the top of the file.
