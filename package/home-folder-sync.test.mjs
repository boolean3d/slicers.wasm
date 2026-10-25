// node --test package/home-folder-sync.test.mjs: the settings file merge of home-folder-sync.js (two computers open at once).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.runInNewContext(fs.readFileSync(new URL('home-folder-sync.js', import.meta.url), 'utf8') + '\nthis.m = b3dConfMerge;', ctx);
const { merge, test: isConf } = ctx.m;
const j = (o) => JSON.stringify(o, null, 4);
const agreed = {
  app: { last_backup_path: '/tmp/orcaslicer_model/Sat_Oct_24/00_31_52#42#34', language: 'en', show_splash: true },
  presets: { machine: 'Default Printer', print: 'Default Setting' },
  recent_projects: { '001': '/home/web_user/Boolean3d/Box.3mf' },
};

test('only the start-time setting differs: the merge is this computer\'s file, no copy needed', () => {
  const mine = structuredClone(agreed); mine.app.last_backup_path = '/tmp/orcaslicer_model/Sat_Oct_24/00_46_11#42#42';
  const theirs = structuredClone(agreed); theirs.app.last_backup_path = '/tmp/orcaslicer_model/Sat_Oct_24/00_31_58#42#34';
  assert.deepEqual(JSON.parse(merge(j(agreed), j(mine), j(theirs), false)), mine);
});

test('each side changed a different setting: both kept', () => {
  const mine = structuredClone(agreed); mine.presets.machine = 'Bambu Lab X1 Carbon 0.4 nozzle';
  const theirs = structuredClone(agreed); theirs.app.language = 'de'; theirs.models = [{ model: 'MyKlipper 0.4 nozzle' }];
  const m = JSON.parse(merge(j(agreed), j(mine), j(theirs), false));
  assert.equal(m.presets.machine, 'Bambu Lab X1 Carbon 0.4 nozzle');
  assert.equal(m.app.language, 'de');
  assert.deepEqual(m.models, [{ model: 'MyKlipper 0.4 nozzle' }]);
});

test('both changed the same setting: the newer file wins; a removed setting stays removed', () => {
  const mine = structuredClone(agreed); mine.presets.print = 'Mine'; delete mine.app.show_splash;
  const theirs = structuredClone(agreed); theirs.presets.print = 'Theirs';
  assert.equal(JSON.parse(merge(j(agreed), j(mine), j(theirs), true)).presets.print, 'Mine');
  const m = JSON.parse(merge(j(agreed), j(mine), j(theirs), false));
  assert.equal(m.presets.print, 'Theirs');
  assert.equal('show_splash' in m.app, false);
});

test('recent projects: both computers\' new projects kept, newer first; one taken off stays off', () => {
  const mine = structuredClone(agreed); mine.recent_projects = { '001': '/home/web_user/Boolean3d/Lid.3mf', '002': '/home/web_user/Boolean3d/Box.3mf' };
  const theirs = structuredClone(agreed); theirs.recent_projects = { '001': '/home/web_user/Boolean3d/Hook.3mf' };
  assert.deepEqual(JSON.parse(merge(j(agreed), j(mine), j(theirs), true)).recent_projects,
    { '001': '/home/web_user/Boolean3d/Lid.3mf', '002': '/home/web_user/Boolean3d/Hook.3mf' });
});

test('no agreed version yet (first merge): settings only one side has are kept, others the newer', () => {
  const mine = { app: { a: 1, b: 2 } }, theirs = { app: { a: 9, c: 3 } };
  assert.deepEqual(JSON.parse(merge(null, j(mine), j(theirs), false)), { app: { a: 9, b: 2, c: 3 } });
});

test('not JSON: no merge (both kept as before); only the settings files are merged', () => {
  assert.equal(merge(null, 'not json', '{}', true), null);
  assert.ok(isConf.test('.OrcaSlicer/OrcaSlicer.conf') && isConf.test('.BambuStudio/BambuStudio.conf'));
  assert.ok(!isConf.test('.OrcaSlicer/user/default/process/x.json') && !isConf.test('Boolean3d/a.conf'));
});

// PrusaSlicer's settings file: INI, as AppConfig::save writes it on Linux.
const ini = (head, o) => [head, ...Object.entries(o['']).map(([k, v]) => k + ' = ' + v),
  ...Object.entries(o).filter(([s]) => s).flatMap(([s, kv]) => ['', '[' + s + ']', ...Object.entries(kv).map(([k, v]) => k + ' = ' + v)])].join('\n') + '\n\n';
const pAgreed = { '': { autocenter: '0', version: '2.9.6' }, presets: { print: '0.20mm SPEED @COREONE', printer: 'Original Prusa CORE One' },
  recent_projects: { 1: '/home/web_user/Boolean3d/Box.3mf' }, 'vendor:PrusaResearch': { 'model:COREONE': '"0.4"' } };

test('PrusaSlicer.ini: each side changed a different setting, both kept; written back as INI with the newer header', () => {
  const mine = structuredClone(pAgreed); mine.presets.print = '0.15mm QUALITY @COREONE';
  const theirs = structuredClone(pAgreed); theirs[''].autocenter = '1'; theirs['vendor:PrusaResearch']['model:MK4S'] = '"0.4"';
  const out = merge(ini('# a', pAgreed), ini('# mine', mine), ini('# theirs', theirs), true);
  const want = structuredClone(mine); want[''].autocenter = '1'; want['vendor:PrusaResearch']['model:MK4S'] = '"0.4"';
  assert.equal(out, ini('# mine', want));
});

test('PrusaSlicer.ini: recent projects merged as a list, keys 1, 2 ... in number order', () => {
  const mine = structuredClone(pAgreed); mine.recent_projects = { 1: '/a/Lid.3mf', 2: '/home/web_user/Boolean3d/Box.3mf' };
  const theirs = structuredClone(pAgreed);
  theirs.recent_projects = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), '/t/' + i + '.3mf']));
  const out = merge(ini('# a', pAgreed), ini('# m', mine), ini('# t', theirs), true);
  const rp = out.split('[recent_projects]\n')[1].split('\n\n')[0].split('\n');
  assert.deepEqual(rp.slice(0, 3), ['1 = /a/Lid.3mf', '2 = /t/0.3mf', '3 = /t/1.3mf']);
  assert.equal(rp.length, 10);
  assert.ok(isConf.test('.config/PrusaSlicer/PrusaSlicer.ini') && !isConf.test('.config/PrusaSlicer/print/x.ini'));
});

// ── Sealing and the password store (brief slicer-cloud-2) ──────────
const sctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, atob, Uint8Array };
vm.runInNewContext(fs.readFileSync(new URL('home-folder-sync.js', import.meta.url), 'utf8') + '\nthis.s = b3dSeal; this.k = b3dKeyring;', sctx);
const { keyOf, seal, open, isSealed, extra } = sctx.s;
const b64 = (n) => Buffer.from(new Uint8Array(32).fill(n)).toString('base64url');
const shaOf = (d) => crypto.createHash('sha256').update(d).digest('hex');
import crypto from 'node:crypto';

test('a sealed file opens with the account key under its own name only; the code is not in the stored bytes', async () => {
  const plain = new TextEncoder().encode('{"access_code": {"00M00A2B0000001": "12345678"}}');
  const h = shaOf(plain), k = await keyOf(b64(7));
  const sealed = await seal(k, plain, h);
  assert.equal(sealed.length, plain.length + extra);
  assert.ok(isSealed(sealed));
  assert.ok(!Buffer.from(sealed).toString('latin1').includes('12345678'));
  assert.deepEqual(Buffer.from(await open(k, sealed, h)), Buffer.from(plain));
  await assert.rejects(open(await keyOf(b64(8)), sealed, h), 'another account\'s key');
  await assert.rejects(open(k, sealed, shaOf('other')), 'another file\'s name');
  await assert.rejects(open(null, sealed, h));
  assert.deepEqual(Buffer.from(await open(null, plain, h)), Buffer.from(plain), 'bytes from before sealing as they are');
});

test('password store at start: a fresh browser takes the file; a password saved here since they agreed stays', () => {
  const merge = (...a) => JSON.parse(JSON.stringify(sctx.k.merge(...a)));
  const file = { 'PrusaSlicer/PhysicalPrinter/Stand-in/printhost_password': 'maker\n6869' };
  assert.deepEqual(merge(null, {}, file), file, 'fresh browser');
  assert.deepEqual(merge({}, { a: '1' }, null), { a: '1' }, 'no file yet: this browser\'s');
  assert.deepEqual(merge({ a: '1' }, { a: '2' }, { a: '1' }), { a: '2' }, 'changed here, not yet sent');
  assert.deepEqual(merge({ a: '1' }, { a: '1' }, { a: '3' }), { a: '3' }, 'changed on another computer');
  assert.deepEqual(merge({ a: '1', b: '1' }, { a: '1', b: '1' }, { a: '1' }), { a: '1' }, 'removed on another computer');
  assert.deepEqual(merge({ a: '1' }, {}, { a: '1' }), {}, 'removed here');
});
