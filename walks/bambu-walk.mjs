// The walks a Bambu Studio package must pass before it is promoted (slicers update, README "Moving to a new release").
// Runs in a real Chrome with a graphics card against the package's own address (the staged version folder).
//   SLICER=<https://host/bambu/<version>/>  VERSION=<version the address must serve>  [PRINTERS="P3C,H2D"]  [TAG=walk]
// Each walk prints one line, "WALK <name> PASS|FAIL <facts>", and a picture; the last line is "WALKS PASS" or
// "WALKS FAIL <names>" and the exit code says the same. cube.stl sits beside the script.
// The harness (launch) is the one the machine that runs it provides: ../cad-browser.mjs on the MSI.
import { launch } from '../cad-browser.mjs';
import fs from 'node:fs';
for (const a of process.argv.slice(2)) { const m = /^([A-Z_]+)=(.*)$/.exec(a); if (m) process.env[m[1]] = m[2]; }
const BASE = process.env.SLICER, VERSION = process.env.VERSION || '', TAG = process.env.TAG || 'walk';
const PRINTERS = (process.env.PRINTERS || 'P3C,H2D').split(',').filter(Boolean);
const W = 1440, H = 900;
if (!BASE) { console.log('SLICER=<address> is needed'); process.exit(2); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failed = [];
const walk = (name, ok, facts) => { console.log('WALK', name, ok ? 'PASS' : 'FAIL', typeof facts === 'string' ? facts : JSON.stringify(facts ?? '').slice(0, 300)); if (!ok) failed.push(name); return ok; };
const start = (model, variant) => BASE + '?b3d-start=prepare&b3d-model=' + encodeURIComponent('Bambu Lab ' + model) + '&b3d-nozzle=0.4'
  + '&b3d-machine=' + encodeURIComponent(`Bambu Lab ${model} 0.4 nozzle`) + '&b3d-process=' + encodeURIComponent(`0.20mm Standard @BBL ${variant}`)
  + '&b3d-filament=' + encodeURIComponent(`Bambu PLA Basic @BBL ${variant}`) + '&b3d-colours=%23FF8000';
const browser = await launch();
const cube = fs.readFileSync('cube.stl').toString('base64');
let shotN = 0;

async function open(url, label) {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  let up = false;
  while (Date.now() - t0 < 500000) { await wait(1000); if (await page.evaluate(() => typeof Module !== 'undefined' && !!Module.wxRunning && !!Module.wxRunning()).catch(() => false)) { up = true; break; } }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (up) await wait(15000);
  const door = (what, args) => page.evaluate(([w, a]) => B3DDoor.act(w, a), [what, args || {}]).catch((e) => ({ ok: false, error: e.message }));
  const shot = (name) => page.screenshot({ path: `${TAG}-${String(++shotN).padStart(2, '0')}-${label}-${name}.png` });
  return { context, page, up, secs, errors, door, shot };
}
// add the cube, slice it, read the numbers, write the file a print sends
async function partAndSlice(t, label) {
  const add = await t.door('add_part', { name: 'cube.stl', base64: cube });
  walk(label + ':open-a-part', !!add.ok && add.result?.objects?.length >= 1, add.ok ? { objects: add.result.objects.length } : add.error);
  await wait(3000); await t.shot('part');
  const s0 = Date.now(); let sl = await t.door('slice');
  let st = null;
  // a dual-nozzle printer's first slice ever asks "watch a tutorial video?" (Bambu's own box): answer No, slice again
  let guide = false;
  while (Date.now() - s0 < 240000) {
    await wait(2000); st = await t.door('status'); if (st.ok && st.result.sliced && !st.result.busy) break;
    const bx = await t.door('boxes');
    if (!guide && bx.ok && JSON.stringify(bx.result).includes('First Guide')) { guide = true; await t.shot('first-guide'); await t.door('press', { button: 'No' }); await wait(2500); sl = await t.door('slice'); }
  }
  const res = await t.door('results');
  walk(label + ':slice', !!sl.ok && !!res.ok && res.result.layers > 0 && res.result.grams > 0, res.ok ? { secs: ((Date.now() - s0) / 1000).toFixed(0), ...res.result } : (sl.error || res.error));
  await wait(2000); await t.shot('sliced');
  const ex = await t.door('export');
  walk(label + ':door-export', !!ex.ok && ex.result.bytes > 1000, ex.ok ? ex.result : ex.error);
}

// ---- the first printer: every walk -------------------------------------------------------------------------------
{
  const first = PRINTERS[0] || 'H2S';
  const t = await open(start(first, first), first);
  const served = t.page.url().match(/bambu\/([^/?]+)\//)?.[1] || '';
  walk('starts', t.up && (!VERSION || served === VERSION), { window: t.up, secs: t.secs, served, errors: t.errors.slice(0, 3) });
  if (t.up) {
    const { page, door, shot } = t;
    await shot('start');
    // the address asked for Prepare: the program ends its start-up there, not on its Home tab
    const at = await door('status');
    walk('start-tab', !!at.ok && at.result.tab === 'prepare', at.ok ? { tab: at.result.tab } : at.error);
    // the printer list: every printer asked for is a row, and the picked one is this one
    const pr = await door('presets', { type: 'printer' });
    const rows = pr.ok ? JSON.stringify(pr.result.printer) : '';
    const picked = (model) => pr.ok && (pr.result.printer || []).some((r) => r.selected && (r.name === 'Bambu Lab ' + model || r.name === 'Bambu Lab ' + model + ' 0.4 nozzle'));
    walk('printer-list', picked(first), pr.ok ? rows.slice(0, 260) : pr.error);
    // the tabs the bar has: no Filament Manager / Project (our build), by picture
    await page.mouse.click(36, 14); await wait(1500); await shot('file-menu'); await page.keyboard.press('Escape'); await wait(800);
    // door: a setting read and written, a list
    const set = await door('settings', { tab: 'process', set: { sparse_infill_density: '17.5%' }, get: ['sparse_infill_density', 'layer_height'] });
    walk('door-settings', !!set.ok && /"17(\.5)?%"/.test(JSON.stringify(set.result)), set.ok ? set.result : set.error);
    await partAndSlice(t, first);
    const pic = await door('picture');
    walk('door-picture', !!pic.ok, pic.ok ? Object.keys(pic.result || {}) : pic.error);
    const back = await door('tab', { to: 'prepare' }); await wait(2500);
    walk('door-tab', !!back.ok, back.ok ? back.result : back.error);
    // drag: the Printer gear opens its settings window; pull it by the title; it must end where the pointer went
    const wins = () => page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => c.parentElement)
      .filter((d, i, a) => d && a.indexOf(d) === i && getComputedStyle(d).display !== 'none')
      .map((d) => { const r = d.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, z: d.style.zIndex }; }).filter((r) => r.w > 0 && r.h > 0));
    await page.mouse.click(Number(process.env.GEAR_X || 437), Number(process.env.GEAR_Y || 84)); await wait(4000);
    const dlg = (await wins()).filter((r) => !(r.x === 0 && r.w >= W - 2)).sort((a, b) => Number(b.z) - Number(a.z))[0];
    if (dlg) {
      await shot('dialog');
      const fx = dlg.x + dlg.w / 2, fy = dlg.y + 12;
      await page.mouse.move(fx, fy); await page.mouse.down(); await wait(100);
      for (let i = 1; i <= 30; i++) { await page.mouse.move(fx - 8 * i, fy + 3 * i); await wait(16); }
      await wait(800); await page.mouse.up(); await wait(800);
      const after = (await wins()).filter((r) => Math.abs(r.w - dlg.w) < 2 && Math.abs(r.h - dlg.h) < 2)[0];
      walk('drag', !!after && Math.abs((after.x - dlg.x) + 240) < 6 && Math.abs((after.y - dlg.y) - 90) < 6, { from: [dlg.x, dlg.y], to: after && [after.x, after.y], asked: [-240, 90] });
      await shot('dialog-moved');
      await page.keyboard.press('Escape'); await wait(1500);
      const left = (await wins()).filter((r) => !(r.x === 0 && r.w >= W - 2))[0];
      if (left) { await page.mouse.click(left.x + left.w - 14, left.y + 12); await wait(1500); }
    } else walk('drag', false, 'the Printer settings window did not open');
    // scroll: the settings list under the pointer moves with the wheel, and comes back
    const crop = { x: 0, y: Math.round(H * 0.6), width: 420, height: Math.round(H * 0.4) - 2 };
    const sig = async () => { const b = await page.screenshot({ clip: crop }); let h = 0; for (let i = 0; i < b.length; i += 7) h = (h * 31 + b[i]) >>> 0; return h; };
    await page.mouse.move(200, Math.round(H * (Number(process.env.SCROLL_AT || 0.9)))); await wait(500);
    const a0 = await sig(); await page.mouse.wheel(0, 100); await wait(900); const a1 = await sig();
    await page.mouse.wheel(0, 100); await wait(900); const a2 = await sig(); await shot('scrolled');
    await page.mouse.wheel(0, -100); await wait(900); await page.mouse.wheel(0, -100); await wait(900); const a3 = await sig();
    walk('scroll', a1 !== a0 && a2 !== a1 && a3 !== a2, { moved1: a1 !== a0, moved2: a2 !== a1, movedBack: a3 !== a2 });
    // Device start: the Device tab shows, the program stays up (camera on a printer: walks/README, CAMERA=)
    const dev = await door('tab', { to: 'device' }); await wait(6000); await shot('device');
    const alive = await door('status');
    walk('device-start', !!dev.ok && !!alive.ok && alive.result.tab === 'device', dev.ok ? { ...dev.result, tab: alive.result?.tab } : dev.error);
    walk('no-page-errors', t.errors.length === 0, t.errors.slice(0, 4));
  }
  await t.context.close();
}
// ---- every other printer: it starts on that printer, takes a part and slices -------------------------------------
for (const p of PRINTERS.slice(1)) {
  const t = await open(start(p, p), p);
  walk(p + ':starts', t.up, { secs: t.secs, errors: t.errors.slice(0, 3) });
  if (t.up) {
    const pr = await t.door('presets', { type: 'printer' });
    const rows = pr.ok ? JSON.stringify(pr.result.printer) : '';
    walk(p + ':printer-list', pr.ok && (pr.result.printer || []).some((r) => r.selected && r.name.startsWith('Bambu Lab ' + p)), pr.ok ? rows.slice(0, 260) : pr.error);
    await t.shot('start');
    await partAndSlice(t, p);
  }
  await t.context.close();
}
console.log(failed.length ? 'WALKS FAIL ' + failed.join(' ') : 'WALKS PASS');
fs.writeFileSync('done.txt', failed.length ? 'fail' : 'ok');
await browser.close();
process.exit(failed.length ? 1 : 0);
