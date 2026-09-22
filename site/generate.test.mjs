// Tests for site/generate.mjs:  npm run test:page  (node --test site/generate.test.mjs)
//
// No network. Every red runs on a scratch copy in the system temp directory, never on a committed
// file. The honest-absence tests find their items by a plain text scan of the sources, independent of
// the generator's parsers, and then look for each one on the page.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { INPUTS, PAGE, readInputs, render, sha256 } from './generate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = path.join(ROOT, 'site', 'generate.mjs');
const COPIED = ['map.yaml', 'core.md', 'README.md', 'package/map.bundle.json', 'package/core.bundle.json', PAGE];
// The yaml parser's own debug switches. They print tokens to the console and change no parse result.
const YAML_DEBUG_ENV = ['LOG_TOKENS', 'LOG_STREAM'];

const read = (f, root = ROOT) => fs.readFileSync(path.join(root, f), 'utf8');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-sat-page-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of COPIED) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  return dir;
}

function run(args, root, { env = {}, stdout = 'pipe' } = {}) {
  return spawnSync(process.execPath, [GENERATOR, ...args, '--root', root], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
    stdio: ['ignore', stdout, 'pipe'],
  });
}

// Changes one byte: the ASCII case of the first letter of `needle`, at its first occurrence.
function flipByte(file, needle) {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf(needle);
  assert.ok(at >= 0, `"${needle}" not found in ${file}`);
  buf[at] ^= 0x20;
  fs.writeFileSync(file, buf);
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const plain = (md) => md.replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
// Every table row on the page as "cell | cell | ...", in plain text.
const pageRows = (html) => [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  .map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])).join(' | '));
// A Markdown pipe row as "cell | cell | ...", in plain text.
const mdRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(plain).join(' | ');
const mapDocs = () => read('map.yaml').split(/^---$/m).slice(1);
const page = () => read(PAGE);
// The page as it first shows: every <details> removed, open or not.
const visible = () => page().replace(/<details[\s\S]*?<\/details>/g, '');
const section = (html, id) => {
  const i = html.indexOf(`<section id="${id}"`);
  return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i));
};
const unquote = (v) => (v.startsWith('"') ? JSON.parse(v) : v);

// Runs fn with every clock, locale, randomness and environment source replaced by a trap. Clock,
// locale and randomness reads throw; environment reads are recorded and answer undefined.
function underTraps(fn) {
  const envReads = [];
  const trap = (what) => () => { throw new Error(`read ${what}`); };
  const saved = {
    Date: globalThis.Date, Intl: globalThis.Intl, random: Math.random, env: process.env, hrtime: process.hrtime,
    now: performance.now, localeCompare: String.prototype.localeCompare,
    lower: String.prototype.toLocaleLowerCase, upper: String.prototype.toLocaleUpperCase,
    numLocale: Number.prototype.toLocaleString, arrLocale: Array.prototype.toLocaleString,
  };
  globalThis.Date = new Proxy(saved.Date, {
    construct: trap('new Date()'),
    apply: trap('Date()'),
    get: (t, k, r) => (k === 'now' ? trap('Date.now()') : Reflect.get(t, k, r)),
  });
  globalThis.Intl = new Proxy({}, { get: (t, k) => trap(`Intl.${String(k)}`)() });
  Math.random = trap('Math.random()');
  performance.now = trap('performance.now()');
  process.hrtime = trap('process.hrtime()');
  String.prototype.localeCompare = trap('localeCompare');
  String.prototype.toLocaleLowerCase = trap('toLocaleLowerCase');
  String.prototype.toLocaleUpperCase = trap('toLocaleUpperCase');
  Number.prototype.toLocaleString = trap('Number toLocaleString');
  Array.prototype.toLocaleString = trap('Array toLocaleString');
  process.env = new Proxy({}, {
    get: (t, k) => { if (typeof k === 'string') envReads.push(k); return undefined; },
    has: (t, k) => { envReads.push(String(k)); return false; },
    ownKeys: trap('the keys of process.env'),
  });
  try {
    return { value: fn(), envReads };
  } finally {
    globalThis.Date = saved.Date;
    globalThis.Intl = saved.Intl;
    Math.random = saved.random;
    process.env = saved.env;
    process.hrtime = saved.hrtime;
    performance.now = saved.now;
    String.prototype.localeCompare = saved.localeCompare;
    String.prototype.toLocaleLowerCase = saved.lower;
    String.prototype.toLocaleUpperCase = saved.upper;
    Number.prototype.toLocaleString = saved.numLocale;
    Array.prototype.toLocaleString = saved.arrLocale;
  }
}

// ---------- C1: determinism, no clock, no environment ----------

test('C1 two generations in one process are byte-identical', () => {
  const inputs = readInputs(ROOT);
  assert.equal(render(inputs), render(inputs));
});

test('C1 two generator runs under different time zones, locales and yaml debug switches write identical bytes', (t) => {
  const a = scratch(t);
  const b = scratch(t);
  const ra = run([], a, { env: { TZ: 'UTC', LANG: 'C', LC_ALL: 'C' }, stdout: 'ignore' });
  const rb = run([], b, {
    env: { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8', LOG_TOKENS: '1', LOG_STREAM: '1' },
    stdout: 'ignore',
  });
  assert.equal(ra.status, 0, ra.stderr);
  assert.equal(rb.status, 0, rb.stderr);
  assert.ok(fs.readFileSync(path.join(a, PAGE)).equals(fs.readFileSync(path.join(b, PAGE))));
});

test('C1 the trap harness catches a planted clock read and a planted environment read', () => {
  assert.throws(() => underTraps(() => Date.now()), /read Date\.now\(\)/);
  assert.throws(() => underTraps(() => new Date()), /read new Date\(\)/);
  assert.deepEqual(underTraps(() => process.env.HOME).envReads, ['HOME']);
});

test('C1 render reads no clock, locale or randomness, and no environment but the yaml debug switches', () => {
  const inputs = readInputs(ROOT);
  const expected = render(inputs);
  const { value, envReads } = underTraps(() => render(inputs));
  assert.equal(value, expected);
  for (const k of envReads) assert.ok(YAML_DEBUG_ENV.includes(k), `render read process.env.${k}`);
});

test('C1 the generator source names no clock, environment, locale, network or sort', () => {
  const src = fs.readFileSync(GENERATOR, 'utf8');
  for (const re of [/\bDate\b/, /process\.env/, /\bIntl\b/, /toLocale/, /localeCompare/, /Math\.random/,
    /performance\./, /hrtime/, /\bfetch\b/, /node:(http|https|net|dns|tls|dgram)/, /\.sort\(/]) {
    assert.doesNotMatch(src, re);
  }
});

// ---------- C2: the drift check ----------

test('C2 --check exits 0 on the committed tree', () => {
  const r = run(['--check'], ROOT);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /equals a fresh generation/);
});

test('C2 --check exits 1 on a one-byte change to docs/index.html', (t) => {
  const dir = scratch(t);
  flipByte(path.join(dir, PAGE), 'W3C PROV-O');
  const r = run(['--check'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /docs\/index\.html differs from a fresh generation at line \d+:/);
});

test('C2 --check exits 1 on a one-byte change to the README proof table without a regeneration', (t) => {
  const dir = scratch(t);
  flipByte(path.join(dir, 'README.md'), 'Revocation of the key');
  const r = run(['--check'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /differs from a fresh generation at line \d+:/);
});

// ---------- C3: the refusal ----------

for (const [file, needle] of [['map.yaml', 'W3C PROV-O'], ['core.md', 'Typed Standards']]) {
  test(`C3 the generator refuses a one-byte change to ${file}, and writes nothing`, (t) => {
    const dir = scratch(t);
    const before = fs.readFileSync(path.join(dir, PAGE));
    flipByte(path.join(dir, file), needle);
    const signed = JSON.parse(read(`package/${file.split('.')[0]}.bundle.json`)).package.contentHash.sha256;
    for (const args of [[], ['--check']]) {
      const r = run(args, dir);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, new RegExp(`^refused: ${file.replace('.', '\\.')}: sha256 [0-9a-f]{64} differs from contentHash\\.sha256 ${signed}`));
      assert.equal(r.stderr.match(/^refused:/gm).length, 1, 'only the changed file is named');
    }
    assert.ok(fs.readFileSync(path.join(dir, PAGE)).equals(before));
  });
}

// ---------- C4: the digests ----------

test('C4 the page carries the SHA-256 of each committed input and the generated-from line', () => {
  const d = Object.fromEntries(INPUTS.map((i) => [i.file, sha256(fs.readFileSync(path.join(ROOT, i.file)))]));
  const line = `generated from map.yaml @ ${d['map.yaml']}, core.md @ ${d['core.md']}, README.md @ ${d['README.md']}`;
  assert.ok(page().includes(`<!-- ${line} -->`));
  assert.ok(page().includes(`<code>${line}</code>`));
  assert.ok(section(visible(), 'provenance').includes(`<code>${line}</code>`), 'the generated-from line is visible');
  const signed = { 'map.yaml': 'Yes', 'core.md': 'Yes', 'README.md': 'No' };
  for (const i of INPUTS) assert.ok(pageRows(page()).includes(`${i.file} | ${signed[i.file]} | ${d[i.file]}`), i.file);
});

// ---------- C5: honest absence ----------

test('C5 every front-matter absence marker in core.md appears on the page', () => {
  const lines = read('core.md').split('\n');
  const close = lines.indexOf('---', 1);
  const found = [];
  const at = [];
  lines.slice(1, close).forEach((l, i) => {
    const m = /^# ([a-z]+: \S+) +(NOT [A-Z]+.*)$/.exec(l);
    if (m) { found.push(`${m[1]} | ${m[2]}`); at.push(String(i + 2)); }
  });
  assert.ok(found.length > 0);
  for (const row of found) assert.ok(pageRows(visible()).includes(row), row);
  const lineList = at.length < 2 ? at[0] : `${at.slice(0, -1).join(', ')} and ${at[at.length - 1]}`;
  assert.ok(text(section(visible(), 'core')).includes(`Comment lines ${lineList} of core.md.`), lineList);
});

test('C5 the Core responsibilities table appears whole, with every NOT DONE verdict', () => {
  const lines = read('core.md').split('\n');
  const start = lines.indexOf('# Core responsibilities');
  const rows = [];
  for (let i = lines.findIndex((l, j) => j > start && l.startsWith('|')); lines[i]?.startsWith('|'); i += 1) {
    if (!/^\|[-| :]+\|$/.test(lines[i])) rows.push(mdRow(lines[i]));
  }
  const notDone = rows.filter((r) => r.endsWith(' | NOT DONE'));
  assert.ok(notDone.length > 0);
  for (const row of rows) assert.ok(pageRows(visible()).includes(row), row);
});

test('C5 the edge with a null sha256 is drawn, and listed as not pinned with its reason', () => {
  const nulls = mapDocs().filter((d) => /sha256: null/.test(d));
  assert.ok(nulls.length > 0);
  for (const d of nulls) {
    const name = /^ {2}name: (.*)$/m.exec(d)[1];
    const reason = /^ {4}reason: (.*)$/m.exec(d)[1];
    assert.match(page(), new RegExp(`<g class="node unpinned"><title>\\d+\\. ${name.replace(/[()]/g, '\\$&')} `));
    assert.ok(pageRows(visible()).some((r) => r.includes(name) && r.includes(`not pinned: sha256 null. ${reason}`)), name);
  }
});

test('C5 no orbits edge is drawn, and the page carries the map\'s own edgeTypes explanation', () => {
  const docs = mapDocs();
  const svg = page().slice(page().indexOf('<svg class="map"'), page().indexOf('</svg>'));
  assert.equal((svg.match(/<line class="e rel-/g) ?? []).length, docs.length - 1);
  assert.doesNotMatch(read('map.yaml'), /relation: orbits/);
  assert.doesNotMatch(page(), /rel-orbits/);
  const edgeTypes = /^ {2}edgeTypes: (.*)$/m.exec(docs[0])[1];
  const quoted = /<blockquote>([\s\S]*?)<\/blockquote>/.exec(visible());
  assert.equal(quoted && text(quoted[1]), edgeTypes);
});

test('C5 the centre reads as one end of every edge and a self-assessed satellite', () => {
  const edges = mapDocs().slice(1);
  const asSubject = edges.filter((d) => /^subject:\n {2}id: typedstandards\.org$/m.test(d)).length;
  const asObject = edges.filter((d) => /^object:\n {2}id: typedstandards\.org$/m.test(d)).length;
  assert.equal(asSubject + asObject, edges.length);
  const self = /^ {2}selfAssessment: (\S+)$/m.exec(read('core.md'))[1];
  assert.match(page(), /<text class="hub-name"[^>]*>typedstandards\.org<\/text>/);
  assert.match(page(), new RegExp(`<text class="hub-note"[^>]*>self-assessment: ${self}</text>`));
  assert.match(page(), new RegExp(`<text class="hub-note"[^>]*>subject of ${asSubject}, object of ${asObject}</text>`));
  assert.ok(text(visible()).includes(`is at the centre because it is one end of every edge: the subject of ${asSubject} and the object of ${asObject}. Its own record, core.md, assesses it as a ${self}`));
});

test('C5 the README proof table appears whole, with its definitions', () => {
  const lines = read('README.md').split('\n');
  const start = lines.indexOf('## What the records prove / what they do not');
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const section = lines.slice(start + 1, end);
  const rows = section.filter((l) => l.startsWith('|') && !/^\|[-| :]+\|$/.test(l)).map(mdRow);
  assert.ok(rows.length > 1);
  for (const row of rows) assert.ok(pageRows(visible()).includes(row), row);
  const defs = [];
  for (const l of section) {
    const m = /^\*\*([^*]+)\*\* ?(.*)$/.exec(l);
    if (m) defs.push([m[1], m[2]]);
    else if (defs.length && l.trim() && !l.startsWith('|')) defs[defs.length - 1][1] += ` ${l.trim()}`;
    else if (!l.trim() && defs.length) break;
  }
  assert.ok(defs.length > 0);
  const onPage = [...visible().matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => [text(m[1]), text(m[2])]);
  assert.deepEqual(onPage, defs.map(([t, d]) => [plain(t), plain(d)]));
});

test('C5 the dropped entry appears with its reason', () => {
  const header = mapDocs()[0];
  const block = header.slice(header.indexOf('  dropped:\n'));
  const names = [...block.matchAll(/^ {4}- name: (.*)$/gm)].map((m) => m[1]);
  const seeds = [...block.matchAll(/^ {6}seed: (.*)$/gm)].map((m) => m[1]);
  const reasons = [...block.matchAll(/^ {6}reason: (.*)$/gm)].map((m) => (m[1].startsWith('"') ? JSON.parse(m[1]) : m[1]));
  assert.ok(names.length > 0);
  names.forEach((n, i) => assert.ok(pageRows(visible()).includes(`${n} | ${seeds[i]} | ${reasons[i]}`), n));
});

// ---------- the G1b form ----------

test('the sections come in the order set at G1b', () => {
  assert.deepEqual([...page().matchAll(/<section id="([\w-]+)"/g)].map((m) => m[1]),
    ['how', 'map', 'absent', 'core', 'edges', 'proof', 'provenance']);
});

test('README\'s "How Typed Standards was used here" appears whole, after core.md\'s own description', () => {
  const lines = read('README.md').split('\n');
  const start = lines.indexOf('## How Typed Standards was used here');
  assert.ok(start >= 0);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  // Each paragraph and each list item, in order, as plain text.
  const parts = [];
  let open = false;
  for (const l of lines.slice(start + 1, end)) {
    if (!l.trim()) { open = false; continue; }
    if (/^(- |\d+\. )/.test(l)) { parts.push(l.replace(/^(- |\d+\. )/, '')); open = true; }
    else if (open) parts[parts.length - 1] += ` ${l.trim()}`;
    else { parts.push(l.trim()); open = true; }
  }
  assert.ok(parts.length > 10);
  const onPage = [...section(visible(), 'how').matchAll(/<(p|li)>([\s\S]*?)<\/\1>/g)].map((m) => text(m[2]));
  const description = /^description: (.*)$/m.exec(read('core.md'))[1];
  const mission = /^mission: (.*)$/m.exec(read('core.md'))[1];
  assert.equal(onPage[0], `Typed Standards, in its own record (core.md): ${description} Its mission: ${mission}`);
  assert.deepEqual(onPage.slice(1), parts.map(plain));
});

test('Every edge: the five-column table and the collapsed refs table each hold every edge, in map order', () => {
  const edges = mapDocs().slice(1).map((d) => {
    const get = (re) => unquote(re.exec(d)[1]);
    const subject = get(/^subject:\n {2}id: (.*)$/m);
    const outward = subject === 'typedstandards.org';
    const far = d.slice(d.indexOf(outward ? '\nobject:' : '\nsubject:') + 1);
    return {
      name: get(/^ {2}name: (.*)$/m),
      publisher: get(/^ {2}publisher: (.*)$/m),
      ring: get(/^ {2}ring: (.*)$/m),
      relation: get(/^ {2}relation: (.*)$/m),
      arrow: outward ? '→' : '←',
      id: unquote(/^ {2}id: (.*)$/m.exec(far)[1]),
      location: unquote(/^ {4}location: (.*)$/m.exec(far)[1]),
      sha: /^ {4}sha256: (.*)$/m.exec(far)[1],
    };
  });
  const compact = pageRows(/<table class="stack edges">[\s\S]*?<\/table>/.exec(visible())[0]);
  assert.equal(compact[0], '# | Name | Ring | Relation | Basis');
  assert.equal(compact.length - 1, edges.length);
  edges.forEach((e, i) => assert.ok(
    compact[i + 1].startsWith(`${i + 1} | ${e.name}${e.publisher} | ${e.ring} | ${e.arrow} ${e.relation} | `), compact[i + 1]));
  const details = /<details><summary>The other end of every edge: id, location and SHA-256 \((\d+)\)<\/summary>([\s\S]*?)<\/details>/.exec(page());
  assert.ok(details, 'one collapsed <details> with that title');
  assert.equal(Number(details[1]), edges.length);
  const refs = pageRows(details[2]);
  assert.equal(refs[0], '# | Other end | Location and SHA-256');
  assert.equal(refs.length - 1, edges.length);
  edges.forEach((e, i) => assert.equal(refs[i + 1],
    `${i + 1} | ${e.id} | ${e.location}${e.sha === 'null' ? 'not pinned: sha256 null' : e.sha}`));
});

test('the not-pinned edge keeps its reason in its visible row, outside every <details>', () => {
  const compact = pageRows(/<table class="stack edges">[\s\S]*?<\/table>/.exec(visible())[0]);
  for (const d of mapDocs().filter((x) => /sha256: null/.test(x))) {
    const name = unquote(/^ {2}name: (.*)$/m.exec(d)[1]);
    const reason = unquote(/^ {4}reason: (.*)$/m.exec(d)[1]);
    assert.ok(compact.some((r) => r.includes(name) && r.endsWith(`not pinned: sha256 null. ${reason}`)), name);
  }
});

test('table cells wrap at word boundaries; links and code in cells, and cells at phone width, break anywhere', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(page())[1];
  assert.match(css, /\nth,td\{[^}]*overflow-wrap:normal[^}]*\}/);
  assert.match(css, /\ntd a,td code\{overflow-wrap:anywhere\}/);
  assert.match(css, /table\.edges td:nth-child\(3\),table\.edges td:nth-child\(4\)\{white-space:nowrap\}/);
  const phone = css.slice(css.indexOf('@media (max-width:44rem)'));
  assert.match(phone, /table\.stack td\{[^}]*overflow-wrap:anywhere[^}]*\}/);
});

test('G2 preparation: docs/CNAME names the custom domain exactly, docs/.nojekyll is empty, README gives the URL', () => {
  assert.equal(read('docs/CNAME'), 'core-satellite.typedstandards.org');
  assert.equal(fs.statSync(path.join(ROOT, 'docs', '.nojekyll')).size, 0);
  assert.ok(read('README.md').includes('https://core-satellite.typedstandards.org/'));
});

// ---------- C6: self-contained; escaping ----------

test('C6 the page is self-contained: nothing in it fetches on load', () => {
  const p = page();
  assert.ok(p.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`));
  for (const re of [/<script/i, /<iframe/i, /<frame/i, /<object/i, /<embed/i, /<img/i, /<image/i, /<picture/i,
    /<video/i, /<audio/i, /<source/i, /<track/i, /<use\b/i, /<form/i, /<base\b/i, /<portal/i, /\bsrcset=/i, /\bsrc=/i,
    /\bposter=/i, /\bbackground=/i, /@import/i, /@font-face/i, /http-equiv="refresh"/i, /xlink:href/i, /\bping=/i]) {
    assert.doesNotMatch(p, re);
  }
  for (const m of p.matchAll(/url\(([^)]*)\)/g)) assert.match(m[1], /^#[\w-]+$/, 'url() only as a same-document fragment');
  for (const m of p.matchAll(/<link\b[^>]*>/g)) assert.equal(m[0], '<link rel="icon" href="data:,">');
  for (const m of p.matchAll(/<(\w+)\b[^>]*\shref=/g)) assert.ok(['a', 'link'].includes(m[1]), `href on <${m[1]}>`);
});

test('C6 input text is escaped, and only code spans and bold are rendered', (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'README.md');
  const planted = '<b>x</b> [a link](https://example.org) *em* _u_ # h `c` **b** <script>';
  fs.writeFileSync(file, read('README.md', dir).replace('| Revocation of the key |', `| Revocation ${planted} of the key |`));
  const r = run([], dir);
  assert.equal(r.status, 0, r.stderr);
  const p = read(PAGE, dir);
  assert.ok(p.includes('Revocation &lt;b&gt;x&lt;/b&gt; [a link](https://example.org) *em* _u_ # h <code>c</code> <strong>b</strong> &lt;script&gt; of the key'));
  assert.doesNotMatch(p, /<b>x|<script|href="https:\/\/example\.org"/);
});
