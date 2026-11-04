// node --test package/web-view-printer-line.test.mjs: a printer's own page in a program's web view (OrcaSlicer's Device
// tab -> a Klipper printer's Mainsail, PrusaSlicer's printer tab -> PrusaLink) travels to the home helper on a line the
// service worker opens (wxwebview-sw.js). The helper answers only a browser that paired with it, by the token that
// browser keeps (localStorage b3d-helper-token): the line carries it, also when the browser paired after the program
// started. Every program's copy of page-bridge-web.js is checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const COPIES = fs.readdirSync(ROOT).filter((d) => fs.existsSync(new URL(d + '/shared/js/page-bridge-web.js', ROOT)));

function setUp(dir, { token = null, bridge = null } = {}) {
  let lib = null;
  const store = { 'b3d-helper-token': token };
  const posted = [];
  const worker = { postMessage: (m) => posted.push(m) };
  const Module = {};
  const ctx = {
    addToLibrary: (o) => { lib = o; }, Module, URL, URLSearchParams, console,
    location: { href: 'https://slicers.test/orca/2.3.2/' + (bridge ? '?bridge=' + encodeURIComponent(bridge) : ''), search: bridge ? '?bridge=' + encodeURIComponent(bridge) : '', origin: 'https://slicers.test' },
    window: { addEventListener() {}, isSecureContext: false }, document: { addEventListener() {} },
    navigator: { serviceWorker: { controller: worker } },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  };
  vm.runInNewContext(fs.readFileSync(new URL(dir + '/shared/js/page-bridge-web.js', ROOT), 'utf8'), ctx);
  ctx.wxPageWeb = lib.$wxPageWeb; ctx.wxPageWeb.ensure = () => {};
  lib.wxpage_wv_setup();
  return { Module, posted, store };
}

test('found every program\'s web view', () => { assert.ok(COPIES.length >= 7, COPIES.join(' ')); });

for (const dir of COPIES) {
  test(`${dir}: the line to the helper carries the pair token; none before pairing`, () => {
    const before = setUp(dir);
    assert.equal(before.Module.wxwvLanBridge(), 'ws://localhost:8770');
    const paired = setUp(dir, { token: 'tok-123' });
    assert.equal(new URL(paired.Module.wxwvLanBridge()).searchParams.get('token'), 'tok-123');
    const relay = setUp(dir, { token: 'tok-123', bridge: 'wss://box.test/relay?box=b1' });
    const u = new URL(relay.Module.wxwvLanBridge());
    assert.equal(u.host + u.pathname, 'box.test/relay');
    assert.equal(u.searchParams.get('box'), 'b1');
    assert.equal(u.searchParams.get('token'), 'tok-123');
  });

  test(`${dir}: a printer page opened after pairing tells the worker the line with the token`, () => {
    const p = setUp(dir);
    p.store['b3d-helper-token'] = 'tok-late';   // paired while the program runs
    const at = p.Module.wxwvHouseUrl('http://192.168.1.50/');
    assert.match(at, /__lan\/192\.168\.1\.50\/80\/$/);
    const last = p.posted.filter((m) => m.wxwvLanBridge).at(-1);
    assert.ok(last, 'the worker was told the line');
    assert.equal(new URL(last.wxwvLanBridge).searchParams.get('token'), 'tok-late');
    assert.equal(p.Module.wxwvHouseUrl('https://example.com/'), null);
  });
}
