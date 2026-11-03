// node --test package/home-bar.test.mjs: the row over every program is a house back to Boolean3d's Home and nothing
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
  const window = {
    location: url, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    addEventListener() {}, dispatchEvent() {}, Event: class {},
  };
  const document = { body, head, createElement: make, getElementById: (id) => (id === 'main-window' ? main : null), addEventListener() {} };
  Object.assign(window, { window, document, URLSearchParams, setTimeout, Module: undefined });
  return { window, body, all: () => {
    const out = []; const walk = (n) => { out.push(n); n.children.forEach(walk); }; walk(body); return out;
  } };
}

test('the row over a program holds a house to Home and no workspace links', () => {
  const p = page('https://slicers.boolean3d.com/bambu/2.08.02.61-b58/?hub=https%3A%2F%2Fboolean3d.com%2F&project=abc');
  vm.runInNewContext(fs.readFileSync(HERE + 'home-bar.js', 'utf8'), p.window);
  const bar = p.all().find((n) => n.id === 'b3d-bar');
  assert.ok(bar, 'the row is on the page');
  assert.equal(p.body.children[0], bar, 'above the program (#main-window)');
  const links = p.all().filter((n) => n.tagName === 'A');
  assert.equal(links.length, 1, 'one link: the house');
  assert.equal(links[0].href, 'https://boolean3d.com/', 'it goes to Boolean3d, which takes a signed-in person to Home');
  assert.equal(links[0].getAttribute('aria-label'), 'Home');
  assert.match(links[0].innerHTML, /<svg/, 'a house, not a word');
  const words = p.all().map((n) => n.textContent ?? '').join(' ');
  for (const w of ['Design', 'Electronics', 'Make', 'Boolean3d']) assert.ok(!words.includes(w), `no "${w}" in the row`);
  assert.ok(bar.classList.names.has('header'), 'the port moves the program under it (class header)');
});

test('every program page loads the home row, under a name never cached before', () => {
  assert.ok(PAGE_SCRIPTS.includes('home-bar.js'));
  assert.ok(!PAGE_SCRIPTS.includes('workspace-bar.js'), 'workspace-bar.js is cached for a year under its name: never served again');
  assert.ok(!fs.existsSync(HERE + 'workspace-bar.js'));
});
