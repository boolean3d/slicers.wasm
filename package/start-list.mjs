// Rewrites the traced part of a start list (<app>-start.txt, read by package.mjs --start) from walk logs: every
// file under /<app>/resources the program read during the walks (the "READ <seconds> <path>" lines trace-file-reads.js prints).
// The hand-kept head of the list (everything above the "# --- traced" line) stays as it is.
//   node start-list.mjs <app>-start.txt <walk log>...
import fs from 'node:fs';

const [list, ...logs] = process.argv.slice(2);
if (!list || !logs.length) throw new Error('usage: node start-list.mjs <app>-start.txt <walk log>...');
const MARK = '# --- traced';
const text = fs.existsSync(list) ? fs.readFileSync(list, 'utf8') : '';
const head = text.includes(MARK) ? text.slice(0, text.indexOf(MARK)) : text;
const seen = new Set();
for (const log of logs) {
  for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
    const m = /READ [\d.]+ \/[a-z]+\/resources\/(.+)$/.exec(line);
    if (m) seen.add(m[1].trim());
  }
}
const traced = [...seen].sort();
fs.writeFileSync(list, head + MARK + ' by start-list.mjs from ' + logs.length + ' walk log(s), ' + traced.length + ' files ---\n'
  + traced.join('\n') + '\n');
console.log(list + ': ' + traced.length + ' traced files');
