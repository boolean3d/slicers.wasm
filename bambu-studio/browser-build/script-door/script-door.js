// The slicer door, page side (script_door.cpp is the program side). A driver (scripts/slicer-door: the tab holder on the
// test computer, or a page script) calls  await B3DDoor.act(name, args)  and gets { ok, error, result }.
// Long actions (slice, arrange, fill_bed, clone) are waited for here: the program is asked "status" until it is idle.
// While a box is open the program's loop waits for the person; then any action answers with the box (title, words,
// buttons) and B3DDoor.act('press', { button }) answers it as a person would.
// No send-to-printer and no print here, on purpose.
// main() runs in a worker: the program's exports are not called here but posted to its thread with Module.wxCall
// (bulk/page-extras.js: { wx: 'call', fn, args, free, reply }); the program's answers (B3DDoor.answer, B3DDoor.picture)
// still arrive through MAIN_THREAD_EM_ASM, on the page.
var B3DDoor = (function () {
  const waiting = new Map(); // id -> resolve
  let n = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function running() { return typeof Module !== 'undefined' && Module.wxCall && Module.wxRunning && Module.wxRunning(); }

  // b3d_door_now answers at once, also under an open box; its answer string comes back as a reply from the worker.
  async function now(what, args) {
    const p = stringToNewUTF8(JSON.stringify({ do: what, args: args || {} }));
    try {
      const text = await Module.wxCall('_b3d_door_now', [p], { free: [0], reply: true, patience: 10000 });
      return JSON.parse(text);
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  // One call into the program's main loop. If it does not answer within `patience` ms because a box holds the loop,
  // the answer says so with the box.
  function call(what, args, patience) {
    const id = 'd' + (++n);
    return new Promise((resolve) => {
      let done = false;
      const finish = (a) => { if (!done) { done = true; waiting.delete(id); resolve(a); } };
      waiting.set(id, finish);
      const p = stringToNewUTF8(JSON.stringify({ id: id, do: what, args: args || {} }));
      if (!Module.wxCall('_b3d_door_call', [p], { free: [0] })) { Module._free(p); return finish({ ok: false, error: 'the program is still loading' }); }
      (async () => {
        const start = Date.now(), until = start + (patience || 120000);
        while (!done) {
          await sleep(500);
          if (done) return;
          const b = Date.now() - start > 3000 ? await now('boxes') : null;
          if (done) return;
          if (b && b.ok && b.result.length) {
            // the action is (still) running behind an open box: hand the box back, the action goes on after it
            return finish({ ok: false, error: 'a box is open: ' + b.result.map((x) => '"' + x.title + '" (' + x.buttons.join(', ') + ')').join('; '), boxes: b.result, pending: id });
          }
          if (Date.now() > until) return finish({ ok: false, error: 'the program did not answer "' + what + '" within ' + Math.round((patience || 120000) / 1000) + ' s' });
        }
      })();
    });
  }

  async function idle(limitS) {
    const until = Date.now() + (limitS || 600) * 1000;
    await sleep(300);
    for (;;) {
      const s = await call('status');
      if (!s.ok) return s;
      if (!s.result.busy) return s;
      if (Date.now() > until) return { ok: false, error: 'still busy after ' + (limitS || 600) + ' s', result: s.result };
      await sleep(400);
    }
  }

  // A part for the plate: { url } (fetched by the page), { name, base64 } (bytes from the driver), or { path } in
  // the program's own files. Written to /tmp/door/<name>, then Add. FS stays on the page under pthreads (the
  // program's file calls are proxied here), so the file is written where the program reads it.
  async function part(args) {
    if (args.path) return call('add_part', { path: args.path });
    let name = args.name, bytes;
    if (args.base64) {
      const bin = atob(args.base64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else if (args.url) {
      const r = await fetch(args.url);
      if (!r.ok) return { ok: false, error: 'the page could not fetch ' + args.url + ' (' + r.status + ')' };
      bytes = new Uint8Array(await r.arrayBuffer());
      name = name || decodeURIComponent(new URL(args.url, location.href).pathname.split('/').pop() || 'part.stl');
    } else return { ok: false, error: 'add_part needs url, or name and base64, or path' };
    if (!name) return { ok: false, error: 'add_part needs the file name (it says the kind: .stl, .3mf, .step, .obj)' };
    try { FS.mkdir('/tmp/door'); } catch (e) {}
    const path = '/tmp/door/' + name.replace(/[\/\\]/g, '_');
    FS.writeFile(path, bytes);
    return call('add_part', { path: path });
  }

  const LONG = { slice: 900, arrange: 300, fill_bed: 300, clone: 120 };

  async function act(what, args) {
    args = args || {};
    if (!running()) return { ok: false, error: 'the program is still loading' };
    if (what === 'boxes' || what === 'press') return now(what, args);
    if (what === 'add_part') {
      const a = await part(args);
      if (!a.ok) return a;
      const s = await idle(120);
      return { ok: true, result: a.result, status: s.result };
    }
    const a = await call(what, args);
    if (!a.ok || !LONG[what]) return a;
    if (what === 'slice' && a.result && a.result.already) return call('results'); // sliced, nothing changed since
    const s = await idle(LONG[what]);
    if (!s.ok) return s;
    if (what === 'slice') {
      if (!s.result.sliced) {
        const b = await now('boxes');
        return { ok: false, error: 'the slice ended without a result' + (b.ok && b.result.length ? '; a box is open: ' + JSON.stringify(b.result) : ''), status: s.result };
      }
      return call('results');
    }
    return { ok: true, result: s.result };
  }

  return {
    act: act,
    answer: function (id, text) { const f = waiting.get(id); if (f) f(JSON.parse(text)); },
    // The plate picture: RGBA rows bottom-up (OpenGL) -> a PNG as a data URL. Called through MAIN_THREAD_EM_ASM: the
    // program's thread waits, so ptr is alive; bare HEAPU8 is fresh after memory growth.
    picture: function (id, w, h, ptr) {
      const f = waiting.get(id);
      if (!f) return;
      const px = new Uint8ClampedArray(w * h * 4);
      const src = HEAPU8.subarray(ptr, ptr + w * h * 4);
      for (let y = 0; y < h; y++) px.set(src.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
      f({ ok: true, result: { width: w, height: h, png: c.toDataURL('image/png') } });
    },
  };
})();
