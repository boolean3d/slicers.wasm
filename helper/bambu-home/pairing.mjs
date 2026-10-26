// farm-helper/bambu-home/pairing.mjs — who may talk to the helper (brief printer-helper).
//
// A page in a browser on this network reaches the helper's port, so the helper decides, before any printer is touched:
//   1. Which pages: only ours. A browser names the page's origin on every websocket it opens (the Origin header, which a
//      page cannot change). The helper answers Boolean3d's own addresses, this computer's (a developer's copy) and the
//      ones in the helper file's "origins"; every other page is refused at the door, before a single message.
//   2. Which browsers: paired ones. The helper shows a short code (its console, its own page on this computer, the
//      `code` command); the person types it once in the page. The page gets a token it keeps (its own storage, per
//      origin) and sends on every later line. A wrong code five times makes a new code. An unpaired line is answered,
//      but every request on it gets "pair this browser first" and no printer is reached.
//   3. Who the helper is: a key pair (Ed25519) made on its first start and kept in the helper file; its id is the
//      public key's fingerprint. A tab, the account and a future relay all know the helper by that id; the private
//      key signs whatever asks "is it really you" (sign) and never leaves this computer.
// Printer access codes never come here: a paired page sends them with each connect, the helper keeps them in memory
// for that link only. Node only, no packages. MIT licence (LICENSE beside this file).

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as signBytes, timingSafeEqual } from "node:crypto";

/** The pages the helper answers when nothing else is said: Boolean3d's, and a copy on this computer. */
export const OUR_ORIGINS = ["https://slicers.boolean3d.com", "https://boolean3d.com", "https://www.boolean3d.com"];
const HERE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
/** The letters a code is made of: no 0/O, 1/I/L, so it reads the same from any screen. Same as the account's codes. */
export const CODE_LETTERS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
/** Wrong codes on one code before a new one is made. */
export const MOST_TRIES = 5;
/** Paired browsers kept; the oldest goes when one more pairs. */
const MOST_PAIRED = 50;
/** What the page is told when its line is not paired (shown by the page in its own words). */
export const PAIR_FIRST = "Pair this browser with the helper first: type the code the helper shows.";

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const makeCode = () => Array.from(randomBytes(CODE_LENGTH), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join("");
/** A code as typed (dashes, spaces, small letters) -> the code, or null when it cannot be one. */
export const cleanCode = (v) => {
  const s = String(v ?? "").toUpperCase().replace(/[\s-]/g, "");
  return s.length === CODE_LENGTH && [...s].every((ch) => CODE_LETTERS.includes(ch)) ? s : null;
};
/** A code as shown: ABC-DEF. */
export const showCode = (c) => `${c.slice(0, 3)}-${c.slice(3)}`;

/** An origin header is one of ours: exact for the list, any port for this computer. `extra`: the helper file's. */
export function originAllowed(origin, extra = []) {
  const o = String(origin || "").trim().replace(/\/+$/, "").toLowerCase();
  if (!o) return false;
  if (HERE.test(o)) return true;
  return [...OUR_ORIGINS, ...extra].some((a) => String(a).trim().replace(/\/+$/, "").toLowerCase() === o);
}

/** A key pair for the helper, as kept in its file: {publicKey (spki, base64url), privateKey (pkcs8 PEM)}. */
export function makeIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}
/** The helper's id: the first 16 bytes of the public key's SHA-256, as hex (32 characters). */
export const idOf = (publicKey) => createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex").slice(0, 32);

/**
 * The helper's pairing state over `state` ({identity, paired, origins}, the helper file's fields; made where missing,
 * each change given to `save(patch)`). Returns {helperId, publicKey, sign, code, showCode, origins, allowsOrigin, pair,
 * verify, forget, paired}.
 */
export function pairing(state = {}, { save = () => {}, say = () => {} } = {}) {
  if (!state.identity?.publicKey || !state.identity?.privateKey) { state.identity = makeIdentity(); save({ identity: state.identity }); }
  const privateKey = createPrivateKey(state.identity.privateKey);
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64url");
  const helperId = idOf(publicKey);
  const paired = Array.isArray(state.paired) ? state.paired.filter((p) => typeof p?.hash === "string") : [];
  const extra = Array.isArray(state.origins) ? state.origins.filter((o) => typeof o === "string") : [];
  let code = makeCode(), tries = 0;

  const keep = () => save({ paired });
  function pair(typed, { origin = null, name = null } = {}) {
    const c = cleanCode(typed);
    if (!c || c.length !== code.length || !timingSafeEqual(Buffer.from(c), Buffer.from(code))) {
      if (++tries >= MOST_TRIES) { code = makeCode(); tries = 0; say(`a wrong code ${MOST_TRIES} times: the code is now ${showCode(code)}`); }
      return null;
    }
    const token = randomBytes(32).toString("base64url");
    paired.push({ hash: sha256(token), origin: origin ? String(origin).slice(0, 200) : null, name: name ? String(name).slice(0, 80) : null, madeAt: new Date().toISOString() });
    while (paired.length > MOST_PAIRED) paired.shift();
    code = makeCode(); tries = 0;
    keep();
    say(`paired a browser${origin ? ` at ${origin}` : ""}; the next code is ${showCode(code)}`);
    return token;
  }
  /** The paired browser a token names, or null. */
  function verify(token) {
    if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
    const h = sha256(token);
    return paired.find((p) => p.hash.length === h.length && timingSafeEqual(Buffer.from(p.hash), Buffer.from(h))) ?? null;
  }
  function forget() { paired.length = 0; keep(); code = makeCode(); tries = 0; }

  return {
    helperId, publicKey,
    /** A signature (base64url) over `bytes`, by the helper's private key: how it proves it is the helper with this id. */
    sign: (bytes) => signBytes(null, Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes)), privateKey).toString("base64url"),
    get code() { return code; },
    get showCode() { return showCode(code); },
    origins: [...OUR_ORIGINS, ...extra],
    allowsOrigin: (origin) => originAllowed(origin, extra),
    pair, verify, forget,
    get paired() { return paired.map((p) => ({ origin: p.origin, name: p.name, madeAt: p.madeAt })); },
  };
}
