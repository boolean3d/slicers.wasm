// farm-helper/bambu-home/app.mjs — the downloaded helper's entry (scripts/helper/pack.mjs bundles this file and what it
// imports into one program per system, Node's own single-executable build). Double-clicked, it runs; with a word after
// it, that command (helper.mjs). MIT licence (LICENSE beside this file).
import { isSea } from "node:sea";
import { main } from "./helper.mjs";

// argv[1] is the program itself in both cases (Node puts the executable there for a single-executable too)
// its own path: the page that downloaded it named the file after a one-time secret (pairing.mjs 2b)
main(process.argv.slice(2), { packaged: isSea(), programPath: process.execPath }).then((code) => { if (code !== null) process.exit(code); });
