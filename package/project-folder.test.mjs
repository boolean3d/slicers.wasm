// node --test package/project-folder.test.mjs: project-folder.js against a stand-in disk (the program's FS), a stand-in
// slicer-home door (its project calls, as supabase/functions/_shared/slicerhome/projects.mjs answers them) and a
// stand-in of the browser's private storage. Each test is one tab start: the address, the disk, what the door holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('project-folder.js', import.meta.url), 'utf8');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
let ids = 0;
const uuid = () => '00000000-0000-4000-8000-' + String(++ids).padStart(12, '0');

/** The door: one project with files and versions, blobs by "<owner>/<sha>", the calls it got. */
function makeDoor() {
  const d = { projects: {}, files: {}, versions: {}, blobs: {}, links: [], calls: [] };
  d.addProject = (name) => { const id = uuid(); d.projects[id] = { id, name }; return id; };
  d.addVersion = (file, bytes, parent = null) => {
    const f = d.files[file], s = sha(bytes), z = zlib.gzipSync(bytes);
    d.blobs[s] = z;
    const number = Object.values(d.versions).filter((v) => v.file === file).length + 1;
    const v = { id: uuid(), file, number, sha256: s, bytes: bytes.length, parent };
    d.versions[v.id] = v; f.newest = v.id; return v;
  };
  d.addFile = (project, path, bytes) => { const id = uuid(); d.files[id] = { id, project, path }; d.addVersion(id, bytes); return id; };
  d.answer = (op, b) => {
    d.calls.push([op, b]);
    switch (op) {
      case 'projects': return { ok: true, projects: Object.values(d.projects).map((p) => ({ id: p.id, name: p.name, parent: null })) };
      case 'project': {
        const p = d.projects[b.project];
        return { ok: true, project: p, files: Object.values(d.files).filter((f) => f.project === p.id).map((f) => {
          const v = d.versions[f.newest];
          return { id: f.id, name: f.path.split('/').pop(), kind: 'file', path: f.path, tool: 'bambu', number: v.number, version: v.id, sha256: v.sha256, bytes: v.bytes, at: '2026-10-26T12:00:00Z' };
        }) };
      }
      case 'fetch': return { ok: true, urls: Object.fromEntries(b.versions.map((v) => [v, 'http://store/get/' + d.versions[v].sha256])) };
      case 'put': return { ok: true, upload: d.blobs[b.sha256] ? null : 'http://store/put/' + b.sha256 };
      case 'save': {
        if (!d.blobs[b.sha256]) return { ok: false, code: 'not_uploaded', error: 'not uploaded' };
        let file = b.file;
        if (!file) { file = Object.values(d.files).find((f) => f.project === b.project && f.path === b.path)?.id; if (!file) { file = uuid(); d.files[file] = { id: file, project: b.project, path: b.path }; } }
        const top = d.files[file].newest;
        // The server's rule (file_version_add): the newest version's bytes again make no new version; made from an
        // older one, the answer says whose they are.
        if (top && d.versions[top].sha256 === b.sha256) {
          const n = d.versions[top], caught = !!b.parent && b.parent !== top;
          return { ok: true, file, version: top, number: n.number, behind: false, same: true, caught_up: caught,
            ...(caught ? { newer_number: n.number, newer_by: d.savedBy || null, newer_mine: !d.savedBy } : {}) };
        }
        const behind = !!top && b.parent !== top;
        const z = d.blobs[b.sha256], v = d.addVersion(file, zlib.gunzipSync(z), b.parent);
        const newer = behind ? d.versions[top] : null;
        return { ok: true, file, version: v.id, number: v.number, behind, same: false,
          ...(newer ? { newer_number: newer.number, newer_by: d.savedBy || null, newer_mine: !d.savedBy } : {}) };
      }
      case 'link': { const id = uuid(); d.links.push({ id, from: b.from, to: b.to, part: b.part }); return { ok: true, link: id, to: b.to, pinned: 4 }; }
      default: return { ok: false, error: 'no call ' + op };
    }
  };
  return d;
}

/** One tab: the script run on a stand-in page, its program started (preRun done). */
async function tab({ door, search = '', storage = new Map(), opfs = new Map(), linked = true, app = '/bambu/2.08/' }) {
  const files = new Map();   // path -> Uint8Array
  const notices = [];        // what the page said (no document here: the notice line logs it)
  const FS = {
    mkdirTree() {},
    writeFile(p, data) { const s = this.open(p, 'w'); files.set(p, Uint8Array.from(data)); this.close(s); },
    readFile(p) { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p); },
    open(p, mode) { return { path: p, flags: mode === 'w' ? 577 : 0 }; },
    close() {},
    rename(a, b) { files.set(b, files.get(a)); files.delete(a); },
  };
  const Module = { FS, preRun: [], arguments: [], deps: 0, addRunDependency() { this.deps++; }, removeRunDependency() { this.deps--; } };
  Module.b3dHome = {
    linked: () => linked,
    ask: async (op, body) => new Response(JSON.stringify(door.answer(op, body))),
    beside: (u) => u,
  };
  const dir = { async getDirectoryHandle() { return dir; },
    async getFileHandle(name, o) {
      if (!opfs.has(name) && !(o && o.create)) throw new Error('NotFound');
      return { getFile: async () => new Blob([opfs.get(name)]),
        createWritable: async () => ({ write: async (data) => { opfs.set(name, Uint8Array.from(data)); }, close: async () => {} }) };
    } };
  const fetch = async (url, init) => {
    const [, kind, s] = /^http:\/\/store\/(get|put)\/(\w+)$/.exec(url);
    if (kind === 'get') return new Response(door.blobs[s]);
    door.blobs[s] = Buffer.from(await new Response(init.body).arrayBuffer());
    return new Response('{}');
  };
  const ctx = {
    Module, URLSearchParams, Response, Blob, TextEncoder, crypto: globalThis.crypto, CompressionStream, DecompressionStream,
    setTimeout, clearTimeout, setInterval, clearInterval, console: { log() {}, warn(t) { notices.push(String(t)); }, error() {} }, fetch,
    location: { pathname: app, search },
    navigator: { storage: { getDirectory: async () => dir } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  };
  vm.runInNewContext(SRC, ctx);
  // The program copies Module.arguments as its script loads, before preRun: later changes count only in that array.
  Module.startedWith = Module.arguments || [];
  for (const f of Module.preRun) f();
  for (let i = 0; i < 200 && Module.deps; i++) await wait(10);
  assert.equal(Module.deps, 0, 'the program starts');
  Module.calledRun = true;
  const write = (p, text) => FS.writeFile(p, enc(text));
  const settle = async () => { await wait(1100); await Module.b3dProjects.idle(); await wait(20); await Module.b3dProjects.idle(); };
  return { Module, files, FS, write, settle, P: Module.b3dProjects, storage, opfs, notices };
}
const saves = (door) => door.calls.filter(([op]) => op === 'save').map(([, b]) => b);

test('?project=&open=: the project is a folder before the program starts, the file its argument', async () => {
  const door = makeDoor(), p = door.addProject('Desk lamp');
  door.addFile(p, 'plate.3mf', enc('v1 bytes'));
  door.addFile(p, 'board/lamp.kicad_pcb', enc('pcb'));
  const t = await tab({ door, search: `?project=${p}&open=plate.3mf` });
  assert.equal(dec(t.files.get('/home/web_user/Projects/Desk lamp/plate.3mf')), 'v1 bytes');
  assert.equal(dec(t.files.get('/home/web_user/Projects/Desk lamp/board/lamp.kicad_pcb')), 'pcb');
  assert.deepEqual([...t.Module.startedWith], ['/home/web_user/Projects/Desk lamp/plate.3mf'], 'the array the program started with');
  await t.settle();
  assert.equal(saves(door).length, 0, 'putting the files there is not a save');
});

test('the program saves a file of the folder: a new version, its parent the version it was opened at', async () => {
  const door = makeDoor(), p = door.addProject('Lamp');
  const f = door.addFile(p, 'plate.3mf', enc('one'));
  const v1 = door.files[f].newest;
  const t = await tab({ door, search: `?project=${p}` });
  const abs = '/home/web_user/Projects/Lamp/plate.3mf';
  t.write(abs + '.tmp', 'two'); t.FS.rename(abs + '.tmp', abs);
  await t.settle();
  const s = saves(door);
  assert.equal(s.length, 1);
  assert.equal(s[0].file, f); assert.equal(s[0].parent, v1); assert.equal(s[0].tool, 'bambu');
  assert.equal(dec(zlib.gunzipSync(door.blobs[sha(enc('two'))])), 'two', 'the blob went up as gzip');
  // The same bytes again: nothing new.
  t.write(abs, 'two'); await t.settle();
  assert.equal(saves(door).length, 1);
  // Next save: its parent is the version just made.
  t.write(abs, 'three'); await t.settle();
  assert.equal(saves(door)[1].parent, door.calls.filter(([op]) => op === 'save').length && Object.values(door.versions).find((v) => v.number === 2).id);
});

test('a new file in the project folder becomes a project file at its path; the programs\' lock and backup files do not', async () => {
  const door = makeDoor(), p = door.addProject('Board');
  const t = await tab({ door, search: `?project=${p}` });
  const dir = '/home/web_user/Projects/Board/';
  t.write(dir + 'amp.kicad_pcb', 'pcb');
  t.write(dir + 'amp.kicad_prl', 'window');
  t.write(dir + '~amp.kicad_pcb.lck', 'lock');
  t.write(dir + 'amp-backups/amp-2026.zip', 'zip');
  t.write(dir + 'fp-info-cache', 'cache');
  t.write(dir + '.history/.git/HEAD', 'ref: refs/heads/master');
  t.write('/home/web_user/.config/elsewhere.txt', 'not a project');
  await t.settle();
  assert.deepEqual(saves(door).map((s) => [s.project, s.path, s.file]), [[p, 'amp.kicad_pcb', undefined]]);
});

test('a CAD part\'s 3MF: its first save makes <part>.3mf in the part\'s project, linked to the part version it was opened at', async () => {
  const door = makeDoor(), p = door.addProject('My files');
  const t = await tab({ door });
  const abs = '/home/web_user/Uploads/Box.3mf', partVersion = uuid(), part = uuid();
  await t.P.part(abs, { part, version: partVersion, project: p, projectName: 'My files' }, enc('as made'));
  t.write(abs, 'as made'); await t.settle();
  assert.equal(saves(door).length, 0, 'opening it is not a save');
  t.write(abs, 'plated and saved'); await t.settle();
  assert.deepEqual(saves(door).map((s) => [s.project, s.path, s.parent]), [[p, 'Box.3mf', null]]);
  assert.equal(door.links.length, 1);
  assert.equal(door.links[0].to, partVersion);
  assert.equal(door.links[0].from, Object.values(door.versions)[0].id);
  t.write(abs, 'saved again'); await t.settle();
  assert.equal(door.links.length, 1, 'linked once');
  assert.equal(saves(door)[1].file, saves(door).length && Object.values(door.files)[0].id);
});

test('opened from the Open box (Uploads/), Save As into the browser\'s downloads under its name: a version of that file', async () => {
  const door = makeDoor(), p = door.addProject('Lamp');
  const f = door.addFile(p, 'prints/plate.3mf', enc('one'));
  const t = await tab({ door });
  const got = await t.P.file(p, f);
  assert.equal(got.name, 'plate.3mf'); assert.equal(dec(got.bytes), 'one');
  const openedAt = got.entry.version;
  t.P.track('/home/web_user/Uploads/plate.3mf', got.entry);
  t.write('/home/web_user/Uploads/plate.3mf', 'one');   // the picker copies it in
  t.write('/home/web_user/Downloads/plate.3mf', 'saved as');
  t.write('/home/web_user/Downloads/other.3mf', 'not ours');
  await t.settle();
  assert.deepEqual(saves(door).map((s) => [s.file, s.parent]), [[f, openedAt]]);
  t.P.untrack('/home/web_user/Uploads/plate.3mf');
  t.write('/home/web_user/Uploads/plate.3mf', 'from the computer'); await t.settle();
  assert.equal(saves(door).length, 1, 'a file from the computer under that name is no project file');
});

test('reload: the folder comes back from this browser\'s storage; a save that did not go up goes up at the start', async () => {
  const door = makeDoor(), p = door.addProject('Lamp');
  door.addFile(p, 'plate.3mf', enc('one'));
  const storage = new Map(), opfs = new Map();
  const t1 = await tab({ door, search: `?project=${p}`, storage, opfs });
  const abs = '/home/web_user/Projects/Lamp/plate.3mf';
  t1.Module.b3dHome.linked = () => false;   // offline: the save stays here
  t1.write(abs, 'offline edit'); await t1.settle();
  assert.equal(saves(door).length, 0);
  const t2 = await tab({ door, storage, opfs });
  assert.equal(dec(t2.files.get(abs)), 'offline edit', 'the working copy is back before the program starts');
  await t2.settle();
  assert.equal(saves(door).length, 1);
  assert.equal(dec(zlib.gunzipSync(door.blobs[saves(door)[0].sha256])), 'offline edit');
});

test('a second browser opens the project and gets the newest version', async () => {
  const door = makeDoor(), p = door.addProject('Lamp');
  door.addFile(p, 'plate.3mf', enc('one'));
  const a = await tab({ door, search: `?project=${p}` });
  a.write('/home/web_user/Projects/Lamp/plate.3mf', 'two'); await a.settle();
  const b = await tab({ door, search: `?project=${p}&open=plate.3mf` });
  assert.equal(dec(b.files.get('/home/web_user/Projects/Lamp/plate.3mf')), 'two');
});

test('no network: the save waits on this computer, says so once, and goes up by itself when it can', async () => {
  const door = makeDoor(), p = door.addProject('Lamp');
  const f = door.addFile(p, 'plate.3mf', enc('one'));
  const t = await tab({ door, search: `?project=${p}` });
  const ask = t.Module.b3dHome.ask;
  t.Module.b3dHome.ask = async () => { throw new TypeError('Failed to fetch'); };
  t.write('/home/web_user/Projects/Lamp/plate.3mf', 'offline edit'); await t.settle();
  assert.equal(saves(door).length, 0);
  assert.equal(t.notices.filter((n) => /Saved on this computer/.test(n)).length, 1, 'said once');
  await wait(2200); await t.P.idle();
  assert.equal(t.notices.filter((n) => /Saved on this computer/.test(n)).length, 1, 'a second failed try says nothing new');
  t.Module.b3dHome.ask = ask;   // the network is back
  await wait(4200); await t.P.idle(); await wait(20); await t.P.idle();
  assert.deepEqual(saves(door).map((s) => [s.file, dec(zlib.gunzipSync(door.blobs[s.sha256]))]), [[f, 'offline edit']]);
  assert.ok(t.notices.some((n) => /is in your project now \(version 2\)/.test(n)), 'says it went up');
});

test('bytes that arrived damaged (bad_upload): sent again, then a version', async () => {
  const door = makeDoor(), p = door.addProject('Lamp');
  door.addFile(p, 'plate.3mf', enc('one'));
  const t = await tab({ door, search: `?project=${p}` });
  const answer = door.answer;
  let bad = 1;
  door.answer = (op, b) => {
    if (op === 'save' && bad) { bad--; delete door.blobs[b.sha256]; return { ok: false, code: 'bad_upload', error: 'The file arrived damaged.' }; }
    return answer(op, b);
  };
  t.write('/home/web_user/Projects/Lamp/plate.3mf', 'two'); await t.settle();
  await wait(2200); await t.P.idle(); await wait(20); await t.P.idle();
  assert.equal(saves(door).length, 1);
  assert.equal(door.calls.filter(([op]) => op === 'put').length, 2, 'the bytes went up a second time');
});

test('someone saved in between: both kept, this one newest, and the notice says who', async () => {
  const door = makeDoor(), p = door.addProject('Lamp');
  const f = door.addFile(p, 'plate.3mf', enc('one'));
  const t = await tab({ door, search: `?project=${p}` });
  door.addVersion(f, enc('theirs'), door.files[f].newest); door.savedBy = 'Ana';
  t.write('/home/web_user/Projects/Lamp/plate.3mf', 'mine'); await t.settle();
  assert.equal(Object.values(door.versions).filter((v) => v.file === f).length, 3, 'v1, theirs, mine');
  assert.ok(t.notices.some((n) => /Saved as version 3 of plate\.3mf\. Ana saved version 2 while you worked/.test(n)), t.notices.join(' | '));
});

test('the same board another tab saved meanwhile: no new version, the notice says so, the next save follows it', async () => {
  const door = makeDoor(), p = door.addProject('Lamp');
  const f = door.addFile(p, 'lamp.kicad_pcb', enc('one'));
  const t = await tab({ door, search: `?project=${p}` });
  door.addVersion(f, enc('turned'), door.files[f].newest);   // the other tab's Ctrl+S: version 2
  t.write('/home/web_user/Projects/Lamp/lamp.kicad_pcb', 'turned'); await t.settle();
  assert.equal(Object.values(door.versions).filter((v) => v.file === f).length, 2, 'no version 3');
  assert.ok(t.notices.some((n) => /lamp\.kicad_pcb is the same as version 2, which you saved from another tab\. Nothing new to keep\./.test(n)), t.notices.join(' | '));
  t.write('/home/web_user/Projects/Lamp/lamp.kicad_pcb', 'turned twice'); await t.settle();
  const v3 = Object.values(door.versions).find((v) => v.file === f && v.number === 3);
  assert.equal(v3.parent, Object.values(door.versions).find((v) => v.file === f && v.number === 2).id, 'made from version 2');
  assert.ok(!t.notices.some((n) => /while you worked/.test(n)), 'not behind: ' + t.notices.join(' | '));
});

test('a refused save (view only): said in the account\'s words, not tried again', async () => {
  const door = makeDoor(), p = door.addProject('Lamp');
  door.addFile(p, 'plate.3mf', enc('one'));
  const t = await tab({ door, search: `?project=${p}` });
  const answer = door.answer;
  door.answer = (op, b) => op === 'put' ? (door.calls.push([op, b]), { ok: false, code: 'not_allowed', error: 'You can view this project but not change it.' }) : answer(op, b);
  t.write('/home/web_user/Projects/Lamp/plate.3mf', 'two'); await t.settle();
  await wait(2200); await t.P.idle();
  assert.equal(door.calls.filter(([op]) => op === 'put').length, 1, 'asked once');
  assert.ok(t.notices.some((n) => /was not saved to Boolean3d: You can view this project but not change it/.test(n)));
  assert.ok(!t.notices.some((n) => /Saved on this computer/.test(n)));
});

test('KiCad: a STEP exported beside the board is linked made from the board version it was written at, every export', async () => {
  const door = makeDoor(), p = door.addProject('Desk lamp');
  const board = door.addFile(p, 'Electronics/lamp.kicad_pcb', enc('pcb v1'));
  const t = await tab({ door, search: `?project=${p}`, app: '/kicad/pcbnew/' });
  const dir = '/home/web_user/Projects/Desk lamp/Electronics/';
  t.write(dir + 'lamp.step', 'ISO-10303-21; one');
  await t.settle();
  const s1 = saves(door).find((s) => s.path === 'Electronics/lamp.step');
  assert.ok(s1, 'the STEP is a project file beside the board');
  assert.equal(s1.tool, 'kicad');
  assert.equal(door.links.length, 1);
  assert.equal(door.links[0].to, door.files[board].newest, 'made from the board as opened');
  // The board saved again, then exported again: the new STEP version is made from the new board version.
  t.write(dir + 'lamp.kicad_pcb', 'pcb v2');
  await t.settle();
  const v2 = door.files[board].newest;
  t.write(dir + 'lamp.step', 'ISO-10303-21; two');
  await t.settle();
  assert.equal(door.links.length, 2);
  assert.equal(door.links[1].to, v2);
  // A slicer's STEP is no KiCad export: no link.
  const t2 = await tab({ door, search: `?project=${p}` });
  t2.write(dir + 'other.step', 'ISO-10303-21; three');
  await t2.settle();
  assert.equal(door.links.length, 2);
});
