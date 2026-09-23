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
import { FORBIDDEN, PAGE, POLICY, RECORDS, listing, readInputs, refusals, render, sha256 } from './generate.mjs';
import { ROOT, flipByte, read, readJson, run, scratch, signedBaseline, signedCopy } from '../test/scratch.mjs';

const GENERATOR = 'site/generate.mjs';
// The yaml parser's own debug switches. They print tokens to the console and change no parse result.
const YAML_DEBUG_ENV = ['LOG_TOKENS', 'LOG_STREAM'];
const TREES = [['committed', () => ROOT], ['signed afresh', () => signedBaseline().dir]];

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const plain = (md) => md.replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
// Every table row on the page as "cell | cell | ...", in plain text.
const pageRows = (html) => [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
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
    assert.ok(text(visible(root)).includes(`is at the centre because it is one end of every edge: the subject of ${asSubject} and the object of ${asObject}. Its own record, core.md, assesses it as a ${self}`));
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

test('C5 the README proof table appears whole, with its definitions', () => {
  const lines = read('README.md').split('\n');
  const start = lines.indexOf('## What the records prove / what they do not');
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const sec = lines.slice(start + 1, end);
  const rows = sec.filter((l) => l.startsWith('|') && !/^\|[-| :]+\|$/.test(l)).map(mdRow);
  assert.ok(rows.length > 1);
  for (const row of rows) assert.ok(pageRows(visible()).includes(row), row);
  const defs = [];
  for (const l of sec) {
    const m = /^\*\*([^*]+)\*\* ?(.*)$/.exec(l);
    if (m) defs.push([m[1], m[2]]);
    else if (defs.length && l.trim() && !l.startsWith('|')) defs[defs.length - 1][1] += ` ${l.trim()}`;
    else if (!l.trim() && defs.length) break;
  }
  assert.ok(defs.length > 0);
  const onPage = [...visible().matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => [text(m[1]), text(m[2])]);
  assert.deepEqual(onPage, defs.map(([t, d]) => [plain(t), plain(d)]));
});

// ---------- the phase 3 form: opening, records, policy, registry, links ----------

test('D7 the sections come in the order ruled at G0: the picture right after the opening', () => {
  assert.deepEqual([...page().matchAll(/<section id="([\w-]+)"/g)].map((m) => m[1]),
    ['map', 'how', 'absent', 'core', 'edges', 'records', 'proof', 'provenance']);
});

for (const [label, tree] of TREES) {
  test(`D8 (${label}) the page opens with what the map is, how many records, the newest change and one check-it-yourself line`, () => {
    const root = tree();
    const records = readJson(RECORDS, root).records;
    const current = records.filter((r) => r.status === 'active' && r.role !== 'map-v1').length;
    const opening = text(/<header>([\s\S]*?)<\/header>/.exec(page(root))[1]);
    const edges = mapDocs(root).length - 1;
    assert.ok(opening.includes(`The map places ${edges} public projects in three rings`), opening);
    assert.ok(opening.includes(`published here as ${current} current record${current === 1 ? '' : 's'} and version 1, each a signed Typed Standards record`), opening);
    const newest = records.filter((r) => r.step === records[records.length - 1].step);
    assert.ok(opening.includes(`Newest change: version ${newest[0].step}, ${newest[0].createdAt.slice(0, 10)}:`), opening);
    assert.ok(opening.includes(`(${newest.length} record${newest.length === 1 ? '' : 's'})`), opening);
    assert.ok(opening.includes('Check it yourself: each record links to typedstandards.org\'s verifier, and npm ci && node verify.mjs checks every record offline'), opening);
    assert.ok(page(root).indexOf('</header>') < page(root).indexOf('<section id="map"'));
  });

  test(`D6 (${label}) every record has a verifier link to its served bundle, and every link is one the site fetches as given`, () => {
    const root = tree();
    const served = readJson(RECORDS, root);
    const links = [...page(root).matchAll(/<a href="(https:\/\/typedstandards\.org\/verify[^"]*)">/g)].map((m) => decode(m[1]));
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
    const edgeRows = pageRows(/<table class="stack edges">[\s\S]*?<\/table>/.exec(visible(root))[0]);
    assert.ok(edgeRows.slice(1).every((row) => row.endsWith(' | verify')));
  });

  test(`D3/D5 (${label}) the policy sentence and the registry sentence are visible, and the records section lists every version`, () => {
    const root = tree();
    const rec = text(section(visible(root), 'records'));
    assert.ok(rec.includes('What this page shows, and how, follows docs/host-policy.yaml: the host\'s own display rule. It is not a Typed Standards record'), rec);
    assert.ok(rec.includes('is the example publisher\'s own statement that the key is active. It is not an endorsement by the Typed Standards specification or by typedstandards.org, although this host is a subdomain of typedstandards.org.'), rec);
    const steps = [...new Set(readJson(RECORDS, root).records.map((r) => r.step))];
    for (const s of steps) assert.ok(rec.includes(`Version ${s}, `), `version ${s}`);
    assert.ok(/Withdrawn \(\d+\)/.test(rec));
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
  test(`(${label}) Every edge: the five-column table and the collapsed basis-and-refs table each hold every drawn edge, in order`, () => {
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
    const compact = pageRows(/<table class="stack edges">[\s\S]*?<\/table>/.exec(visible(root))[0]).map((r) => r.split(' | '));
    assert.deepEqual(compact[0], ['#', 'Name', 'Ring', 'Relation', 'Record']);
    assert.equal(compact.length - 1, edges.length);
    edges.forEach((e, i) => {
      const [n, name, ring, relation, record, ...rest] = compact[i + 1];
      assert.deepEqual([n, ring, relation, record, rest], [String(i + 1), e.ring, `${e.arrow} ${e.relation}`, 'verify', []], name);
      assert.ok(name.startsWith(`${e.name}${e.publisher}`), name);
    });
    const details = /<details><summary>Every edge's basis, and the other end's id, location and SHA-256 \((\d+)\)<\/summary>([\s\S]*?)<\/details>/.exec(page(root));
    assert.ok(details, 'one collapsed <details> with that title');
    assert.equal(Number(details[1]), edges.length);
    const refs = pageRows(details[2]);
    assert.equal(refs[0], '# | Other end | Basis | Location and SHA-256');
    assert.equal(refs.length - 1, edges.length);
    edges.forEach((e, i) => {
      assert.ok(refs[i + 1].startsWith(`${i + 1} | ${e.id} | ${e.basis}`), refs[i + 1]);
      assert.ok(refs[i + 1].endsWith(` | ${e.location}${e.sha === 'null' ? 'not pinned: sha256 null' : e.sha}`), refs[i + 1]);
    });
  });
}

test('table cells wrap at word boundaries; links and code in cells, and cells at phone width, break anywhere', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(page())[1];
  assert.match(css, /\nth,td\{[^}]*overflow-wrap:normal[^}]*\}/);
  assert.match(css, /\ntd a,td code\{overflow-wrap:anywhere\}/);
  assert.match(css, /table\.edges td:nth-child\(3\),table\.edges td:nth-child\(4\)\{white-space:nowrap\}/);
  const phone = css.slice(css.indexOf('@media (max-width:44rem)'));
  assert.match(phone, /table\.stack td\{[^}]*overflow-wrap:anywhere[^}]*\}/);
  assert.match(phone, /table\.edges td:nth-child\(5\)::before\{content:"Record"\}/);
  assert.match(css, /pre\.listing\{[^}]*overflow-x:auto[^}]*\}/);
});

test('G2 preparation: docs/CNAME names the custom domain exactly, docs/.nojekyll is empty, README gives the URL', () => {
  assert.equal(read('docs/CNAME'), 'core-satellite.typedstandards.org');
  assert.equal(fs.statSync(path.join(ROOT, 'docs', '.nojekyll')).size, 0);
  assert.ok(read('README.md').includes('https://core-satellite.typedstandards.org/'));
});

// ---------- C6: self-contained; escaping ----------

for (const [label, tree] of TREES) {
  test(`C6 (${label}) the page is self-contained: nothing in it loads on open`, () => {
    const p = page(tree());
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
}

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
