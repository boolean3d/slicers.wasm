// trace-file-reads.js: put before the program's script on a walk page; logs, per file under /<app>/resources, first open, first read and how far it was read (every 10 s, changes only). start-list.mjs turns the READ lines into a start list.
(Module.preRun = Module.preRun || []).push(() => {
  const FS = Module.FS, t0 = performance.now(), T = () => ((performance.now() - t0) / 1000).toFixed(1);
  const re = /^\/(bambu|orca|prusa)\/resources\//, seen = new Map(), dirty = new Set();
  const note = (stream, end) => {
    const p = stream && stream.path; if (!p || !re.test(p)) return;
    let s = seen.get(p);
    if (!s) { s = { max: 0, size: stream.node && stream.node.usedBytes, bytes: 0 }; seen.set(p, s); console.log('READ ' + T() + ' ' + p); }
    if (end > s.max) { s.max = end; dirty.add(p); }
  };
  const read = FS.read; FS.read = function (stream, buf, off, len, pos) { const n = read.apply(this, arguments);
    note(stream, (pos === undefined ? stream.position : pos + n)); return n; };
  const mmap = FS.mmap; FS.mmap = function (stream, len, pos) { note(stream, pos + len); return mmap.apply(this, arguments); };
  const open = FS.open, op = new Set(); FS.open = function (p) { if (typeof p === 'string' && re.test(p) && !op.has(p)) { op.add(p); console.log('OPEN ' + T() + ' ' + p); } return open.apply(this, arguments); };
  setInterval(() => { for (const p of dirty) { const s = seen.get(p); console.log('RD ' + T() + ' ' + s.max + ' ' + s.size + ' ' + p); } dirty.clear(); }, 10000);
});
