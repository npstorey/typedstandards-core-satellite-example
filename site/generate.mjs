#!/usr/bin/env node
// Generate docs/index.html, a view of the records this host serves:
//   node site/generate.mjs [--root <dir>]            write <root>/docs/index.html
//   node site/generate.mjs --check [--root <dir>]    regenerate in memory, compare byte for byte
//
// The page is a pure function of its inputs, read as bytes: every signed file docs/records.json lists,
// in its order; README.md, which is not signed and is an input only for the sections named in
// README_SECTIONS; docs/records.json, what the host serves and each record's status; and
// docs/host-policy.yaml, the host's rule for what the page displays. Neither of the last two is signed.
// render() reads no clock, environment, locale or network. Everything is in document or record order;
// nothing is sorted. The one parser is `yaml`, pinned exactly in package.json. core.md keeps four of its
// absences as comment lines in its front matter, which a YAML parser discards, so those are read from the
// text.
//
// Before writing or checking, the generator refuses unless each signed file's SHA-256 equals
// contentHash.sha256 in its record's served bundle (docs/bundles/<name>.bundle.json). The bundles gate
// the run; no byte of them reaches the page, and whatever the page shows per record comes from
// docs/records.json. This is not signature verification: `npm run verify` is the check of the records.
// It also refuses a record docs/host-policy.yaml does not display, and a page that would carry one of the
// FORBIDDEN phrases.
//
// Exit codes: 0 written, or --check found no difference; 1 --check found a difference; 2 refused.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const PAGE = 'docs/index.html';
export const RECORDS = 'docs/records.json';
export const POLICY = 'docs/host-policy.yaml';
export const README = 'README.md';
const REPOSITORY = 'github.com/npstorey/typedstandards-core-satellite-example';
const GENERATOR = 'site/generate.mjs';
const VERIFIER = 'https://typedstandards.org/verify?url=';
export const README_SECTIONS = ['## How Typed Standards was used here', '## What the records prove / what they do not'];
const CORE_TABLE_HEADING = '# Core responsibilities';
// Wording the page never uses: no party confirms or vouches for these records, nothing here is checked
// live, and a correction is a withdrawal plus a new record.
export const FORBIDDEN = ['confirmed by', 'vouched for by typedstandards.org', 'verified live', 'superseded'];

// A code span naming one of these files becomes a link. Files in docs/ sit beside the page; the
// others are linked on GitHub. The page reads none of them.
const LINKED = new Map([
  ['docs/verify-output.txt', 'verify-output.txt'],
  ['docs/findings.md', 'findings.md'],
  ['docs/pin-record.md', 'pin-record.md'],
  ['docs/records.json', 'records.json'],
  ['docs/host-policy.yaml', 'host-policy.yaml'],
  ['docs/.well-known/typed-publisher.json', '.well-known/typed-publisher.json'],
  ...['package/core.bundle.json', 'package/map.bundle.json', 'package/build-log.json', 'corpus/manifest.json']
    .map((p) => [p, `https://${REPOSITORY}/blob/main/${p}`]),
]);

// One style per relation, so a relation is told apart by line dash and node shape as well as colour.
// A relation the map defines but this table does not is an error, not a default.
const RELATION_STYLE = {
  'builds-on': { shape: 'circle', line: 'solid line' },
  complements: { shape: 'square', line: 'dashed line' },
  'could-emit': { shape: 'triangle', line: 'dash-dot line' },
  adjacent: { shape: 'diamond', line: 'dotted line' },
};
const ARROW_OUT = '→';
const ARROW_IN = '←';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// The inputs, in the order the page lists and hashes them: every signed file docs/records.json lists,
// in its order, then README.md, docs/records.json and docs/host-policy.yaml. `bundle` is a signed file's
// served bundle, which gates the run.
export function inputFiles(root) {
  const listed = JSON.parse(fs.readFileSync(path.join(root, RECORDS), 'utf8')).records;
  return [
    ...listed.map((r) => ({ file: r.file, bundle: `docs/${r.bundle}` })),
    { file: README, bundle: null },
    { file: RECORDS, bundle: null },
    { file: POLICY, bundle: null },
  ];
}

export function readInputs(root) {
  return inputFiles(root).map((i) => ({ ...i, bytes: fs.readFileSync(path.join(root, i.file)) }));
}

// Returns one message per signed input whose bytes differ from its record's contentHash.sha256.
export function refusals(root, inputs) {
  const out = [];
  for (const i of inputs.filter((x) => x.bundle)) {
    const at = path.join(root, i.bundle);
    const signed = fs.existsSync(at) ? JSON.parse(fs.readFileSync(at, 'utf8')).package?.contentHash?.sha256 : undefined;
    const actual = sha256(i.bytes);
    if (actual !== signed) out.push(`${i.file}: sha256 ${actual} differs from contentHash.sha256 ${signed} in ${i.bundle}`);
  }
  return out;
}

// The shasum-style listing of the inputs, and its SHA-256: `shasum -a 256` over the files in this order
// prints the listing.
export function listing(inputs) {
  const text = inputs.map((i) => `${sha256(i.bytes)}  ${i.file}\n`).join('');
  return { text, digest: sha256(Buffer.from(text)) };
}

// ---------- text helpers ----------

const decode = (buf, file) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new Error(`${file} is not valid UTF-8`);
  }
};

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// The only Markdown rendered: backtick code spans and **bold**. Anything else stays text.
export function inline(md) {
  return md.split(/(`[^`]+`)/).map((part, i) => {
    if (i % 2 === 0) return esc(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const code = part.slice(1, -1);
    const href = LINKED.get(code);
    return href ? `<a href="${href}"><code>${esc(code)}</code></a>` : `<code>${esc(code)}</code>`;
  }).join('');
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => WORDS[n] ?? String(n);
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const num = (x) => String(Math.round(x)); // SVG coordinates, in whole units of an 800-unit viewBox
const link = (url) => `<a href="${esc(url)}">${esc(url)}</a>`;

// ---------- Markdown blocks (core.md tables, README sections) ----------

function splitRow(line, where) {
  if (line.includes('\\|')) throw new Error(`${where}: an escaped pipe is not supported`);
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

// A GFM pipe table starting at lines[start]: header row, separator row, body rows.
function parseTable(lines, start, where) {
  let end = start;
  while (end < lines.length && lines[end].startsWith('|')) end += 1;
  const [head, sep, ...rows] = lines.slice(start, end).map((l) => splitRow(l, where));
  if (!sep || !sep.every((c) => /^:?-+:?$/.test(c))) throw new Error(`${where}: no table separator row`);
  for (const r of rows) {
    if (r.length !== head.length) throw new Error(`${where}: a row has ${r.length} cells, the header ${head.length}`);
  }
  return { head, rows, firstLine: start + 1, lastLine: end };
}

// One list item per "- " or "1. " line; any other line continues the item before it.
function parseList(run) {
  const ordered = /^\d+\. /.test(run[0]);
  const items = [];
  for (const l of run) {
    const m = (ordered ? /^\d+\. (.*)$/ : /^- (.*)$/).exec(l);
    if (m) items.push(m[1]);
    else items[items.length - 1] += ` ${l.trim()}`;
  }
  return { kind: ordered ? 'ol' : 'ul', start: ordered ? Number(/^\d+/.exec(run[0])[0]) : 1, items };
}

// Blocks are runs of non-blank lines: a table (every line a pipe row), a list (opening with "- " or
// "1. "), definitions (lines opening with **Term:**), or else one paragraph of text.
function parseBlocks(lines, from, to, where) {
  const blocks = [];
  let i = from;
  while (i < to) {
    if (lines[i].trim() === '') { i += 1; continue; }
    let j = i;
    while (j < to && lines[j].trim() !== '') j += 1;
    const run = lines.slice(i, j);
    if (run.every((l) => l.startsWith('|'))) {
      blocks.push({ kind: 'table', ...parseTable(lines, i, where) });
    } else if (/^(- |\d+\. )/.test(run[0])) {
      blocks.push(parseList(run));
    } else if (/^\*\*[^*]+:\*\*/.test(run[0])) {
      const defs = [];
      for (const l of run) {
        const m = /^\*\*([^*]+:)\*\*\s*(.*)$/.exec(l);
        if (m) defs.push({ term: m[1], text: m[2] });
        else defs[defs.length - 1].text += ` ${l.trim()}`;
      }
      blocks.push({ kind: 'defs', defs });
    } else {
      blocks.push({ kind: 'p', text: run.map((l) => l.trim()).join(' ') });
    }
    i = j;
  }
  return blocks;
}

function parseReadme(text) {
  const lines = text.split('\n');
  return README_SECTIONS.map((heading) => {
    const start = lines.indexOf(heading);
    if (start < 0) throw new Error(`README.md: no "${heading}" section`);
    let end = lines.findIndex((l, i) => i > start && /^##? /.test(l));
    if (end < 0) end = lines.length;
    while (end > start && lines[end - 1].trim() === '') end -= 1;
    return { heading: heading.replace(/^#+ /, ''), lines: [start + 1, end], blocks: parseBlocks(lines, start + 1, end, 'README.md') };
  });
}

// ---------- core.md ----------

function parseCore(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new Error('core.md: no front matter');
  const close = lines.indexOf('---', 1);
  if (close < 0) throw new Error('core.md: front matter is not closed');
  const front = lines.slice(1, close);
  const fm = YAML.parse(front.join('\n'));
  // An absence marker is a commented-out field followed by its NOT verdict, e.g.
  // "# funding: {}      NOT DONE. No fiscal host, ...". Line numbers are 1-based in core.md.
  const markers = [];
  front.forEach((l, i) => {
    const m = /^# ([A-Za-z][\w-]*: \S+)\s{2,}(NOT [A-Z]+\b.*)$/.exec(l);
    if (m) markers.push({ line: i + 2, field: m[1], text: m[2] });
  });
  const h = lines.indexOf(CORE_TABLE_HEADING, close);
  if (h < 0) throw new Error(`core.md: no "${CORE_TABLE_HEADING}" heading`);
  const t = lines.findIndex((l, i) => i > h && l.startsWith('|'));
  const x = fm['x-typedstandards'] ?? {};
  return {
    name: fm.name,
    mission: fm.mission,
    description: fm.description,
    markers,
    heading: CORE_TABLE_HEADING.replace(/^#+ /, ''),
    table: parseTable(lines, t, 'core.md'),
    selfAssessment: x.selfAssessment,
    selfAssessmentBasis: x.selfAssessmentBasis ?? [],
    typeDeclared: x.typeDeclared,
  };
}

// ---------- the map: map/header.yaml and map/edges/, or version 1's map.yaml ----------

function yamlDocs(text, file) {
  const docs = YAML.parseAllDocuments(text);
  for (const d of docs) {
    const problems = [...d.errors, ...d.warnings];
    if (problems.length) throw new Error(`${file}: ${problems[0].message}`);
  }
  return docs;
}

// The header's x-typedstandards block, read as Maps so that document order holds for every key, numeric
// ring keys included.
function parseHeader(doc, file) {
  const hdr = doc.toJS({ mapAsMap: true }).get('x-typedstandards');
  const header = {
    file,
    title: hdr.get('map'),
    subject: hdr.get('subject'),
    edgeTypes: hdr.get('edgeTypes'),
    relations: [...hdr.get('relations')].map(([name, def]) => ({ name, def })),
    rings: [...hdr.get('rings')].map(([ring, def]) => ({ ring, def })),
    refs: hdr.get('refs'),
    dropped: (hdr.get('dropped') ?? []).map((d) => ({ name: d.get('name'), seed: d.get('seed'), reason: d.get('reason') })),
  };
  for (const r of header.relations) {
    if (!RELATION_STYLE[r.name]) throw new Error(`${file}: relation "${r.name}" has no style in ${GENERATOR}`);
  }
  return header;
}

// One edge. `record` is the docs/records.json entry whose signed file carries it.
function parseEdge(e, n, header, record, file) {
  const x = e['x-typedstandards'];
  const outward = e.subject.id === header.subject;
  if (!outward && e.object.id !== header.subject) throw new Error(`${file}: edge ${e.id} has ${header.subject} at neither end`);
  if (!header.relations.some((r) => r.name === x.relation)) throw new Error(`${file}: edge ${e.id}: undefined relation ${x.relation}`);
  if (!header.rings.some((r) => r.ring === x.ring)) throw new Error(`${file}: edge ${e.id}: undefined ring ${x.ring}`);
  return {
    n,
    id: e.id,
    outward,
    far: outward ? e.object : e.subject,
    near: outward ? e.subject : e.object,
    relation: x.relation,
    basis: x.basis,
    ring: x.ring,
    name: x.name,
    publisher: x.publisher,
    pin: x.pin ?? {},
    intent: x.intent,
    record,
  };
}

// The map as the policy says to draw it: from the current map-header record and the current edge
// records, or, while no map-header record is current, from the version-1 record's map.yaml.
function parseMap(shown, text, policy) {
  const header = shown.find((r) => r.as === 'current' && r.role === 'map-header');
  if (header) {
    const h = parseHeader(yamlDocs(text(header.file), header.file)[0], header.file);
    const edges = shown.filter((r) => r.as === 'current' && r.role !== 'map-header' && policy.map.from.includes(r.role))
      .map((r, i) => parseEdge(yamlDocs(text(r.file), r.file)[0].toJS(), i + 1, h, r, r.file));
    return { header: h, edges, from: 'records' };
  }
  const v1 = shown.find((r) => r.role === policy.map.otherwise && r.as !== 'withdrawn');
  if (!v1) throw new Error(`${POLICY}: no current map-header record and no ${policy.map.otherwise} record to draw the map from`);
  const docs = yamlDocs(text(v1.file), v1.file);
  const h = parseHeader(docs[0], v1.file);
  return { header: h, edges: docs.slice(1).map((d, i) => parseEdge(d.toJS(), i + 1, h, v1, v1.file)), from: 'version 1' };
}

// Each served record with the policy's `as`, or an error naming the first record no rule displays.
function applyPolicy(policy, records) {
  return records.map((r) => {
    const rule = r.signer === policy.signer && r.type === policy.type
      ? policy.display.find((d) => d.status === r.status && d.roles.includes(r.role))
      : undefined;
    if (!rule) throw new PolicyRefusal(`${POLICY}: no rule displays ${r.name} (${r.role}, ${r.status}, signer ${r.signer}, type ${r.type}); unmatched: ${policy.unmatched}`);
    return { ...r, as: rule.as };
  });
}

export class PolicyRefusal extends Error {}

const unpinned = (e) => e.far.ref?.sha256 === null;
const arrow = (e) => (e.outward ? ARROW_OUT : ARROW_IN);
const notPinnedText = (e) => `<span class="absent">not pinned</span>: sha256 null. ${esc(e.pin.reason ?? 'No reason given.')}`;

// ---------- the picture ----------

const SIZE = 800;
const C = SIZE / 2;
const HUB = { w: 168, h: 74 };
const RING_INNER = 100;
const RING_OUTER = 372;
const NODE_R = 14;

// Angles are degrees clockwise from the top. Every node gets an angle of its own, so a radial line
// never runs through another node: the circle is cut into one slot per edge plus two, and the
// three-slot gap at the top holds the ring labels. Each ring spreads its nodes evenly in document
// order, and the rings are merged slot by slot, taking next the node whose evenly spread angle is
// smallest (ties to the inner ring).
function slotAngles(counts) {
  const total = counts.reduce((x, y) => x + y, 0);
  const step = 360 / (total + 2);
  const next = counts.map(() => 0);
  const angles = counts.map(() => []);
  const ideal = (k) => ((next[k] + 0.5) * 360) / counts[k];
  for (let j = 0; j < total; j += 1) {
    let pick = -1;
    counts.forEach((n, k) => {
      if (next[k] < n && (pick < 0 || ideal(k) < ideal(pick))) pick = k;
    });
    angles[pick].push((j + 1.5) * step);
    next[pick] += 1;
  }
  return angles;
}
const polar = (r, deg) => {
  const t = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(t), C + r * Math.sin(t)];
};

function shape(kind, x, y, cls) {
  const p = (pts) => `<path class="${cls}" d="M${pts.map(([a, b]) => `${num(a)} ${num(b)}`).join('L')}Z"/>`;
  if (kind === 'circle') return `<circle class="${cls}" cx="${num(x)}" cy="${num(y)}" r="${NODE_R}"/>`;
  if (kind === 'square') return `<rect class="${cls}" x="${num(x - 12.5)}" y="${num(y - 12.5)}" width="25" height="25" rx="2"/>`;
  if (kind === 'diamond') return p([[x, y - 17], [x + 17, y], [x, y + 17], [x - 17, y]]);
  if (kind === 'triangle') return p([[x, y - 18], [x + 17, y + 12], [x - 17, y + 12]]);
  throw new Error(`no shape ${kind}`);
}

function picture(map, core) {
  const { header, edges } = map;
  const rings = header.rings.map((r) => r.ring);
  const width = (RING_OUTER - RING_INNER) / rings.length;
  const band = (k) => ({ outer: RING_INNER + (k + 1) * width, mid: RING_INNER + (k + 0.5) * width });
  const byRing = rings.map((r) => edges.filter((e) => e.ring === r));
  const angles = slotAngles(byRing.map((es) => es.length));
  const place = new Map();
  byRing.forEach((es, k) => es.forEach((e, i) => place.set(e.n, { deg: angles[k][i], r: band(k).mid })));
  const nOutward = edges.filter((e) => e.outward).length;

  const out = [];
  out.push(`<svg class="map" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-labelledby="map-title map-desc">`);
  out.push(`<title id="map-title">${esc(header.title)}: ${count(edges.length, 'edge', 'edges')} in ${count(rings.length, 'ring', 'rings')}</title>`);
  out.push(`<desc id="map-desc">${esc(header.subject)} at the centre, one end of every edge. Each numbered node is the other end of one edge, on its ring, shaped by relation. The table "Every edge" gives the same content as text.</desc>`);
  out.push(`<defs>${header.relations.map((r) => `<marker id="arrow-${r.name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path class="ah rel-${r.name}" d="M0 0L10 5L0 10Z"/></marker>`).join('')}</defs>`);
  for (let k = rings.length - 1; k >= 0; k -= 1) {
    out.push(`<circle class="band band-${k % 3 + 1}" cx="${C}" cy="${C}" r="${num(band(k).outer)}"/>`);
  }
  out.push(`<circle class="band-hole" cx="${C}" cy="${C}" r="${num(RING_INNER)}"/>`);
  header.rings.forEach(({ ring, def }, k) => {
    out.push(`<g><title>${esc(def)}</title><text class="ring-label" x="${C}" y="${num(C - band(k).mid)}">Ring ${esc(ring)}</text></g>`);
  });
  const r0 = Math.hypot(HUB.w / 2, HUB.h / 2) + 5;
  for (const e of edges) {
    const { deg, r } = place.get(e.n);
    const [ax, ay] = polar(r0, deg);
    const [bx, by] = polar(r - NODE_R - 6, deg);
    const [x1, y1, x2, y2] = e.outward ? [ax, ay, bx, by] : [bx, by, ax, ay];
    out.push(`<line class="e rel-${e.relation}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"/>`);
  }
  for (const e of edges) {
    const { deg, r } = place.get(e.n);
    const [x, y] = polar(r, deg);
    out.push(`<g class="node${unpinned(e) ? ' unpinned' : ''}"><title>${e.n}. ${esc(e.name)} (${esc(e.publisher)})</title>`);
    out.push(shape(RELATION_STYLE[e.relation].shape, x, y, `mark rel-${e.relation}`));
    out.push(`<text x="${num(x)}" y="${num(e.relation === 'could-emit' ? y + 3 : y)}">${e.n}</text>`);
    if (unpinned(e)) {
      const [lx, ly] = polar(r + NODE_R + 16, deg);
      out.push(`<text class="unpinned-label" x="${num(lx)}" y="${num(ly)}">not pinned</text>`);
    }
    out.push('</g>');
  }
  out.push(`<rect class="hub" x="${C - HUB.w / 2}" y="${C - HUB.h / 2}" width="${HUB.w}" height="${HUB.h}" rx="8"/>`);
  out.push(`<text class="hub-name" x="${C}" y="${C - 18}">${esc(header.subject)}</text>`);
  out.push(`<text class="hub-note" x="${C}" y="${C + 2}">self-assessment: ${esc(core.selfAssessment)}</text>`);
  out.push(`<text class="hub-note" x="${C}" y="${C + 20}">subject of ${nOutward}, object of ${edges.length - nOutward}</text>`);
  out.push('</svg>');
  return out.join('\n');
}

function sample(relation) {
  return `<svg class="sample" viewBox="0 0 64 36" aria-hidden="true"><line class="e rel-${relation}" x1="2" y1="18" x2="30" y2="18"/>${shape(RELATION_STYLE[relation].shape, 46, 18, `mark rel-${relation}`)}</svg>`;
}

// ---------- the page ----------

const CSS = `
:root{--bg:#fbfbf8;--fg:#1f1f1c;--muted:#5c5b55;--rule:#d9d8d0;--panel:#fff;--code:#efeee8;
--band-1:#e7ebf2;--band-2:#efece3;--band-3:#e6eee8;--absent:#9a3412;
--r-builds-on:#2957a4;--r-complements:#157349;--r-could-emit:#a8430c;--r-adjacent:#55555f;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--fg:#e8e6df;--muted:#a6a49a;--rule:#3a3934;--panel:#1d1d1b;--code:#2a2926;
--band-1:#1d2330;--band-2:#27241d;--band-3:#1c2620;--absent:#fb9a5b;
--r-builds-on:#8fb2f4;--r-complements:#6ccf9d;--r-could-emit:#f4a26a;--r-adjacent:#b5b5c0}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:72rem;margin:0 auto;padding:2rem 1rem 4rem;overflow-wrap:anywhere}
h1{font-size:1.9rem;line-height:1.2;margin:0 0 .4rem}
h2{font-size:1.4rem;margin:2.5rem 0 .75rem;padding-top:1rem;border-top:1px solid var(--rule)}
h3{font-size:1.1rem;margin:1.75rem 0 .5rem}
p,li,dd{max-width:48rem}
li+li{margin-top:.25rem}
a{color:var(--r-builds-on)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;background:var(--code);padding:.05em .3em;border-radius:3px;overflow-wrap:anywhere}
.subtitle{font-size:1.1rem;color:var(--muted);margin:0 0 1rem}
.note{color:var(--muted);font-size:.92rem}
.absent{color:var(--absent);font-weight:700}
blockquote{margin:.5rem 0;padding:.25rem 0 .25rem 1rem;border-left:3px solid var(--rule);max-width:48rem}
figure{margin:1rem 0}
.figure-grid{display:grid;grid-template-columns:minmax(0,46rem) minmax(0,1fr);gap:1.5rem;align-items:start}
svg.map{width:100%;height:auto;display:block}
figcaption{margin-top:.75rem;max-width:48rem}
.key h3{margin:0 0 .25rem;font-size:.95rem}
.key h3 span{font-weight:400;color:var(--muted)}
.key ol{margin:0 0 1rem;padding-left:2.2rem;font-size:.92rem}
.key li{max-width:none;margin:0}
.legend{list-style:none;padding:0;margin:1rem 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:.5rem 1.5rem}
.legend li{display:flex;gap:.6rem;align-items:flex-start;font-size:.92rem;margin:0}
svg.sample{flex:none;width:64px;height:36px}
.glyph{flex:none;width:64px;text-align:center;font-size:1.3rem;line-height:1.2}
.band{stroke:none}.band-1{fill:var(--band-1)}.band-2{fill:var(--band-2)}.band-3{fill:var(--band-3)}.band-hole{fill:var(--bg)}
svg text{dominant-baseline:central;text-anchor:middle}
.ring-label{font-size:12px;font-weight:600;fill:var(--muted);letter-spacing:.04em}
.e{fill:none;stroke-width:1.6}
.rel-builds-on{stroke:var(--r-builds-on)}.e.rel-builds-on{marker-end:url(#arrow-builds-on)}
.rel-complements{stroke:var(--r-complements)}.e.rel-complements{stroke-dasharray:7 4;marker-end:url(#arrow-complements)}
.rel-could-emit{stroke:var(--r-could-emit)}.e.rel-could-emit{stroke-dasharray:10 3 2 3;marker-end:url(#arrow-could-emit)}
.rel-adjacent{stroke:var(--r-adjacent)}.e.rel-adjacent{stroke-dasharray:2 3;marker-end:url(#arrow-adjacent)}
.ah{stroke:none}.ah.rel-builds-on{fill:var(--r-builds-on)}.ah.rel-complements{fill:var(--r-complements)}.ah.rel-could-emit{fill:var(--r-could-emit)}.ah.rel-adjacent{fill:var(--r-adjacent)}
.mark{fill:var(--panel);stroke-width:2.2}
.unpinned .mark{stroke-dasharray:3 2.5}.mark.plain{stroke:var(--muted)}
.node text{font-size:11px;font-weight:700;fill:var(--fg)}
.node text.unpinned-label{fill:var(--absent)}
.hub{fill:var(--panel);stroke:var(--muted);stroke-width:1.2}
.hub-name{font-size:14px;font-weight:700;fill:var(--fg)}
.hub-note{font-size:11.5px;fill:var(--muted)}
table{border-collapse:collapse;width:100%;margin:.75rem 0 1.25rem;font-size:.92rem}
th,td{border-top:1px solid var(--rule);padding:.45rem .6rem;text-align:left;vertical-align:top;overflow-wrap:normal}
td a,td code{overflow-wrap:anywhere}
th{font-weight:600;border-top:2px solid var(--rule);background:var(--panel)}
td small{display:block;color:var(--muted);font-size:.85em}
table.edges td:nth-child(1),table.edges td:nth-child(3),table.edges td:nth-child(4){white-space:nowrap}
table.edges td:nth-child(5){white-space:nowrap}
pre.listing{margin:.5rem 0;padding:.6rem;background:var(--code);border-radius:3px;font-size:.78rem;line-height:1.45;overflow-x:auto;white-space:pre}
details{margin:.5rem 0 1.5rem}
summary{cursor:pointer;font-weight:600}
dl{margin:.5rem 0 1rem}
dt{font-weight:700;margin-top:.4rem}
dd{margin:0 0 .2rem 1rem}
footer{margin-top:3rem;color:var(--muted);font-size:.9rem}
@media (max-width:62rem){.figure-grid{grid-template-columns:minmax(0,1fr)}.key{columns:2 16rem}}
@media (max-width:44rem){
main{padding:1.25rem 1rem 3rem}
h1{font-size:1.5rem}
table.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}
table.stack tr{border-top:2px solid var(--rule);padding:.4rem 0}
table.stack td{border:0;padding:.15rem 0;overflow-wrap:anywhere;white-space:normal}
table.stack td[data-label]::before,table.edges td::before,table.refs td::before{display:block;font-size:.78em;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
table.stack td[data-label]::before{content:attr(data-label)}
table.edges td:nth-child(1)::before,table.refs td:nth-child(1)::before{content:"Edge"}
table.edges td:nth-child(2)::before{content:"Name"}
table.edges td:nth-child(3)::before{content:"Ring"}
table.edges td:nth-child(4)::before{content:"Relation"}
table.edges td:nth-child(5)::before{content:"Record"}
table.refs td:nth-child(2)::before{content:"Other end"}
table.refs td:nth-child(3)::before{content:"Basis"}
table.refs td:nth-child(4)::before{content:"Location and SHA-256"}
}
`;

// Header cells are text with inline Markdown; body cells arrive already rendered to HTML. A table
// without `labels` takes its phone-width labels from the CSS instead of data-label attributes.
function table(head, rows, { cls = '', labels = true } = {}) {
  const th = head.map((h) => `<th scope="col">${inline(h)}</th>`).join('');
  const td = (c, i) => (labels ? `<td data-label="${esc(stripMd(head[i]))}">${c}</td>` : `<td>${c}</td>`);
  const body = rows.map((r) => `<tr>${r.map(td).join('')}</tr>`).join('\n');
  return `<table class="stack${cls ? ` ${cls}` : ''}">\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}
const stripMd = (s) => s.replace(/`/g, '').replace(/\*\*/g, '');

function blocks(bs) {
  return bs.map((b) => {
    if (b.kind === 'p') return `<p>${inline(b.text)}</p>`;
    if (b.kind === 'ul') return `<ul>${b.items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`;
    if (b.kind === 'ol') return `<ol${b.start === 1 ? '' : ` start="${b.start}"`}>${b.items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`;
    if (b.kind === 'defs') return `<dl>${b.defs.map((d) => `<dt>${inline(d.term)}</dt><dd>${inline(d.text)}</dd>`).join('')}</dl>`;
    return table(b.head, b.rows.map((r) => r.map((c) => (c === 'Not covered' ? `<span class="absent">${inline(c)}</span>` : inline(c)))));
  }).join('\n');
}

// The visible table: the picture as text. An unpinned edge says so, with the reason, in its row. The last
// cell links to typedstandards.org's verifier for the record that carries the edge.
function edgeRows(edges, verify) {
  return edges.map((e) => [
    String(e.n),
    `${esc(e.name)}<small>${esc(e.publisher)}</small>${unpinned(e) ? `<small>${notPinnedText(e)}</small>` : ''}`,
    esc(e.ring),
    `${arrow(e)} ${esc(e.relation)}`,
    verify(e.record),
  ]);
}

// The collapsed table: each edge's basis, and the other end's id, location and SHA-256.
function refRows(edges) {
  return edges.map((e) => {
    const intent = e.intent?.statedIn?.length
      ? `<small>Stated in: ${e.intent.statedIn.map((s) => `${link(s.url)} (${esc(s.date)})`).join('; ')}.</small>`
      : '';
    return [
      String(e.n),
      `<code>${esc(e.far.id)}</code>`,
      `${esc(e.basis)}${intent}`,
      `${link(e.far.ref.location)}<br>${unpinned(e) ? '<span class="absent">not pinned</span>: sha256 null' : `<code>${esc(e.far.ref.sha256)}</code>`}`,
    ];
  });
}

// What one step added, from the roles of its records.
function stepText(records) {
  const parts = [];
  for (const [role, file] of [['core', 'core.md'], ['map-v1', 'map.yaml'], ['map-header', 'map/header.yaml']]) {
    if (records.some((r) => r.role === role)) parts.push(`<code>${file}</code>`);
  }
  const edges = records.filter((r) => r.role === 'edge').length;
  if (edges) parts.push(count(edges, 'edge', 'edges'));
  return `${andList(parts)} (${count(records.length, 'record', 'records')})`;
}

// A withdrawn or listed record's own name: an edge's name from its file, else the file.
function recordLabel(r, text) {
  if (r.role !== 'edge') return `<code>${esc(r.file)}</code>`;
  const e = yamlDocs(text(r.file), r.file)[0].toJS();
  return `${esc(e['x-typedstandards'].name)} <small><code>${esc(r.file)}</code></small>`;
}

export function render(inputs) {
  const bytes = new Map(inputs.map((i) => [i.file, i.bytes]));
  const text = (f) => decode(bytes.get(f), f);
  const { text: inputListing, digest } = listing(inputs);
  const generatedFrom = `generated from ${inputs.length} inputs @ ${digest}`;
  const served = JSON.parse(text(RECORDS));
  const policy = YAML.parse(text(POLICY));
  const shown = applyPolicy(policy, served.records);
  const verifyHref = (r) => `${VERIFIER}${served.host}${r.bundle}`;
  const verify = (r) => `<a href="${esc(verifyHref(r))}">verify</a>`;
  const coreRecord = shown.find((r) => r.role === 'core' && r.as === 'current');
  if (!coreRecord) throw new PolicyRefusal(`${POLICY}: no current core record to show`);
  const core = parseCore(text(coreRecord.file));
  const map = parseMap(shown, text, policy);
  const [how, proof] = parseReadme(text(README));
  const { header, edges } = map;
  const signedCount = inputs.filter((i) => i.bundle).length;
  const nOut = edges.filter((e) => e.outward).length;
  const notPinned = edges.filter(unpinned);
  const nearRefs = [...new Set(edges.map((e) => `${e.near.id} ${e.near.ref?.location} ${e.near.ref?.sha256}`))];
  const verdictCol = core.table.head.length - 1;
  const notDone = core.table.rows.filter((r) => r[verdictCol] === 'NOT DONE').length;
  const firstOut = edges.find((e) => e.outward);
  const firstIn = edges.find((e) => !e.outward);
  const steps = [];
  for (const r of served.records) {
    if (!steps.length || steps[steps.length - 1].step !== r.step) steps.push({ step: r.step, records: [] });
    steps[steps.length - 1].records.push(r);
  }
  const newest = steps[steps.length - 1];
  const stepDate = (s) => s.records[0].createdAt.slice(0, 10);
  const current = shown.filter((r) => r.as === 'current');
  const versionOne = shown.filter((r) => r.as === 'version 1');
  const withdrawn = shown.filter((r) => r.as === 'withdrawn');
  const recordCount = `${count(current.length, 'current record', 'current records')}${versionOne.length ? ' and version 1' : ''}${withdrawn.length ? `, and ${withdrawn.length} withdrawn` : ''}`;

  const h = [];
  h.push('<!doctype html>');
  h.push(`<!-- ${generatedFrom} -->`);
  h.push(`<!-- Generated by ${GENERATOR}; do not edit. npm run check:page compares this file with a fresh generation. -->`);
  h.push('<html lang="en">');
  h.push('<head>');
  h.push('<meta charset="utf-8">');
  h.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  h.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`);
  h.push('<meta name="referrer" content="no-referrer">');
  h.push('<meta name="color-scheme" content="light dark">');
  h.push(`<meta name="generator" content="${GENERATOR}">`);
  h.push('<link rel="icon" href="data:,">');
  h.push(`<title>${esc(header.title)}</title>`);
  h.push(`<style>${CSS}</style>`);
  h.push('</head>');
  h.push('<body>');
  h.push('<main>');

  // Opening: what the map is, how many records, the newest change, and how to check them.
  h.push('<header>');
  h.push(`<h1>${esc(header.title)}</h1>`);
  h.push('<p class="subtitle">typedstandards-core-satellite-example: the SciOS core-and-satellite model applied to Typed Standards.</p>');
  h.push(`<p>The map places ${edges.length} public projects in ${word(header.rings.length)} rings by their technical relation to Typed Standards, and the core record, <code>core.md</code>, assesses Typed Standards as a ${esc(core.selfAssessment)}. They are published here as ${recordCount}, each a signed Typed Standards record. This page is a view of them and is not signed itself.</p>`);
  h.push(`<p><strong>Newest change:</strong> version ${esc(newest.step)}, ${esc(stepDate(newest))}: ${stepText(newest.records)}. <a href="#records">The records</a> lists every version.</p>`);
  h.push('<p><strong>Check it yourself:</strong> each record links to typedstandards.org\'s verifier, and <code>npm ci &amp;&amp; node verify.mjs</code> checks every record offline in a clone of the repository.</p>');
  h.push('</header>');

  // The map
  h.push('<section id="map">');
  h.push('<h2>The map</h2>');
  h.push('<figure>');
  h.push('<div class="figure-grid">');
  h.push(picture(map, core));
  h.push('<div class="key">');
  header.rings.forEach(({ ring, def }) => {
    const es = edges.filter((e) => e.ring === ring);
    h.push(`<h3>Ring ${esc(ring)} (${es.length}) <span>${esc(def)}</span></h3>`);
    h.push(`<ol>${es.map((e) => `<li value="${e.n}">${esc(e.name)}${unpinned(e) ? ' <span class="absent">(not pinned)</span>' : ''}</li>`).join('')}</ol>`);
  });
  h.push('</div>');
  h.push('</div>');
  h.push(`<figcaption><strong>${esc(header.subject)}</strong> is at the centre because it is one end of every edge: the subject of ${nOut} and the object of ${edges.length - nOut}. Its own record, <code>core.md</code>, assesses it as a ${esc(core.selfAssessment)} and does not declare <code>type: core</code>. The rings group the edges and are not orbits: the map has no orbits edge (<a href="#absent">What the map leaves out</a>). Each numbered node is one edge's other end, and each arrow runs from subject to object. <a href="#edges">Every edge</a> gives the same as text.</figcaption>`);
  h.push('</figure>');
  h.push('<ul class="legend">');
  for (const r of header.relations) {
    const n = edges.filter((e) => e.relation === r.name).length;
    h.push(`<li>${sample(r.name)}<span><code>${esc(r.name)}</code> (${n}), ${RELATION_STYLE[r.name].shape} and ${RELATION_STYLE[r.name].line}. ${esc(r.def)}</span></li>`);
  }
  h.push(`<li><svg class="sample" viewBox="0 0 64 36" aria-hidden="true"><g class="unpinned">${shape('circle', 46, 18, 'mark plain')}</g></svg><span>Dashed outline: the source has no fixed version, so it is <span class="absent">not pinned</span> (sha256 null). ${count(notPinned.length, 'edge', 'edges')}.</span></li>`);
  h.push(`<li><span class="glyph" aria-hidden="true">${ARROW_OUT} ${ARROW_IN}</span><span>In the tables, ${ARROW_OUT} marks an edge whose subject is ${esc(header.subject)} (${esc(header.subject)} ${esc(firstOut.relation)} ${esc(firstOut.name)}). ${ARROW_IN} marks one whose subject is the project in the row (${esc(firstIn.name)} ${esc(firstIn.relation)} ${esc(header.subject)}).</span></li>`);
  h.push('</ul>');
  h.push('</section>');

  // How Typed Standards was used here
  h.push('<section id="how">');
  h.push(`<h2>${inline(how.heading)}</h2>`);
  h.push(`<p><strong>${esc(core.name)}</strong>, in its own record (<code>core.md</code>): ${esc(core.description)} Its mission: ${esc(core.mission)}</p>`);
  h.push(blocks(how.blocks));
  h.push('</section>');

  // What the map leaves out
  h.push('<section id="absent">');
  h.push('<h2>What the map leaves out</h2>');
  h.push('<h3>No orbits edge</h3>');
  h.push(`<blockquote>${esc(header.edgeTypes)}</blockquote>`);
  h.push(`<p class="note"><code>${esc(header.file)}</code>, <code>x-typedstandards.edgeTypes</code></p>`);
  h.push(`<h3>Not pinned (${notPinned.length})</h3>`);
  h.push(notPinned.length
    ? `<ul>${notPinned.map((e) => `<li>${e.n}. ${esc(e.name)} (${link(e.far.ref.location)}): sha256 null. ${esc(e.pin.reason ?? 'No reason given.')}</li>`).join('')}</ul>`
    : '<p>None.</p>');
  h.push(`<h3>Dropped (${header.dropped.length})</h3>`);
  h.push(`<p class="note">Considered for the map and left out, with the reason <code>${esc(header.file)}</code> gives.</p>`);
  h.push(table(['Name', 'Seed', 'Reason'], header.dropped.map((d) => [esc(d.name), esc(d.seed), esc(d.reason)])));
  h.push('</section>');

  // core.md
  h.push('<section id="core">');
  h.push('<h2>The core record: <code>core.md</code></h2>');
  h.push(`<p><code>selfAssessment: ${esc(core.selfAssessment)}</code>, <code>typeDeclared: ${esc(core.typeDeclared)}</code>. Its record: ${verify(coreRecord)}.</p>`);
  h.push(`<details><summary>The record's basis for its self-assessment (${core.selfAssessmentBasis.length})</summary><ul>${core.selfAssessmentBasis.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></details>`);
  h.push(`<h3>Absence markers in the front matter (${core.markers.length})</h3>`);
  h.push(`<p class="note">Comment lines ${andList(core.markers.map((m) => String(m.line)))} of <code>core.md</code>. A YAML parser discards comments, so the generator reads them from the text.</p>`);
  h.push(table(['Commented-out field', 'As written'], core.markers.map((m) => [
    `<code>${esc(m.field)}</code>`, `<span class="absent">${esc(m.text.replace(/^(NOT [A-Z]+).*$/, '$1'))}</span>${esc(m.text.replace(/^NOT [A-Z]+/, ''))}`,
  ])));
  h.push(`<h3>${esc(core.heading)}</h3>`);
  h.push(`<p class="note">The table from <code>core.md</code> (lines ${core.table.firstLine} to ${core.table.lastLine}), whole. ${notDone} of ${core.table.rows.length} verdicts read NOT DONE.</p>`);
  h.push(table(core.table.head, core.table.rows.map((r) => r.map((c, i) => (i === verdictCol && c === 'NOT DONE' ? `<span class="absent">${inline(c)}</span>` : inline(c))))));
  h.push('</section>');

  // Every edge
  h.push('<section id="edges">');
  h.push(`<h2>Every edge (${edges.length})</h2>`);
  h.push(map.from === 'records'
    ? `<p class="note">Every current edge record, in the order it was signed: the picture as text. ${ARROW_OUT} and ${ARROW_IN} as in the legend. Each row links to typedstandards.org's verifier for that edge's own record. Each edge's basis is in the collapsed table below.</p>`
    : `<p class="note">Every edge in <code>map.yaml</code>, version 1, in document order: the picture as text. ${ARROW_OUT} and ${ARROW_IN} as in the legend. Each row links to typedstandards.org's verifier for version 1's record, which carries every edge. Each edge's basis is in the collapsed table below.</p>`);
  h.push(table(['#', 'Name', 'Ring', 'Relation', 'Record'], edgeRows(edges, verify), { cls: 'edges', labels: false }));
  h.push(`<details><summary>Every edge's basis, and the other end's id, location and SHA-256 (${edges.length})</summary>`);
  h.push(`<p class="note">${esc(header.refs)}</p>`);
  h.push(nearRefs.length === 1
    ? `<p class="note">${esc(header.subject)}'s own end carries the same ref on every edge: ${link(edges[0].near.ref.location)}, sha256 <code>${esc(edges[0].near.ref.sha256)}</code>.</p>`
    : `<p class="note">${esc(header.subject)}'s own end carries ${nearRefs.length} different refs; see the edge files.</p>`);
  h.push(table(['#', 'Other end', 'Basis', 'Location and SHA-256'], refRows(edges), { cls: 'refs', labels: false }));
  h.push('</details>');
  h.push('</section>');

  // The records
  h.push('<section id="records">');
  h.push('<h2>The records</h2>');
  h.push(`<p>This host serves ${count(served.records.length, 'signed record', 'signed records')}: ${recordCount}. Each version below is one signing step, and no record is ever re-signed.</p>`);
  h.push(`<ol class="versions">${steps.map((s) => `<li>Version ${esc(s.step)}, ${esc(stepDate(s))}: ${stepText(s.records)}.</li>`).join('')}</ol>`);
  const listed = shown.filter((r) => r.role !== 'edge' || r.as === 'withdrawn');
  h.push(table(['Record', 'Shown as', 'Status', 'Check'], listed.map((r) => [recordLabel(r, text), esc(r.as), esc(r.status), verify(r)])));
  h.push(`<p class="note">Each edge record is linked in its row of <a href="#edges">Every edge</a>. A correction is a withdrawal plus a new record.</p>`);
  h.push(`<h3>Withdrawn (${withdrawn.length})</h3>`);
  h.push(withdrawn.length
    ? `<ul>${withdrawn.map((r) => `<li>${recordLabel(r, text)}, withdrawn ${esc(r.withdrawn?.at ?? '')}: ${esc(r.withdrawn?.reason ?? '')} ${verify(r)}</li>`).join('')}</ul>`
    : '<p>None.</p>');
  h.push('<h3>Whose rules these are</h3>');
  h.push('<p>What this page shows, and how, follows <a href="host-policy.yaml"><code>docs/host-policy.yaml</code></a>: the host\'s own display rule. It is not a Typed Standards record, and no Typed Standards check covers it.</p>');
  h.push(`<p>The key's registry, <a href=".well-known/typed-publisher.json"><code>docs/.well-known/typed-publisher.json</code></a>, is the example publisher's own statement that the key is active. It is not an endorsement by the Typed Standards specification or by typedstandards.org, although this host is a subdomain of typedstandards.org. Every record's view names it as <code>trustRegistryUrl</code>, which is not part of what the key signed.</p>`);
  h.push('</section>');

  // What the records prove / what they do not
  h.push('<section id="proof">');
  h.push(`<h2>${inline(proof.heading)}</h2>`);
  h.push(`<p class="note">From <code>README.md</code> (lines ${proof.lines[0]} to ${proof.lines[1]}), whole. <code>README.md</code> is not a signed record.</p>`);
  h.push(blocks(proof.blocks));
  h.push('</section>');

  // Provenance
  h.push('<section id="provenance">');
  h.push('<h2>Provenance</h2>');
  h.push(`<p><code>${esc(generatedFrom)}</code></p>`);
  h.push(`<p>Generated by <code>${GENERATOR}</code> in <a href="https://${REPOSITORY}">${esc(REPOSITORY)}</a>, with one YAML parser, <code>yaml</code>, pinned exactly. The page carries no generation time: it is a function of its inputs alone.</p>`);
  h.push(`<details><summary>The ${inputs.length} inputs</summary>`);
  h.push(`<p class="note">The digest above is the SHA-256 of this listing, which <code>shasum -a 256</code> prints for the files in this order. The first ${signedCount} are signed: each file's bytes are the inline output of its record, and its SHA-256 is that record's <code>contentHash.sha256</code>; the generator refuses to write this page otherwise. The last three are not signed. <code>README.md</code> is an input because the sections above that come from it are in no signed file.</p>`);
  h.push(`<pre class="listing">${esc(inputListing)}</pre>`);
  h.push('</details>');
  h.push('</section>');

  h.push('<footer>');
  h.push('<p>Text: CC BY 4.0. Code: MIT. Third-party documents are cited by location and SHA-256 and are not reproduced.</p>');
  h.push('</footer>');
  h.push('</main>');
  h.push('</body>');
  h.push('</html>');
  return `${h.join('\n')}\n`;
}

// ---------- command line ----------

function firstDifference(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i += 1) {
    if (la[i] !== lb[i]) return { line: i + 1, committed: la[i], generated: lb[i] };
  }
  return null;
}

function main(argv) {
  const check = argv.includes('--check');
  const r = argv.indexOf('--root');
  const root = r >= 0 ? path.resolve(argv[r + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const refuse = (messages) => {
    for (const m of messages) console.error(`refused: ${m}`);
    console.error(`${PAGE} was not ${check ? 'checked' : 'written'}: the page is a view of signed bytes only, displayed as ${POLICY} says.`);
    return 2;
  };
  const inputs = readInputs(root);
  const refused = refusals(root, inputs);
  if (refused.length) return refuse(refused);
  let page;
  try {
    page = render(inputs);
  } catch (e) {
    if (e instanceof PolicyRefusal) return refuse([e.message]);
    throw e;
  }
  const forbidden = FORBIDDEN.filter((p) => page.toLowerCase().includes(p));
  if (forbidden.length) return refuse(forbidden.map((p) => `the page would say "${p}"`));
  const target = path.join(root, PAGE);
  if (!check) {
    fs.writeFileSync(target, page);
    console.log(`wrote ${PAGE}: ${Buffer.byteLength(page)} bytes, sha256 ${sha256(Buffer.from(page))}`);
    return 0;
  }
  const committed = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (committed === page) {
    console.log(`${PAGE} equals a fresh generation: ${Buffer.byteLength(page)} bytes, sha256 ${sha256(Buffer.from(page))}`);
    return 0;
  }
  const d = firstDifference(committed, page);
  console.error(`${PAGE} differs from a fresh generation at line ${d.line}:`);
  console.error(`  committed: ${d.committed === undefined ? '(no such line)' : JSON.stringify(d.committed.slice(0, 300))}`);
  console.error(`  generated: ${d.generated === undefined ? '(no such line)' : JSON.stringify(d.generated.slice(0, 300))}`);
  console.error(`Run: node ${GENERATOR}`);
  return 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
