// Tests for site/generate.mjs:  npm run test:page  (node --test site/generate.test.mjs)
//
// No network. Every red runs on a scratch copy in the system temp directory, never on a committed file. The
// honest-absence tests find their items by a plain text scan of the sources, independent of the
// generator's parsers, and then look for each one on the page. Most tests run twice: on the committed tree,
// and on a scratch copy whose records a throwaway key signed afresh (test/scratch.mjs), so that the page
// is tested both before and after the batch has bundles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { FONTS, FORBIDDEN, PAGE, POLICY, RECORDS, ZONE_RULE, eastern, listing, readInputs, refusals, render, sha256 } from './generate.mjs';
import { ROOT, flipByte, read, readJson, run, scratch, signedBaseline, signedCopy } from '../test/scratch.mjs';

const GENERATOR = 'site/generate.mjs';
// The yaml parser's own debug switches. They print tokens to the console and change no parse result.
const YAML_DEBUG_ENV = ['LOG_TOKENS', 'LOG_STREAM'];
const TREES = [['committed', () => ROOT], ['signed afresh', () => signedBaseline().dir]];

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const plain = (md) => md.replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
// Every table row on the page as "cell | cell | ...", in plain text.
const pageRows = (html) => [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
  .map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])).join(' | '));
// A Markdown pipe row as "cell | cell | ...", in plain text.
const mdRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(plain).join(' | ');
const page = (root = ROOT) => read(PAGE, root);
// The page as it first shows: every <details> removed, open or not.
const visible = (root = ROOT) => page(root).replace(/<details[\s\S]*?<\/details>/g, '');
const section = (html, id) => {
  const i = html.indexOf(`<section id="${id}"`);
  return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i));
};
const unquote = (v) => (v.startsWith('"') ? JSON.parse(v) : v);

// The map the page draws, by a plain text scan: the current map-header record's file and the current edge
// records' files, in docs/records.json order; or, with no current map-header record, map.yaml's documents.
// [0] is the header, the rest are edges.
function mapDocs(root = ROOT) {
  const records = readJson(RECORDS, root).records;
  const active = (role) => records.filter((r) => r.role === role && r.status === 'active');
  if (active('map-header').length) return [active('map-header')[0], ...active('edge')].map((r) => read(r.file, root));
  return read('map.yaml', root).split(/^---$/m).slice(1);
}

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

for (const [label, tree] of TREES) {
  test(`C1 (${label}) two generations in one process are byte-identical`, () => {
    const inputs = readInputs(tree());
    assert.equal(render(inputs), render(inputs));
  });

  test(`C1 (${label}) render reads no clock, locale or randomness, and no environment but the yaml debug switches`, () => {
    const inputs = readInputs(tree());
    const expected = render(inputs);
    const { value, envReads } = underTraps(() => render(inputs));
    assert.equal(value, expected);
    for (const k of envReads) assert.ok(YAML_DEBUG_ENV.includes(k), `render read process.env.${k}`);
  });
}

test('C1 two generator runs under different time zones, locales and yaml debug switches write identical bytes', (t) => {
  const a = scratch(t);
  const b = scratch(t);
  const ra = run(GENERATOR, [], a, { env: { TZ: 'UTC', LANG: 'C', LC_ALL: 'C' }, stdout: 'ignore' });
  const rb = run(GENERATOR, [], b, {
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

test('C1 the generator source names no clock, environment, locale, network or sort', () => {
  const src = read(GENERATOR);
  for (const re of [/\bDate\b/, /process\.env/, /\bIntl\b/, /toLocale/, /localeCompare/, /Math\.random/,
    /performance\./, /hrtime/, /\bfetch\b/, /node:(http|https|net|dns|tls|dgram)/, /\.sort\(/]) {
    assert.doesNotMatch(src, re);
  }
});

// ---------- C2: the drift check ----------

test('C2 --check exits 0 on the committed tree', () => {
  const r = run(GENERATOR, ['--check'], ROOT);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /equals a fresh generation/);
});

for (const [file, needle] of [[PAGE, 'W3C PROV-O'], ['README.md', 'Revocation of the key'], [RECORDS, 'The records this host'], [POLICY, "what https"]]) {
  test(`C2 --check exits 1 on a one-byte change to ${file} without a regeneration`, (t) => {
    const dir = scratch(t);
    flipByte(path.join(dir, file), needle);
    const r = run(GENERATOR, ['--check'], dir);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /docs\/index\.html differs from a fresh generation at line \d+:/);
  });
}

// ---------- C3: the refusal ----------

for (const [label, tree] of TREES) {
  test(`C3 (${label}) a one-byte change to any signed file is refused, naming only that file`, () => {
    const root = tree();
    const inputs = readInputs(root);
    assert.deepEqual(refusals(root, inputs), []);
    const signed = inputs.filter((i) => i.bundle);
    assert.equal(signed.length, readJson(RECORDS, root).records.length);
    for (const s of signed) {
      const changed = inputs.map((i) => (i === s ? { ...i, bytes: Buffer.concat([i.bytes, Buffer.from(' ')]) } : i));
      const out = refusals(root, changed);
      assert.equal(out.length, 1, s.file);
      assert.ok(out[0].startsWith(`${s.file}: sha256 `), out[0]);
    }
  });
}

for (const [file, needle] of [['map.yaml', 'W3C PROV-O'], ['core.md', 'Typed Standards']]) {
  test(`C3 the generator exits 2 on a one-byte change to ${file}, and writes nothing`, (t) => {
    const dir = scratch(t);
    const before = fs.readFileSync(path.join(dir, PAGE));
    flipByte(path.join(dir, file), needle);
    const bundle = readJson(RECORDS, dir).records.find((r) => r.file === file).bundle;
    const signed = readJson(`docs/${bundle}`, dir).package.contentHash.sha256;
    for (const args of [[], ['--check']]) {
      const r = run(GENERATOR, args, dir);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, new RegExp(`^refused: ${file.replace('.', '\\.')}: sha256 [0-9a-f]{64} differs from contentHash\\.sha256 ${signed}`));
      assert.equal(r.stderr.match(/^refused:/gm).length, 1, 'only the changed file is named');
    }
    assert.ok(fs.readFileSync(path.join(dir, PAGE)).equals(before));
  });
}

test('C3 (signed afresh) the generator exits 2 on a one-byte change to an edge file and to the header', (t) => {
  const dir = signedCopy(t);
  for (const [file, needle] of [['map/edges/w3c-prov-o.yaml', 'W3C PROV-O'], ['map/header.yaml', 'Typed Standards']]) {
    const d = scratch(t, dir);
    flipByte(path.join(d, file), needle);
    const r = run(GENERATOR, ['--check'], d);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, new RegExp(`^refused: ${file.replace(/[./]/g, '\\$&')}: sha256`));
  }
});

// ---------- C4: the digests ----------

for (const [label, tree] of TREES) {
  test(`C4 (${label}) the page carries one digest over the listing of every input, and the listing`, () => {
    const root = tree();
    const inputs = readInputs(root);
    const records = readJson(RECORDS, root).records;
    assert.deepEqual(inputs.map((i) => i.file), [...records.map((r) => r.file), 'README.md', RECORDS, POLICY]);
    const lines = inputs.map((i) => `${sha256(fs.readFileSync(path.join(root, i.file)))}  ${i.file}\n`).join('');
    const digest = sha256(Buffer.from(lines));
    assert.equal(listing(inputs).digest, digest);
    const line = `generated from ${inputs.length} inputs @ ${digest}`;
    assert.ok(page(root).includes(`<!-- ${line} -->`));
    assert.ok(section(visible(root), 'provenance').includes(`<code>${line}</code>`), 'the generated-from line is visible');
    assert.ok(page(root).includes(`<pre class="listing">${lines}</pre>`), 'the listing, in shasum format');
  });
}

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

for (const [label, tree] of TREES) {
  test(`C5 (${label}) the edge with a null sha256 is drawn, and listed as not pinned with its reason, outside every <details>`, () => {
    const root = tree();
    const nulls = mapDocs(root).filter((d) => /sha256: null/.test(d));
    assert.ok(nulls.length > 0);
    for (const d of nulls) {
      const name = unquote(/^ {2}name: (.*)$/m.exec(d)[1]);
      const reason = unquote(/^ {4}reason: (.*)$/m.exec(d)[1]);
      assert.match(page(root), new RegExp(`<g class="node unpinned"><title>\\d+\\. ${name.replace(/[()]/g, '\\$&')} `));
      assert.ok(pageRows(visible(root)).some((r) => r.includes(name) && r.includes(`not pinned: sha256 null. ${reason}`)), name);
    }
    assert.ok(text(section(visible(root), 'absent')).includes('Why no digest: a ref here is a file at a 40-character commit, a dated W3C TR URL, an rfc-editor.org text or a published release archive, each a location whose bytes do not change.'));
  });

  test(`C5 (${label}) no orbits edge is drawn, and the page carries the map's own edgeTypes explanation`, () => {
    const root = tree();
    const docs = mapDocs(root);
    const html = page(root);
    const svg = html.slice(html.indexOf('<svg class="map"'), html.indexOf('</svg>'));
    assert.equal((svg.match(/<line class="e rel-/g) ?? []).length, docs.length - 1);
    for (const d of docs) assert.doesNotMatch(d, /relation: orbits/);
    assert.doesNotMatch(html, /rel-orbits/);
    const edgeTypes = /^ {2}edgeTypes: (.*)$/m.exec(docs[0])[1];
    const quoted = /<blockquote>([\s\S]*?)<\/blockquote>/.exec(visible(root));
    assert.equal(quoted && text(quoted[1]), edgeTypes);
  });

  test(`C5 (${label}) the centre reads as one end of every edge and a self-assessed satellite`, () => {
    const root = tree();
    const edges = mapDocs(root).slice(1);
    const asSubject = edges.filter((d) => /^subject:\n {2}id: typedstandards\.org$/m.test(d)).length;
    const asObject = edges.filter((d) => /^object:\n {2}id: typedstandards\.org$/m.test(d)).length;
    assert.equal(asSubject + asObject, edges.length);
    const self = /^ {2}selfAssessment: (\S+)$/m.exec(read('core.md', root))[1];
    assert.match(page(root), /<text class="hub-name"[^>]*>typedstandards\.org<\/text>/);
    assert.match(page(root), new RegExp(`<text class="hub-note"[^>]*>self-assessment: ${self}</text>`));
    assert.match(page(root), new RegExp(`<text class="hub-note"[^>]*>subject of ${asSubject}, object of ${asObject}</text>`));
    assert.ok(text(visible(root)).includes(`is at the centre only because it is one end of every edge: the subject of ${asSubject} and the object of ${asObject}. Its own record, core.md, assesses it as a ${self}`));
  });

  test(`C5 (${label}) the dropped entry appears with its reason`, () => {
    const root = tree();
    const header = mapDocs(root)[0];
    const block = header.slice(header.indexOf('  dropped:\n'));
    const names = [...block.matchAll(/^ {4}- name: (.*)$/gm)].map((m) => m[1]);
    const seeds = [...block.matchAll(/^ {6}seed: (.*)$/gm)].map((m) => m[1]);
    const reasons = [...block.matchAll(/^ {6}reason: (.*)$/gm)].map((m) => unquote(m[1]));
    assert.ok(names.length > 0);
    names.forEach((n, i) => assert.ok(pageRows(visible(root)).includes(`${n} | ${seeds[i]} | ${reasons[i]}`), n));
  });
}

// D1 (ruled 2026-09-24): the proof table folds, and a visible three-bullet summary names every row, so each
// "Not covered" row, and the "Online only" row, stays outside every <details>.
test('C5/D1 the README proof table appears whole, with its definitions, and a visible summary names every row by status', () => {
  const lines = read('README.md').split('\n');
  const start = lines.indexOf('## What the records prove / what they do not');
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const sec = lines.slice(start + 1, end);
  const mdRows = sec.filter((l) => l.startsWith('|') && !/^\|[-| :]+\|$/.test(l));
  const rows = mdRows.map(mdRow);
  assert.ok(rows.length > 1);
  const proof = section(page(), 'proof');
  for (const row of rows) assert.ok(pageRows(proof).includes(row), row);
  const defs = [];
  for (const l of sec) {
    const m = /^\*\*([^*]+)\*\* ?(.*)$/.exec(l);
    if (m) defs.push([m[1], m[2]]);
    else if (defs.length && l.trim() && !l.startsWith('|')) defs[defs.length - 1][1] += ` ${l.trim()}`;
    else if (!l.trim() && defs.length) break;
  }
  assert.ok(defs.length > 0);
  const onPage = [...proof.matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => [text(m[1]), text(m[2])]);
  assert.deepEqual(onPage, defs.map(([t, d]) => [plain(t), plain(d)]));
  // The summary: three bullets, visible, each row's first cell under its status.
  const summary = /<ul class="summary">([\s\S]*?)<\/ul>/.exec(section(visible(), 'proof'));
  assert.ok(summary, 'the summary is outside every <details>');
  const bullets = [...summary[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
  assert.equal(bullets.length, 3);
  const cells = mdRows.map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(plain));
  const lower = (s) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  const where = { Attested: 0, Asserted: 1, 'Not covered': 2, 'Online only': 2 };
  for (const [property, status] of cells.slice(1)) {
    const s = Object.keys(where).find((k) => status === k || status.startsWith(`${k} `) || status.startsWith(`${k},`));
    assert.ok(s, `${property}: ${status}`);
    assert.ok(bullets[where[s]].includes(`${s},`) && bullets[where[s]].includes(lower(property)), `${property} is named under ${s}`);
  }
  const notCovered = cells.filter(([, s]) => s === 'Not covered').map(([p]) => lower(p));
  assert.ok(notCovered.length >= 4);
  for (const p of notCovered) assert.ok(text(section(visible(), 'proof')).includes(p), p);
});

// ---------- the phase 3 form: opening, records, policy, registry, links ----------

test('the sections come in this round\'s order: the opening, the two questions and the map first; the mechanics and the proof table fold', () => {
  assert.deepEqual([...page().matchAll(/<section id="([\w-]+)"/g)].map((m) => m[1]),
    ['questions', 'map', 'rules', 'how', 'absent', 'core', 'records', 'mechanics', 'proof', 'provenance']);
  assert.match(section(page(), 'mechanics'), /^<section id="mechanics">\n<details class="fold"><summary><h2>Versions, withdrawals and the host's rule<\/h2><\/summary>/);
  assert.equal(text(section(visible(), 'mechanics')), '', 'the mechanics section starts closed');
  assert.doesNotMatch(page(), /<details[^>]*\sopen\b/, 'every disclosure starts closed');
});

// The paper's words the page quotes, verbatim from the dated read the generator names (checked against that
// read at G1; the read itself is not committed).
const QUOTES = [
  'The agent pulls SMRS v3 by its content hash, not by a URL that might have moved or been edited since.',
  'Any participant can endorse a core, or withdraw a prior endorsement — append-only and attributable.',
  '…stamped with provenance that marks it agent-generated and human-validated.',
  'One library or repo surfacing a record is, in spirit, a satellite.',
];
const INLINE_QUOTES = [
  'cryptoseal was an orbits / critical-dependency edge',
  'recognize an artifact, depend on it, or map it',
  'how satellites declare or are recognized as orbiting a core',
];
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

for (const [label, tree] of TREES) {
  test(`D6/note 1 (${label}) the page opens with the model, what this page is, what Typed Standards is and what its record says; then the offline check and the newest change`, () => {
    const root = tree();
    const records = readJson(RECORDS, root).records;
    const current = records.filter((r) => r.status === 'active' && r.role !== 'map-v1').length;
    const withdrawn = records.filter((r) => r.status === 'withdrawn').length;
    const html = /<main>\n<header>([\s\S]*?)<\/header>/.exec(page(root))[1];
    const opening = text(html);
    const self = /^ {2}selfAssessment: (\S+)$/m.exec(read('core.md', root))[1];
    const lede = text(/<p class="lede">([\s\S]*?)<\/p>/.exec(html)[1]);
    assert.equal(lede, [
      'SciOS\'s paper The Core-Satellite Model describes open source and open science as cores, groups of people who hold a domain\'s judgment, and satellites, individuals or groups who each work on one artifact and orbit one or more cores.',
      'This page is a worked example: Typed Standards records used to describe Typed Standards\' own position in that model.',
      'Typed Standards is an open standard for signed records of how an analytical artifact was produced (the specification, a v0.1 working draft), with a reference producer and verifier (typedstandards) and a reference publishing application (civic-ai-tools-website).',
      `Applied to itself, the model places Typed Standards as a ${self}: its signed record, core.md, says so and gives its basis.`,
    ].join(' '));
    for (const href of ['https://scios.tech/thoughts', 'https://typedstandards.org', 'https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/typed-standards-specification.md',
      'https://github.com/npstorey/typedstandards', 'https://github.com/npstorey/civic-ai-tools-website', '#basis']) {
      assert.ok(html.includes(`<a href="${href}">`), href);
    }
    assert.match(page(root), /<h3 id="basis">/);
    assert.doesNotMatch(lede, /\breturns?\b/, 'the model is not a procedure that returns a result');
    assert.match(html, /<pre class="command"><code>npm ci &amp;&amp; node verify\.mjs<\/code><\/pre>/);
    assert.ok(opening.includes(`Check every record offline (${current} current record${current === 1 ? '' : 's'} and version 1${withdrawn ? `, and ${withdrawn} withdrawn` : ''}), in a clone of github.com/npstorey/typedstandards-core-satellite-example`), opening);
    const newest = records.filter((r) => r.step === records[records.length - 1].step);
    assert.ok(opening.includes(`Newest change: version ${newest[0].step}, ${eastern(newest[0].createdAt)}:`), opening);
    assert.ok(opening.includes(`(${newest.length} record${newest.length === 1 ? '' : 's'})`), opening);
    assert.ok(opening.includes(ZONE_RULE), 'the zone rule stands beside the first time the page shows');
    assert.ok(page(root).indexOf('</header>\n<section id="questions"') < page(root).indexOf('<section id="map"'));
  });

  test(`D9 (${label}) every quotation of the paper is verbatim from the pinned list, marked, attributed and linked, with its read date`, () => {
    const p = page(tree());
    const blocks = [...p.matchAll(/<figure class="quote"><blockquote cite="([^"]+)"><p>“([^”]+)”<\/p><\/blockquote><figcaption>([\s\S]*?)<\/figcaption><\/figure>/g)];
    assert.deepEqual(blocks.map((m) => decode(m[2])), QUOTES);
    for (const m of blocks) {
      assert.equal(m[1], 'https://scios.tech/thoughts');
      assert.match(m[3], /^SciOS, <a href="https:\/\/scios\.tech\/thoughts"><i>The Core-Satellite Model<\/i><\/a>, .+ \(dated 2026-06-30, read 2026-09-22\)\.$/);
    }
    assert.deepEqual([...p.matchAll(/<q cite="https:\/\/scios\.tech\/thoughts">([^<]+)<\/q>/g)].map((m) => decode(m[1])), INLINE_QUOTES);
    assert.equal((p.match(/<blockquote cite=/g) ?? []).length, QUOTES.length);
  });

  test(`D9 (${label}) the two questions carry counts measured from the drawn edges, beside the header's own edgeTypes text`, () => {
    const root = tree();
    const edges = mapDocs(root).slice(1);
    const inward = edges.filter((d) => !/^subject:\n {2}id: typedstandards\.org$/m.test(d));
    const location = (d) => /^subject:\n {2}id: .*\n {2}ref:\n {4}location: (.*)$/m.exec(d)[1];
    const same = inward.filter((d) => location(d).startsWith('https://raw.githubusercontent.com/npstorey/')).length;
    const questions = text(section(visible(root), 'questions'));
    assert.ok(questions.startsWith('Two questions from building this map'), questions);
    assert.ok(questions.includes('A report from implementation, not a review'), questions);
    assert.ok(questions.includes(`This map's ${edges.length} edges run between artifacts and standards, in both directions, with no core at either end.`), questions);
    assert.ok(questions.includes(`One key signs all ${edges.length} edges drawn here. typedstandards.org is the subject of ${edges.length - inward.length}.`), questions);
    assert.ok(questions.includes(`name another project as subject: ${WORDS[same]} whose sources are in the same GitHub account as this repository, and two, qsv and Verikan, published by datHere.`), questions);
    assert.ok(text(section(visible(root), 'absent')).startsWith('What the map leaves out No orbits edge'));
    const asked = text(/<ol class="questions">([\s\S]*?)<\/ol>/.exec(page(root))[1]);
    assert.doesNotMatch(asked, /partner|adopt|conversation|meeting|outreach|contact|reached out/i);
  });

  test(`D9 (${label}) the legend gives the reading rule, naming every relation whose definition says neither depends on the other`, () => {
    const root = tree();
    const hdr = mapDocs(root)[0];
    const block = hdr.slice(hdr.indexOf('  relations:\n'), hdr.indexOf('  rings:\n'));
    const rels = [...block.matchAll(/^ {4}([\w-]+): (.*)$/gm)].map((m) => [m[1], unquote(m[2])]);
    const neither = rels.filter(([, d]) => /Neither depends on the other\b/.test(d)).map(([n]) => n);
    assert.ok(neither.length > 1);
    const legend = text(/<ul class="legend">([\s\S]*?)<\/ul>/.exec(page(root))[1]);
    assert.ok(legend.includes(`Every edge runs from subject to object, the direction of the paper's orbits edge, from satellite to core. An arrowhead marks builds-on and points at the object: A → B reads “A builds-on B”. ${andList(neither)} each say neither depends on the other, so their lines have no head; the tables give each edge's direction.`), legend);
    for (const [name] of rels) assert.match(legend, new RegExp(`${name} \\(\\d+\\), (circle|square|hexagon|diamond|triangle) and (solid|dotted|dash-dot) line with (an arrowhead|no head)\\.`), name);
    assert.ok(text(page(root)).includes('The rings group each edge\'s other end by kind, as the header defines them. A ring is not a distance or a rank, and none is an orbit'));
  });

  test(`D6 (${label}) every record has a verifier link to its served bundle, and every link is one the site fetches as given`, () => {
    const root = tree();
    const served = readJson(RECORDS, root);
    // Every link to the verifier with a target; the footer's plain link to the verifier page has none.
    const links = [...page(root).matchAll(/<a href="(https:\/\/typedstandards\.org\/verify\?[^"]*)">/g)].map((m) => decode(m[1]));
    assert.ok(page(root).includes('<a href="https://typedstandards.org/verify">typedstandards.org/verify</a>'));
    assert.ok(links.length >= served.records.length);
    const targets = new Set();
    for (const href of links) {
      const u = new URL(href);
      assert.equal(`${u.origin}${u.pathname}`, 'https://typedstandards.org/verify', href);
      assert.deepEqual([...u.searchParams.keys()], ['url'], href);
      const bundle = new URL(u.searchParams.get('url'));
      assert.equal(`${bundle.origin}/`, served.host, href);
      // verify-flow.ts classifyHostedUrl: a /commitment path, a 64-hex .json filename, or a /records/ or
      // /evidence/ segment would each make the site resolve something other than this file.
      assert.doesNotMatch(bundle.pathname, /\/commitment$/, href);
      assert.doesNotMatch(bundle.pathname, /[0-9a-f]{64}\.json$/i, href);
      assert.doesNotMatch(bundle.pathname, /\/(records|evidence)\//, href);
      assert.equal(bundle.search + bundle.hash, '', href);
      const file = path.join(root, 'docs', bundle.pathname.slice(1));
      assert.ok(fs.existsSync(file), `${href} names a file docs/ does not serve`);
      targets.add(bundle.pathname.slice(1));
    }
    for (const r of served.records) assert.ok(targets.has(r.bundle), `${r.name} has no verifier link`);
  });

  // D2 (ruled 2026-09-24): the records table stays open, one row per record, each with a stable anchor from
  // the record's name and its verifier link; the per-ring edge lists fold and link to those rows.
  test(`D2 (${label}) every record has one row, outside every <details>, anchored by its name and carrying its verifier link`, () => {
    const root = tree();
    const served = readJson(RECORDS, root);
    const html = page(root);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1]));
    assert.equal(new Set(ids).size, ids.length, 'every id on the page is unique');
    const table = /<table class="stack records">([\s\S]*?)<\/table>/.exec(section(visible(root), 'records'));
    assert.ok(table, 'the records table is outside every <details>');
    const rows = [...table[1].matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g)].map((m) => [decode(m[1]), m[2]]);
    assert.deepEqual(rows.map(([id]) => id), served.records.map((r) => `record-${r.name.replace(/\//g, '-')}`), 'one row per record, in signing order');
    for (const [id] of rows) assert.match(id, /^[a-z0-9-]+$/, 'an anchor of letters, digits and dashes');
    served.records.forEach((r, i) => {
      assert.ok(rows[i][1].includes(`<a href="https://typedstandards.org/verify?url=${served.host}${r.bundle}">verify</a>`), r.name);
      const shownAs = r.status === 'withdrawn' ? 'withdrawn' : (r.role === 'map-v1' ? 'version 1' : 'current');
      const cells = [...rows[i][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
      assert.deepEqual(cells.slice(1), [String(r.step), shownAs, 'verify'], r.name);
    });
    // Every link to a record row, from the figure's key and the per-ring lists, lands on a row.
    const targets = [...html.matchAll(/<a href="#(record-[^"]+)">/g)].map((m) => decode(m[1]));
    assert.ok(targets.length >= 2 * (mapDocs(root).length - 1));
    for (const t of targets) assert.ok(rows.some(([id]) => id === t), t);
  });

  test(`D7/D3 (${label}) the identity bar carries affiliation only; the check box and the footer say why the verifier reads "Unknown publisher"; the registry and policy sentences stay visible`, () => {
    const root = tree();
    const served = readJson(RECORDS, root);
    const footer = /<footer class="site">([\s\S]*?)<\/footer>/.exec(page(root))[1];
    const foot = text(footer);
    const signer = /^signer: (\S+)$/m.exec(read(POLICY, root))[1];
    assert.ok(foot.includes(`Publisher. The records are signed with this example's own key, ${signer}. The host's registry lists it as active; that is this example's own statement, not an endorsement by the Typed Standards specification or by typedstandards.org. The registry's host, ${new URL(served.trustRegistryUrl).host}, is not listed in typedstandards.org's host directory, so typedstandards.org's verifier reads “Unknown publisher”, which it reports separately from the signature checks.`), foot);
    for (const href of ['https://github.com/npstorey/typedstandards-core-satellite-example', 'https://typedstandards.org/verify', '.well-known/typed-publisher.json', 'host-policy.yaml', 'fonts/README.md']) {
      assert.ok(footer.includes(`<a href="${href}">`), href);
    }
    assert.ok(foot.includes('Host policy: host-policy.yaml, the host\'s own display rule, not signed'), foot);
    assert.ok(foot.includes('Text: CC BY 4.0. Code: MIT. Typefaces: Space Grotesk and Noto Sans, SIL Open Font License 1.1'), foot);
    const bar = /<header class="idbar">([\s\S]*?)<\/header>/.exec(page(root))[1];
    // The identity bar carries affiliation only; the key is explained where the page first points to the
    // verifier, and in the footer.
    assert.equal(bar, '\n<div class="bar"><a class="wordmark" href="https://typedstandards.org" aria-label="Typed Standards">Typed<span>Standards</span></a><p>A worked example from the Typed Standards project.</p></div>\n');
    assert.match(footer, /<p id="publisher">/);
    const html = page(root);
    const pointer = html.indexOf('Each record also links to typedstandards.org\'s verifier.');
    const firstVerify = html.search(/<a href="https:\/\/typedstandards\.org\/verify\?url=/);
    assert.ok(pointer > 0 && pointer < firstVerify, 'the check box is the first place the page points to the verifier');
    const note = /<div class="check">[\s\S]*?<p class="note">([\s\S]*?)<\/p>/.exec(html)[1];
    assert.ok(text(note).includes('Each record also links to typedstandards.org\'s verifier. Records are signed with this example\'s own key, so the verifier reads “Unknown publisher” and checks every signature anyway. That is what a key-derived identity means.'), text(note));
    assert.match(note, /<a href="#publisher">“Unknown publisher”<\/a>/);
    // The page leads with its opening sentences: the repository's name first appears in the check command's line,
    // and the footer names it too.
    const repo = 'typedstandards-core-satellite-example';
    assert.ok(html.indexOf(repo) > html.indexOf('<p class="lede">'), 'no repository-name line comes before the opening');
    assert.ok(html.indexOf(repo) < html.indexOf('<pre class="command">'), 'the repository is named in the check command\'s line');
    assert.ok(foot.includes(`Repository: github.com/npstorey/${repo}`), foot);
    // The mechanics section, closed, keeps the full sentences and every version.
    const mech = text(section(page(root), 'mechanics'));
    assert.ok(mech.includes('What this page shows, and how, follows docs/host-policy.yaml: the host\'s own display rule. It is not a Typed Standards record'), mech);
    assert.ok(mech.includes('is the example publisher\'s own statement that the key is active. It is not an endorsement by the Typed Standards specification or by typedstandards.org, although this host is a subdomain of typedstandards.org.'), mech);
    const steps = [...new Set(served.records.map((r) => r.step))];
    for (const s of steps) {
      const first = served.records.find((r) => r.step === s);
      assert.ok(mech.includes(`Version ${s}, ${eastern(first.createdAt)}: `), `version ${s}`);
    }
    const withdrawn = served.records.filter((r) => r.status === 'withdrawn');
    assert.ok(mech.includes(`Withdrawn (${withdrawn.length})`));
    for (const r of withdrawn) assert.ok(mech.includes(`withdrawn ${eastern(r.withdrawn.at)}: ${r.withdrawn.reason} Its row.`), r.name);
  });
}

test('D8 each forbidden phrase is absent from the page and README.md, and the generator refuses a page that would carry one', (t) => {
  for (const [label, tree] of TREES) {
    for (const p of FORBIDDEN) {
      assert.ok(!page(tree()).toLowerCase().includes(p), `${label}: the page says "${p}"`);
      assert.ok(!read('README.md', tree()).toLowerCase().includes(p), `${label}: README.md says "${p}"`);
    }
  }
  for (const p of FORBIDDEN) {
    const dir = scratch(t);
    const readme = read('README.md', dir);
    const at = readme.indexOf('**How it was made.**');
    fs.writeFileSync(path.join(dir, 'README.md'), `${readme.slice(0, at)}The records are ${p.toUpperCase()} someone. ${readme.slice(at)}`);
    const r = run(GENERATOR, [], dir);
    assert.equal(r.status, 2, p);
    assert.match(r.stderr, new RegExp(`refused: the page would say "${p}"`));
  }
});

test('D9 the rules section says which rules are not implemented, which is not the paper\'s, and gives no count a commit would change', () => {
  const rules = section(visible(), 'rules');
  const items = [...rules.matchAll(/<li><h3>([^<]+)<\/h3>([\s\S]*?)<\/li>/g)].map((m) => [decode(m[1]), text(m[2])]);
  assert.deepEqual(items.map(([h]) => h), ['Refs by content hash', 'Endorsements', 'Agent contributions', 'Identifiers']);
  const here = (i) => items[i][1].slice(items[i][1].indexOf('Here:'));
  assert.ok(here(1).startsWith('Here: not built. This example makes no endorsement.'), here(1));
  assert.ok(here(2).startsWith('Here: not implemented. No record here marks anything as agent-generated or human-validated.'), here(2));
  assert.ok(here(2).includes('The repository\'s commits name the AI assistant in a co-author line; the records carry no such mark.'), here(2));
  assert.doesNotMatch(here(2), /\d/);
  assert.ok(here(3).includes('this example\'s choice, not the paper\'s'), here(3));
  assert.doesNotMatch(text(rules), /partner|conversation|meeting|outreach|contact|reached out/i);
});

test('the generator refuses two current map-header records', (t) => {
  const dir = signedCopy(t);
  const file = path.join(dir, RECORDS);
  const served = JSON.parse(fs.readFileSync(file, 'utf8'));
  const first = served.records.find((r) => r.name === 'map/header');
  assert.equal(first.status, 'withdrawn');
  first.status = 'active';
  delete first.withdrawn;
  fs.writeFileSync(file, `${JSON.stringify(served, null, 2)}\n`);
  const before = fs.readFileSync(path.join(dir, PAGE));
  const r = run(GENERATOR, [], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /refused: docs\/host-policy\.yaml: 2 current map-header records \(map\/header\.yaml, map\/header-2\.yaml\); the map has one header/);
  assert.ok(fs.readFileSync(path.join(dir, PAGE)).equals(before));
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

for (const [label, tree] of TREES) {
  test(`(${label}) the edges, ring by ring: one closed disclosure per ring holds its drawn edges in order, each linked to its record's row`, () => {
    const root = tree();
    const edges = mapDocs(root).slice(1).map((d) => {
      const get = (re) => unquote(re.exec(d)[1]);
      const subject = get(/^subject:\n {2}id: (.*)$/m);
      const outward = subject === 'typedstandards.org';
      const far = d.slice(d.indexOf(outward ? '\nobject:' : '\nsubject:') + 1);
      return {
        name: get(/^ {2}name: (.*)$/m),
        publisher: get(/^ {2}publisher: (.*)$/m),
        ring: get(/^ {2}ring: (.*)$/m),
        relation: get(/^ {2}relation: (.*)$/m),
        basis: get(/^ {2}basis: (.*)$/m),
        arrow: outward ? '→' : '←',
        id: unquote(/^ {2}id: (.*)$/m.exec(far)[1]),
        location: unquote(/^ {4}location: (.*)$/m.exec(far)[1]),
        sha: /^ {4}sha256: (.*)$/m.exec(far)[1],
      };
    });
    const captions = [...page(root).matchAll(/<textPath href="#ring-arc-\d+" startOffset="50%">Ring (\d+): ([^<]+)<\/textPath>/g)].map((m) => [m[1], decode(m[2])]);
    const rings = [...new Set(edges.map((e) => e.ring))];
    assert.deepEqual(captions.map(([r]) => r), rings);
    const numbered = edges.map((e, i) => ({ ...e, n: i + 1 }));
    let seen = 0;
    for (const [ring, caption] of captions) {
      const mine = numbered.filter((e) => e.ring === ring);
      const details = new RegExp(`<details id="ring-${ring}"><summary>Ring ${ring} \\((\\d+)\\): ([^<]+)</summary>([\\s\\S]*?)</details>`).exec(page(root));
      assert.ok(details, `ring ${ring} has one closed disclosure`);
      assert.deepEqual([Number(details[1]), decode(details[2])], [mine.length, caption]);
      const rows = pageRows(details[3]);
      assert.equal(rows[0], '# | Name | Relation | Basis | Location and SHA-256 | Record');
      assert.equal(rows.length - 1, mine.length);
      assert.deepEqual(rows.slice(1).map((r) => Number(r.split(' | ')[0])), mine.map((e) => e.n), `ring ${ring}'s edges, in signing order`);
      mine.forEach((e) => {
        seen += 1;
        const row = rows.find((r) => r.startsWith(`${e.n} | `));
        assert.ok(row.startsWith(`${e.n} | ${e.name}${e.publisher}${e.id} | ${e.arrow} ${e.relation} | ${e.basis}`), row);
        assert.ok(row.includes(e.location) && (e.sha === 'null' ? row.includes('not pinned: sha256 null.') : row.includes(e.sha)), row);
        assert.ok(row.endsWith(' | record'), row);
      });
    }
    assert.equal(seen, edges.length);
    assert.equal(text(section(visible(root), 'map')).includes('Ring 1 (7): Typed Standards builds on these'), false, 'the per-ring lists start closed');
  });
}

test('table cells wrap at word boundaries; links and code in cells, and cells at phone width, break anywhere', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(page())[1];
  assert.match(css, /\nth,td\{[^}]*overflow-wrap:normal[^}]*\}/);
  assert.match(css, /\ntd a,td code\{overflow-wrap:anywhere\}/);
  assert.match(css, /table\.records td:nth-child\(2\),table\.records td:nth-child\(3\),table\.records td:nth-child\(4\)[^{]*\{white-space:nowrap\}/);
  const phone = css.slice(css.indexOf('@media (max-width:44rem)'));
  assert.match(phone, /table\.stack td\{[^}]*overflow-wrap:anywhere[^}]*\}/);
  assert.match(phone, /table\.stack td\[data-label\]::before\{content:attr\(data-label\)/);
  assert.match(css, /pre\.listing\{[^}]*overflow-x:auto[^}]*\}/);
});

test('G2 preparation: docs/CNAME names the custom domain exactly, docs/.nojekyll is empty, README gives the URL', () => {
  assert.equal(read('docs/CNAME'), 'core-satellite.typedstandards.org');
  assert.equal(fs.statSync(path.join(ROOT, 'docs', '.nojekyll')).size, 0);
  assert.ok(read('README.md').includes('https://core-satellite.typedstandards.org/'));
});

// ---------- C6: self-contained; escaping ----------

// D5 (ruled 2026-09-24): the site's typefaces, as committed subset files under docs/, with the licence each
// states beside them, and no request to any outside host.
for (const [label, tree] of TREES) {
  test(`C6/D5 (${label}) the page is self-contained: nothing in it loads on open but its own two font files`, () => {
    const root = tree();
    const p = page(root);
    assert.ok(p.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src data:; base-uri 'none'; form-action 'none'">`));
    for (const re of [/<script/i, /<iframe/i, /<frame/i, /<object/i, /<embed/i, /<img/i, /<image/i, /<picture/i,
      /<video/i, /<audio/i, /<source/i, /<track/i, /<use\b/i, /<form/i, /<base\b/i, /<portal/i, /\bsrcset=/i, /\bsrc=/i,
      /\bposter=/i, /\bbackground=/i, /@import/i, /http-equiv="refresh"/i, /xlink:href/i, /\bping=/i]) {
      assert.doesNotMatch(p, re);
    }
    // The only @font-face rules are the two FONTS entries, and each url() is a same-document fragment or one of
    // their files, relative to the page.
    const faces = [...p.matchAll(/@font-face\{([^}]*)\}/g)].map((m) => m[1]);
    assert.deepEqual(faces, FONTS.map((f) => `font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${f.file}) format("woff2")`));
    const files = FONTS.map((f) => f.file);
    for (const m of p.matchAll(/url\(([^)]*)\)/g)) assert.ok(/^#[\w-]+$/.test(m[1]) || files.includes(m[1]), `url(${m[1]})`);
    for (const f of files) assert.ok(fs.existsSync(path.join(root, 'docs', f)), f);
    for (const m of p.matchAll(/<link\b[^>]*>/g)) assert.equal(m[0], '<link rel="icon" href="data:,">');
    for (const m of p.matchAll(/<(\w+)\b[^>]*\shref="([^"]*)"/g)) {
      assert.ok(['a', 'link'].includes(m[1]) || (m[1] === 'textPath' && /^#ring-arc-\d+$/.test(m[2])), `href on <${m[1]}>`);
    }
  });
}

test('D5 each font file is the one docs/fonts/README.md lists, with its licence beside it', () => {
  const readme = read('docs/fonts/README.md');
  for (const f of FONTS) {
    const name = path.basename(f.file);
    const row = new RegExp(`^\\| \`${name.replace('.', '\\.')}\` \\| \`([0-9a-f]{64})\` \\| (\\d+) \\| SIL Open Font License 1\\.1, \`(OFL-[\\w]+\\.txt)\` \\|$`, 'm').exec(readme);
    assert.ok(row, `${name} is listed`);
    const bytes = fs.readFileSync(path.join(ROOT, 'docs', f.file));
    assert.deepEqual([sha256(bytes), bytes.length], [row[1], Number(row[2])], name);
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${name} is woff2`);
    const licence = read(`docs/fonts/${row[3]}`);
    assert.match(licence, /^Copyright \d{4} The .+ Authors/);
    assert.ok(licence.includes('SIL OPEN FONT LICENSE Version 1.1'), row[3]);
    assert.doesNotMatch(licence.split('\n')[0], /Reserved Font Name/, 'no reserved name, so a subset may keep the name');
  }
});

test('C6 input text is escaped, and only code spans and bold are rendered', (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'README.md');
  const planted = '<b>x</b> [a link](https://example.org) *em* _u_ # h `c` **b** <script>';
  fs.writeFileSync(file, read('README.md', dir).replace('| Revocation of the key |', `| Revocation ${planted} of the key |`));
  const r = run(GENERATOR, [], dir);
  assert.equal(r.status, 0, r.stderr);
  const p = read(PAGE, dir);
  assert.ok(p.includes('Revocation &lt;b&gt;x&lt;/b&gt; [a link](https://example.org) *em* _u_ # h <code>c</code> <strong>b</strong> &lt;script&gt; of the key'));
  assert.doesNotMatch(p, /<b>x|<script|href="https:\/\/example\.org"/);
});

// ---------- this round: times, the figure's encoding, ring captions, ring-3 fill ----------

// Note 2: signed timestamps shown in US Eastern time with UTC beside them. The generator applies the zone rule
// by arithmetic (C1 keeps Intl out of it); here Intl, with the zone named, checks every time the page can show.
test('eastern() equals Intl\'s America/New_York reading of every signed timestamp and of the daylight-saving boundaries', () => {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const byIntl = (iso) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${Number(p.day)} ${p.month} ${p.year}, ${p.hour}:${p.minute} ET (${iso.slice(0, 16)}Z)`;
  };
  const records = readJson(RECORDS).records;
  const times = [...records.map((r) => r.createdAt), ...records.filter((r) => r.withdrawn).map((r) => r.withdrawn.at),
    '2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z', '2026-11-01T05:59:59Z', '2026-11-01T06:00:00Z',
    '2026-12-31T23:59:00Z', '2027-01-01T04:59:00Z', '2027-01-01T05:00:00Z', '2028-02-29T12:00:00Z', '2007-03-11T07:00:00Z'];
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2029, 0, 1); ms += 211 * 60000) times.push(new Date(ms).toISOString());
  for (const t of times) assert.equal(eastern(t), byIntl(t), t);
  assert.equal(eastern('2026-09-24T01:52:31.397Z'), '23 September 2026, 21:52 ET (2026-09-24T01:52Z)');
  assert.throws(() => eastern('2026-09-24 01:52'), /not a UTC timestamp/);
  assert.throws(() => eastern('2006-06-01T00:00:00Z'), /holds from 2007/);
});

test('every signed timestamp on the page is shown in US Eastern time with UTC beside it, and none in any other form', () => {
  const p = page();
  const records = readJson(RECORDS).records;
  for (const r of records.filter((x) => x.withdrawn)) assert.ok(p.includes(eastern(r.withdrawn.at)), r.name);
  assert.doesNotMatch(p, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'no raw signed timestamp');
  const shown = [...p.matchAll(/(\d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2}) ET \((\d{4}-\d{2}-\d{2}T\d{2}:\d{2})Z\)/g)];
  assert.ok(shown.length >= 3 + records.filter((x) => x.withdrawn).length);
  for (const m of shown) assert.equal(eastern(`${m[2]}Z`), m[0]);
  // The zone rule is the paragraph right after the one holding the first time shown.
  const rule = p.indexOf(ZONE_RULE);
  assert.ok(shown[0].index < rule && shown[1].index > rule, 'the rule comes after the first time shown and before the second');
  assert.equal((p.slice(shown[0].index, rule).match(/<\/p>/g) ?? []).length, 1);
});

// Note 5: arrowheads only on builds-on; complements and adjacent solid with no head, told apart by shape;
// writes-recordable-output dotted with no head; only current edges drawn.
for (const [label, tree] of TREES) {
  test(`note 5 (${label}) the figure draws only current edges, with an arrowhead on builds-on alone`, () => {
    const root = tree();
    const p = page(root);
    const svg = p.slice(p.indexOf('<svg class="map"'), p.indexOf('</svg>'));
    const css = /<style>([\s\S]*?)<\/style>/.exec(p)[1];
    assert.deepEqual([...svg.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]), ['arrow-builds-on']);
    assert.match(css, /\.e\.rel-builds-on\{marker-end:url\(#arrow-builds-on\)\}/);
    for (const rel of ['complements', 'adjacent']) assert.doesNotMatch(css, new RegExp(`\\.e\\.rel-${rel}\\{`), `${rel} is a plain solid line`);
    assert.match(css, /\.e\.rel-writes-recordable-output\{stroke-dasharray:1 4;stroke-linecap:round;[^}]*\}/);
    assert.doesNotMatch(css, /\.e\.rel-writes-recordable-output\{[^}]*marker-end/);
    const current = readJson(RECORDS, root).records.filter((r) => r.role === 'edge' && r.status === 'active').length;
    assert.equal((svg.match(/<line class="e rel-/g) ?? []).length, current);
    assert.doesNotMatch(svg, /rel-could-emit/, 'the withdrawn could-emit edge is not drawn');
    const shapes = { complements: 'rect', adjacent: 'path' };
    for (const [rel, el] of Object.entries(shapes)) assert.match(svg, new RegExp(`<${el} class="mark rel-${rel}"`));
  });
}

// D3: ring 1 and ring 2 captions from the policy, ring 3's from the signed header; a caption the drawn edges do
// not bear out is refused.
test('D3 the ring captions are drawn in the figure: ring 1 and ring 2 as the policy words them, ring 3 as the signed header defines it', () => {
  const caps = [...page().matchAll(/<textPath href="#ring-arc-(\d+)" startOffset="50%">([^<]+)<\/textPath>/g)].map((m) => decode(m[2]));
  const ring3 = /^ {4}3: (.*)$/m.exec(read('map/header-2.yaml'))[1];
  assert.deepEqual(caps, ['Ring 1: Typed Standards builds on these', 'Ring 2: neither builds on the other', `Ring 3: ${ring3}`]);
  assert.equal(ring3, 'Implementations, tools and agent runtimes.');
  assert.doesNotMatch(page(), /could produce/, 'no caption states another project\'s plans');
});

test('D3 the generator refuses a ring caption that a drawn edge does not bear out', (t) => {
  const dir = scratch(t);
  const file = path.join(dir, POLICY);
  fs.writeFileSync(file, read(POLICY, dir).replace('{ ring: 2, caption: neither builds on the other, holds: neither-depends }', '{ ring: 3, caption: Typed Standards builds on these, holds: subject-builds-on }'));
  const r = run(GENERATOR, ['--check'], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^refused: docs\/host-policy\.yaml: no caption for ring 2/m);
  fs.writeFileSync(file, read(POLICY).replace('{ ring: 3, caption: header }', '{ ring: 3, caption: Typed Standards builds on these, holds: subject-builds-on }'));
  const r2 = run(GENERATOR, ['--check'], dir);
  assert.equal(r2.status, 2, r2.stderr);
  assert.match(r2.stderr, /^refused: docs\/host-policy\.yaml: ring 3's caption "Typed Standards builds on these" does not hold for typedstandards\.org\/map\/civicaitools-org, typedstandards\.org\/map\/socrata-mcp-server, /m);
});

// D4: ring-3 nodes filled when the pinned file shows the project publishing signed records, with the lines cited
// on the page; hollow otherwise; the classes declared in the host policy.
for (const [label, tree] of TREES) {
  test(`D4 (${label}) ring-3 nodes are filled exactly as the host policy declares, each with its quoted lines, and every other ring-3 node is hollow`, () => {
    const root = tree();
    const p = page(root);
    const fill = /^fill:\n([\s\S]*)$/m.exec(read(POLICY, root))[1];
    const ids = [...fill.matchAll(/^ {4}- id: (.*)$/gm)].map((m) => m[1]);
    const quotes = [...fill.matchAll(/^ {6}quote: (.*)$/gm)].map((m) => unquote(m[1]));
    const edges = mapDocs(root).slice(1);
    const ring3 = edges.map((d, i) => ({ d, n: i + 1 })).filter(({ d }) => /^ {2}ring: 3$/m.test(d));
    const farId = (d) => {
      const subject = /^subject:\n {2}id: (.*)$/m.exec(d)[1];
      return subject === 'typedstandards.org' ? /^object:\n {2}id: (.*)$/m.exec(d)[1] : subject;
    };
    const svg = p.slice(p.indexOf('<svg class="map"'), p.indexOf('</svg>'));
    const filledNodes = [...svg.matchAll(/<g class="node filled[^"]*"><title>(\d+)\./g)].map((m) => Number(m[1]));
    assert.deepEqual(filledNodes, ring3.filter(({ d }) => ids.includes(farId(d))).map(({ n }) => n));
    assert.equal(filledNodes.length, 2);
    const block = text(p.slice(p.indexOf('<h3 id="fill">'), p.indexOf('<h3 id="edges">')));
    assert.ok(visible(root).includes('<h3 id="fill">'), 'the cited lines are outside every <details>');
    assert.ok(block.includes('The host\'s reading of each project\'s pinned file, declared in host-policy.yaml. It is not a signed statement.'), block);
    for (const q of quotes) assert.ok(block.includes(`“${q}”`) || p.includes(`>${q.replace(/'/g, '&#39;')}</q>`), q);
    assert.ok(block.includes(`Hollow (${ring3.length - filledNodes.length}): no signed records shown in its pinned files.`), block);
    assert.ok(block.includes('which has no pinned file'), 'the ring-3 node with no pinned file says so');
  });
}

test('D4 the generator refuses a fill whose cited ref is not the node\'s signed ref', (t) => {
  const dir = scratch(t);
  const file = path.join(dir, POLICY);
  fs.writeFileSync(file, read(POLICY, dir).replace('sha256: ba16dd52cf07fe369bf6359d22bfe36bae345614179fd14d5e814ac481cde89f', `sha256: ${'0'.repeat(64)}`));
  const r = run(GENERATOR, ['--check'], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^refused: docs\/host-policy\.yaml: fill cites .* for civicaitools\.org, which is not the ref map\/edges\/civicaitools-org\.yaml gives/m);
});

// The quoted lines are verbatim from the pinned bytes. data/ is git-ignored, so this runs where the pinned
// bytes are on disk (the owner's clone) and is skipped elsewhere, CI included.
test('D4 each fill quotation is verbatim from the named lines of the pinned file', (t) => {
  const manifest = readJson('corpus/manifest.json');
  const fill = /^fill:\n([\s\S]*)$/m.exec(read(POLICY))[1];
  const entries = fill.split(/^ {4}- /m).slice(1).map((e) => Object.fromEntries([...e.matchAll(/^(?: {6})?(\w+): (.*)$/gm)].map((m) => [m[1], unquote(m[2])])));
  assert.equal(entries.length, 2);
  for (const e of entries) {
    const source = manifest.sources.find((s) => s.sha256 === e.sha256 && s.location === e.location);
    assert.ok(source, `${e.id}: the cited ref is a pinned source`);
    const at = path.join(ROOT, 'data', `${source.key}.bin`);
    if (!fs.existsSync(at)) { t.skip('data/ is not present'); return; }
    const bytes = fs.readFileSync(at);
    assert.equal(sha256(bytes), e.sha256, source.key);
    const [a, z = a] = String(e.lines).split('-').map(Number);
    const lines = bytes.toString('utf8').split('\n').slice(a - 1, z).join(' ').replace(/\s+/g, ' ');
    assert.ok(lines.includes(e.quote), `${e.id}: ${lines}`);
  }
});
