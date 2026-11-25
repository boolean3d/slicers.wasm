// node --test package/home-bar.test.mjs: our corner over every program holds a house back to Boolean3d's Home (plus Full
// screen, and Install when the browser offers it), no row of its own since 11-25; nothing
// else (no Design / Electronics / Make strip since 11-03), loaded under a new name so cached pages pick it up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HERE = new URL('.', import.meta.url).pathname;
// package.mjs runs when imported: its list is read from the source.
const PAGE_SCRIPTS = JSON.parse(fs.readFileSync(HERE + 'package.mjs', 'utf8').match(/PAGE_SCRIPTS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));

// The least of a page the bar needs: elements with children, attributes, text, listeners.
function page(address) {
  const make = (tag) => {
    const node = { tagName: tag.toUpperCase(), children: [], attributes: {}, style: {}, dataset: {}, listeners: {},
      classList: { names: new Set(), add(n) { this.names.add(n); } },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? 0 : i, 0, c); c.parentNode = this; return c; },
      setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; },
      addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html ?? ''; } };
    return node;
  };
  const body = make('body'), head = make('head');
  const main = make('div'); main.id = 'main-window'; body.appendChild(main);
  const store = new Map();
  const url = new URL(address);
  const tab = new Map();   // sessionStorage: this tab's notes (the forwarding page's b3d-from / b3d-arrived)
  const went = [];
  const window = {
    location: url, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    sessionStorage: { getItem: (k) => tab.get(k) ?? null, setItem: (k, v) => tab.set(k, String(v)) },
    history: { length: 1, go: (n) => went.push(n) },
    addEventListener() {}, dispatchEvent() {}, Event: class {},
  };
  const html = make('html'); html.requestFullscreen = () => Promise.resolve();
  const document = { body, head, documentElement: html, createElement: make, getElementById: (id) => (id === 'main-window' ? main : null),
    querySelectorAll: () => [], addEventListener() {} };
  Object.assign(window, { window, document, URLSearchParams, URL, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, Module: undefined });
  return { window, body, tab, went, all: () => {
    const out = []; const walk = (n) => { out.push(n); n.children.forEach(walk); }; walk(body); return out;
  } };
}

test('the corner over a program holds a house to Home and no workspace links, and no row of its own', () => {
  const p = page('https://slicers.boolean3d.com/bambu/2.08.02.61-b58/?hub=https%3A%2F%2Fboolean3d.com%2F&project=abc');
  vm.runInNewContext(fs.readFileSync(HERE + 'home-bar.js', 'utf8'), p.window);
  const bar = p.all().find((n) => n.id === 'b3d-bar');
  assert.ok(bar, 'the corner is on the page');
  assert.equal(bar.parentNode, p.body);
  assert.ok(!bar.classList.names.has('header'), 'no header: the program keeps the whole height');
  const links = p.all().filter((n) => n.tagName === 'A');
  assert.equal(links.length, 1, 'one link: the house');
  assert.equal(links[0].href, 'https://boolean3d.com/', 'it goes to Boolean3d, which takes a signed-in person to Home');
  assert.equal(links[0].getAttribute('aria-label'), 'Home');
  assert.match(links[0].innerHTML, /<svg/, 'a house, not a word');
  const words = p.all().map((n) => n.textContent ?? '').join(' ');
  for (const w of ['Design', 'Electronics', 'Make', 'Boolean3d']) assert.ok(!words.includes(w), `no "${w}" in the corner`);
  const tools = p.all().filter((n) => n.tagName === 'BUTTON').map((n) => n.getAttribute('data-testid'));
  assert.ok(tools.includes('b3d-bar-fullscreen'), 'one press to full screen');
  assert.ok(tools.includes('b3d-bar-install'), 'install, shown when the browser offers it');
});

test('every program page loads the home row, under a name never cached before', () => {
  assert.ok(PAGE_SCRIPTS.includes('home-bar.js'));
  assert.ok(!PAGE_SCRIPTS.includes('workspace-bar.js'), 'workspace-bar.js is cached for a year under its name: never served again');
  assert.ok(!fs.existsSync(HERE + 'workspace-bar.js'));
});

// The house, pressed: back to the site's page this tab left when it came from the site, the link to Home otherwise.
const press = (p) => {
  vm.runInNewContext(fs.readFileSync(HERE + 'home-bar.js', 'utf8'), p.window);
  const home = p.all().find((n) => n.tagName === 'A');
  const e = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  for (const f of home.listeners.click || []) f(e);
  return { e, home };
};
const ADDRESS = 'https://slicers.boolean3d.com/bambu/2.08.02.61-b59/?project=abc';

test('came from the site: the house goes back, stepping over what the program added to the history', () => {
  const p = page(ADDRESS);
  p.tab.set('b3d-from', 'https://boolean3d.com/');   // the forwarding page's note (package.mjs FWD_NOTE)
  p.tab.set('b3d-arrived', '3');
  p.window.history.length = 5;   // two entries added here since (web views)
  const { e } = press(p);
  assert.equal(e.defaultPrevented, true, 'not the link');
  assert.deepEqual(p.went, [-3], 'back over the two entries added here and one more, to the page that was left');
});

test('came from somewhere else, or from a bookmark: the link to Home', () => {
  for (const [from, arrived] of [['https://www.google.com/', '2'], ['', ''], ['https://boolean3d.com/', '']]) {
    const p = page(ADDRESS);
    if (from) p.tab.set('b3d-from', from);
    if (arrived) p.tab.set('b3d-arrived', arrived);
    p.window.history.length = 4;
    const { e, home } = press(p);
    assert.equal(e.defaultPrevented, false, `the link, from "${from}"`);
    assert.deepEqual(p.went, []);
    assert.equal(home.href, 'https://boolean3d.com/');
  }
});

test('the forwarding page writes down where the tab came from before it forwards', () => {
  const src = fs.readFileSync(HERE + 'package.mjs', 'utf8');
  const note = src.match(/FWD_NOTE = '([^']*)'/)[1];
  assert.match(note, /sessionStorage\.setItem\("b3d-from",document\.referrer\)/);
  assert.match(note, /sessionStorage\.setItem\("b3d-arrived",String\(history\.length\)\)/);
  assert.match(src, /FWD_NOTE \+ 'location\.replace\('/, 'the note comes before the forward');
});

test('a tab Chrome put away and loaded again says once per browser how to keep the site running (Chrome only)', () => {
  const said = [], store = new Map();
  const load = ({ discarded = true, brand = 'Google Chrome' } = {}) => {
    const p = page('https://slicers.boolean3d.com/bambu/2.09.02.62-5/');
    p.window.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    p.window.document.wasDiscarded = discarded;
    p.window.navigator = { userAgent: 'Mozilla/5.0 Chrome/131', userAgentData: { brands: [{ brand: 'Chromium' }, { brand }] } };
    p.window.Module = { b3dNotice: (text, kind, link) => said.push({ text, kind, link }) };
    vm.runInNewContext(fs.readFileSync(HERE + 'home-bar.js', 'utf8'), p.window);
  };
  load({ discarded: false });
  load({ brand: 'Microsoft Edge' });
  assert.equal(said.length, 0, 'not on a normal load, not in Edge');
  load();
  assert.equal(said.length, 1);
  assert.match(said[0].text, /^Chrome paused this tab to save memory\. .*Memory Saver > Always keep these sites active > Add: boolean3d\.com and slicers\.boolean3d\.com$/);
  assert.equal(said[0].kind, 'note', 'it stays until closed');
  assert.deepEqual({ ...said[0].link }, { label: 'Got it' });
  assert.ok(store.get('b3d.discardNote'), 'the same key as the site');
  load();
  assert.equal(said.length, 1, 'once per browser, ever');
});
