#!/usr/bin/env node
// Generate docs/index.html, a view of this example's two signed files:
//   node site/generate.mjs [--root <dir>]            write <root>/docs/index.html
//   node site/generate.mjs --check [--root <dir>]    regenerate in memory, compare byte for byte
//
// The page is a pure function of three inputs, read as bytes: map.yaml and core.md, the two files
// signed as records, and README.md, which is not signed and is an input only for its section "What
// the records prove / what they do not". render() reads no clock, environment, locale or network.
// Everything is in document order; nothing is sorted. The one parser is `yaml`, pinned exactly in
// package.json. core.md keeps four of its absences as comment lines in its front matter, which a YAML
// parser discards, so those are read from the text.
//
// Before writing or checking, the generator refuses unless sha256(map.yaml) and sha256(core.md) each
// equal contentHash.sha256 in that file's signed record (package/map.bundle.json,
// package/core.bundle.json). The bundles gate the run; no byte of them reaches the page. This is not
// signature verification: `npm run verify` is the check of the records.
//
// Exit codes: 0 written, or --check found no difference; 1 --check found a difference; 2 refused.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const INPUTS = [
  { key: 'map', file: 'map.yaml', bundle: 'package/map.bundle.json' },
  { key: 'core', file: 'core.md', bundle: 'package/core.bundle.json' },
  { key: 'readme', file: 'README.md', bundle: null },
];
export const PAGE = 'docs/index.html';
const REPOSITORY = 'github.com/npstorey/typedstandards-core-satellite-example';
const GENERATOR = 'site/generate.mjs';
const README_SECTION = '## What the records prove / what they do not';
const CORE_TABLE_HEADING = '# Core responsibilities';

// One style per relation, so a relation is told apart by line dash and node shape as well as colour.
// A relation the map defines but this table does not is an error, not a default.
const RELATION_STYLE = {
  'builds-on': { shape: 'circle', line: 'solid line' },
  complements: { shape: 'square', line: 'dashed line' },
  'could-emit': { shape: 'triangle', line: 'dash-dot line' },
  adjacent: { shape: 'diamond', line: 'dotted line' },
};

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function readInputs(root) {
  return Object.fromEntries(INPUTS.map((i) => [i.key, fs.readFileSync(path.join(root, i.file))]));
}

// Returns one message per signed input whose bytes differ from its record's contentHash.sha256.
export function refusals(root, inputs) {
  const out = [];
  for (const i of INPUTS.filter((x) => x.bundle)) {
    const signed = JSON.parse(fs.readFileSync(path.join(root, i.bundle), 'utf8')).package?.contentHash?.sha256;
    const actual = sha256(inputs[i.key]);
    if (actual !== signed) {
      out.push(`${i.file}: sha256 ${actual} differs from contentHash.sha256 ${signed} in ${i.bundle}`);
    }
  }
  return out;
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
  return md.split(/(`[^`]+`)/).map((part, i) => (i % 2 === 1
    ? `<code>${esc(part.slice(1, -1))}</code>`
    : esc(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'))).join('');
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const num = (x) => x.toFixed(1);

// ---------- core.md ----------

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
  const table = parseTable(lines, t, 'core.md');
  const x = fm['x-typedstandards'] ?? {};
  return {
    fm,
    frontLines: [2, close],
    markers,
    heading: CORE_TABLE_HEADING.replace(/^#+ /, ''),
    table,
    selfAssessment: x.selfAssessment,
    selfAssessmentBasis: x.selfAssessmentBasis ?? [],
    typeDeclared: x.typeDeclared,
  };
}

// ---------- README.md ----------

function parseReadme(text) {
  const lines = text.split('\n');
  const start = lines.indexOf(README_SECTION);
  if (start < 0) throw new Error(`README.md: no "${README_SECTION}" section`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  // Blocks are runs of non-blank lines. A block of pipe rows is a table, a block whose lines open
  // with **Term:** is a list of definitions, and any other block is one paragraph of text.
  const blocks = [];
  let i = start + 1;
  while (i < end) {
    if (lines[i].trim() === '') { i += 1; continue; }
    let j = i;
    while (j < end && lines[j].trim() !== '') j += 1;
    const run = lines.slice(i, j);
    if (run.every((l) => l.startsWith('|'))) {
      blocks.push({ kind: 'table', ...parseTable(lines, i, 'README.md') });
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
  return { heading: README_SECTION.replace(/^## /, ''), lines: [start + 1, end], blocks };
}

// ---------- map.yaml ----------

function parseMap(text) {
  const docs = YAML.parseAllDocuments(text);
  for (const d of docs) {
    const problems = [...d.errors, ...d.warnings];
    if (problems.length) throw new Error(`map.yaml: ${problems[0].message}`);
  }
  // The header as Maps keeps document order for every key, numeric ring keys included.
  const hdr = docs[0].toJS({ mapAsMap: true }).get('x-typedstandards');
  const header = {
    title: hdr.get('map'),
    subject: hdr.get('subject'),
    edgeTypes: hdr.get('edgeTypes'),
    relations: [...hdr.get('relations')].map(([name, def]) => ({ name, def })),
    rings: [...hdr.get('rings')].map(([ring, def]) => ({ ring, def })),
    refs: hdr.get('refs'),
    dropped: (hdr.get('dropped') ?? []).map((d) => ({ name: d.get('name'), seed: d.get('seed'), reason: d.get('reason') })),
  };
  for (const r of header.relations) {
    if (!RELATION_STYLE[r.name]) throw new Error(`map.yaml: relation "${r.name}" has no style in ${GENERATOR}`);
  }
  const edges = docs.slice(1).map((d, i) => {
    const e = d.toJS();
    const x = e['x-typedstandards'];
    const outward = e.subject.id === header.subject;
    if (!outward && e.object.id !== header.subject) {
      throw new Error(`map.yaml: edge ${e.id} has ${header.subject} at neither end`);
    }
    if (!header.relations.some((r) => r.name === x.relation)) throw new Error(`map.yaml: edge ${e.id}: undefined relation ${x.relation}`);
    if (!header.rings.some((r) => r.ring === x.ring)) throw new Error(`map.yaml: edge ${e.id}: undefined ring ${x.ring}`);
    return {
      n: i + 1,
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
    };
  });
  return { header, edges };
}

const unpinned = (e) => e.far.ref?.sha256 === null;

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
  const band = (k) => ({ inner: RING_INNER + k * width, outer: RING_INNER + (k + 1) * width, mid: RING_INNER + (k + 0.5) * width });
  const byRing = rings.map((r) => edges.filter((e) => e.ring === r));
  const angles = slotAngles(byRing.map((es) => es.length));
  const place = new Map();
  byRing.forEach((es, k) => es.forEach((e, i) => place.set(e.n, { deg: angles[k][i], r: band(k).mid })));

  const out = [];
  out.push(`<svg class="map" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-labelledby="map-title map-desc">`);
  out.push(`<title id="map-title">${esc(header.title)}: ${count(edges.length, 'edge', 'edges')} in ${count(rings.length, 'ring', 'rings')}</title>`);
  out.push(`<desc id="map-desc">${esc(header.subject)} at the centre, one end of every edge. Each numbered node is the other end of one edge, on its ring, shaped by relation. The table "Every edge" gives the same content as text.</desc>`);
  out.push('<defs>');
  for (const r of header.relations) {
    out.push(`<marker id="arrow-${r.name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path class="ah rel-${r.name}" d="M0 0L10 5L0 10Z"/></marker>`);
  }
  out.push('</defs>');
  for (let k = rings.length - 1; k >= 0; k -= 1) {
    out.push(`<circle class="band band-${k % 3 + 1}" cx="${C}" cy="${C}" r="${num(band(k).outer)}"/>`);
  }
  out.push(`<circle class="band-hole" cx="${C}" cy="${C}" r="${num(RING_INNER)}"/>`);
  rings.forEach((r, k) => {
    out.push(`<text class="ring-label" x="${C}" y="${num(C - band(k).mid)}" dy=".35em">Ring ${esc(r)}</text>`);
  });
  const r0 = Math.hypot(HUB.w / 2, HUB.h / 2) + 5;
  for (const e of edges) {
    const { deg, r } = place.get(e.n);
    const [ax, ay] = polar(r0, deg);
    const [bx, by] = polar(r - NODE_R - 6, deg);
    const [x1, y1, x2, y2] = e.outward ? [ax, ay, bx, by] : [bx, by, ax, ay];
    out.push(`<line class="e rel-${e.relation}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" marker-end="url(#arrow-${e.relation})"/>`);
  }
  for (const e of edges) {
    const { deg, r } = place.get(e.n);
    const [x, y] = polar(r, deg);
    const dir = e.outward ? `${header.subject} ${e.relation} this` : `this ${e.relation} ${header.subject}`;
    out.push(`<g class="node${unpinned(e) ? ' unpinned' : ''}"><title>${e.n}. ${esc(e.name)} (${esc(e.publisher)}): ${esc(dir)}; ring ${esc(e.ring)}${unpinned(e) ? '; not pinned' : ''}</title>`);
    out.push(shape(RELATION_STYLE[e.relation].shape, x, y, `mark rel-${e.relation}`));
    out.push(`<text class="n" x="${num(x)}" y="${num(e.relation === 'could-emit' ? y + 3 : y)}" dy=".35em">${e.n}</text>`);
    if (unpinned(e)) {
      const [lx, ly] = polar(r + NODE_R + 16, deg);
      out.push(`<text class="unpinned-label" x="${num(lx)}" y="${num(ly)}" dy=".35em">not pinned</text>`);
    }
    out.push('</g>');
  }
  const nOutward = edges.filter((e) => e.outward).length;
  out.push(`<rect class="hub" x="${C - HUB.w / 2}" y="${C - HUB.h / 2}" width="${HUB.w}" height="${HUB.h}" rx="8"/>`);
  out.push(`<text class="hub-name" x="${C}" y="${C - 18}" dy=".35em">${esc(header.subject)}</text>`);
  out.push(`<text class="hub-note" x="${C}" y="${C + 2}" dy=".35em">self-assessment: ${esc(core.selfAssessment)}</text>`);
  out.push(`<text class="hub-note" x="${C}" y="${C + 20}" dy=".35em">subject of ${nOutward}, object of ${edges.length - nOutward}</text>`);
  out.push('</svg>');
  return out.join('\n');
}

function sample(relation) {
  const s = RELATION_STYLE[relation];
  return `<svg class="sample" viewBox="0 0 64 36" aria-hidden="true"><line class="e rel-${relation}" x1="2" y1="18" x2="30" y2="18" marker-end="url(#arrow-${relation})"/>${shape(s.shape, 46, 18, `mark rel-${relation}`)}</svg>`;
}

// ---------- the page ----------

const CSS = `
:root{--bg:#fbfbf8;--fg:#1f1f1c;--muted:#5c5b55;--rule:#d9d8d0;--panel:#ffffff;--code:#efeee8;
--band-1:#e7ebf2;--band-2:#efece3;--band-3:#e6eee8;--absent:#9a3412;
--r-builds-on:#2957a4;--r-complements:#157349;--r-could-emit:#a8430c;--r-adjacent:#55555f;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--fg:#e8e6df;--muted:#a6a49a;--rule:#3a3934;--panel:#1d1d1b;--code:#2a2926;
--band-1:#1d2330;--band-2:#27241d;--band-3:#1c2620;--absent:#fb9a5b;
--r-builds-on:#8fb2f4;--r-complements:#6ccf9d;--r-could-emit:#f4a26a;--r-adjacent:#b5b5c0}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:72rem;margin:0 auto;padding:2rem 1rem 4rem;overflow-wrap:anywhere}
h1{font-size:1.9rem;line-height:1.2;margin:.2rem 0 1rem}
h2{font-size:1.4rem;margin:3rem 0 .75rem;padding-top:1rem;border-top:1px solid var(--rule)}
h3{font-size:1.1rem;margin:2rem 0 .5rem}
p,li,dd{max-width:48rem}
a{color:var(--r-builds-on)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;background:var(--code);padding:.05em .3em;border-radius:3px;overflow-wrap:anywhere}
.kicker{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem;color:var(--muted);margin:0}
.lead{font-size:1.08rem}
.note{color:var(--muted)}
.note{font-size:.92rem}
.absent{color:var(--absent);font-weight:700}
blockquote{margin:.5rem 0;padding:.25rem 0 .25rem 1rem;border-left:3px solid var(--rule);max-width:48rem}
figure{margin:1rem 0}
.figure-grid{display:grid;grid-template-columns:minmax(0,46rem) minmax(0,1fr);gap:1.5rem;align-items:start}
svg.map{width:100%;height:auto;display:block}
figcaption{margin-top:.75rem;max-width:48rem}
.key h3{margin:0 0 .25rem;font-size:.95rem}
.key h3 span{font-weight:400;color:var(--muted)}
.key ol{margin:0 0 1rem;padding-left:2.2rem;font-size:.92rem}
.key li{max-width:none}
.legend{list-style:none;padding:0;margin:1rem 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:.5rem 1.5rem}
.legend li{display:flex;gap:.6rem;align-items:flex-start;font-size:.92rem}
svg.sample{flex:none;width:64px;height:36px}
.band{stroke:none}.band-1{fill:var(--band-1)}.band-2{fill:var(--band-2)}.band-3{fill:var(--band-3)}.band-hole{fill:var(--bg)}
.ring-label{font-size:12px;font-weight:600;fill:var(--muted);text-anchor:middle;letter-spacing:.04em}
.e{fill:none;stroke-width:1.6}
.rel-builds-on{stroke:var(--r-builds-on)}
.rel-complements{stroke:var(--r-complements)}.e.rel-complements{stroke-dasharray:7 4}
.rel-could-emit{stroke:var(--r-could-emit)}.e.rel-could-emit{stroke-dasharray:10 3 2 3}
.rel-adjacent{stroke:var(--r-adjacent)}.e.rel-adjacent{stroke-dasharray:2 3}
.ah{stroke:none}.ah.rel-builds-on{fill:var(--r-builds-on)}.ah.rel-complements{fill:var(--r-complements)}.ah.rel-could-emit{fill:var(--r-could-emit)}.ah.rel-adjacent{fill:var(--r-adjacent)}
.mark{fill:var(--panel);stroke-width:2.2}
.unpinned .mark{stroke-dasharray:3 2.5}.mark.plain{stroke:var(--muted)}
.n{font-size:11px;font-weight:700;fill:var(--fg);text-anchor:middle}
.unpinned-label{font-size:11px;font-weight:700;fill:var(--absent);text-anchor:middle}
.hub{fill:var(--panel);stroke:var(--muted);stroke-width:1.2}
.hub-name{font-size:14px;font-weight:700;fill:var(--fg);text-anchor:middle}
.hub-note{font-size:11.5px;fill:var(--muted);text-anchor:middle}
table{border-collapse:collapse;width:100%;margin:.75rem 0 1.25rem;font-size:.92rem}
th,td{border-top:1px solid var(--rule);padding:.5rem .6rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{font-weight:600;border-top:2px solid var(--rule);background:var(--panel)}
td small{display:block;color:var(--muted);font-size:.85em}
td ul{margin:.3rem 0 0;padding-left:1.1rem}
.num{white-space:nowrap}
dl{margin:.5rem 0 1rem}
dt{font-weight:700;margin-top:.4rem}
dd{margin:0 0 .2rem 1rem}
.provenance code{font-size:.82em}
footer{margin-top:3rem;color:var(--muted);font-size:.9rem}
@media (max-width:62rem){.figure-grid{grid-template-columns:minmax(0,1fr)}.key{columns:2 16rem}}
@media (max-width:44rem){
main{padding:1.25rem 1rem 3rem}
h1{font-size:1.5rem}
table.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}
table.stack tr{border-top:2px solid var(--rule);padding:.4rem 0}
table.stack td{border:0;padding:.2rem 0}
table.stack td::before{content:attr(data-label);display:block;font-size:.78em;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
}
`;

// Header cells are text with inline Markdown; body cells arrive already rendered to HTML.
function table(head, rows) {
  const th = head.map((h) => `<th scope="col">${inline(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td data-label="${esc(stripMd(head[i]))}">${c}</td>`).join('')}</tr>`).join('\n');
  return `<table class="stack">\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}
const stripMd = (s) => s.replace(/`/g, '').replace(/\*\*/g, '');

function edgeRows(map) {
  const { header, edges } = map;
  return edges.map((e) => {
    const dir = e.outward
      ? `${esc(header.subject)} → this`
      : `this → ${esc(header.subject)}`;
    const ref = e.far.ref ?? {};
    const pinned = ref.sha256 === null
      ? `<span class="absent">not pinned</span>: sha256 null. ${esc(e.pin.reason ?? 'No reason given.')}`
      : `sha256 <code>${esc(ref.sha256)}</code>`;
    const intent = e.intent?.statedIn?.length
      ? `<small>Stated in (read ${esc(e.intent.readAt)}; ${esc(e.intent.state)}):</small><ul>${e.intent.statedIn.map((s) => `<li><a href="${esc(s.url)}">${esc(s.url)}</a>, ${esc(s.date)}: “${esc(s.quote)}”</li>`).join('')}</ul>`
      : '';
    return [
      `<span class="num">${e.n}</span>`,
      `${esc(e.name)}<small><code>${esc(e.id)}</code></small>`,
      esc(e.publisher),
      esc(e.ring),
      `${esc(e.relation)}<small>${dir}</small>`,
      `${esc(e.basis)}${intent}`,
      `<small>${e.outward ? 'object' : 'subject'} <code>${esc(e.far.id)}</code></small><a href="${esc(ref.location)}">${esc(ref.location)}</a><br>${pinned}`,
    ];
  });
}

export function render(inputs) {
  const text = Object.fromEntries(INPUTS.map((i) => [i.key, decode(inputs[i.key], i.file)]));
  const digest = Object.fromEntries(INPUTS.map((i) => [i.key, sha256(inputs[i.key])]));
  const map = parseMap(text.map);
  const core = parseCore(text.core);
  const readme = parseReadme(text.readme);
  const { header, edges } = map;
  const generatedFrom = `generated from map.yaml @ ${digest.map}, core.md @ ${digest.core}, README.md @ ${digest.readme}`;
  const nOut = edges.filter((e) => e.outward).length;
  const notPinned = edges.filter(unpinned);
  const nearRefs = [...new Set(edges.map((e) => `${e.near.id} ${e.near.ref?.location} ${e.near.ref?.sha256}`))];
  const verdictCol = core.table.head.length - 1;
  const notDone = core.table.rows.filter((r) => r[verdictCol] === 'NOT DONE').length;

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

  // Header
  h.push('<header>');
  h.push(`<p class="kicker">${esc(REPOSITORY)}</p>`);
  h.push(`<h1>${esc(header.title)}</h1>`);
  h.push(`<p class="lead">A view of the two files this example signs as Typed Standards records, <code>map.yaml</code> and <code>core.md</code>, and of the proof table in <code>README.md</code>. This page is generated from those three files. It is not a record and is not signed. The check is <code>npm run verify</code>, run in the repository.</p>`);
  h.push('</header>');

  // The picture
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
  h.push(`<figcaption><strong>${esc(header.subject)}</strong> is at the centre because it is one end of every edge: the subject of ${nOut} and the object of ${edges.length - nOut}. Its own record, <code>core.md</code>, assesses it as a ${esc(core.selfAssessment)} and does not declare <code>type: core</code>. The rings are the map's groups of edges, not orbits: the map has no orbits edge (see <a href="#absent">What the map leaves out</a>). Each numbered node is the other end of one edge; an arrow runs from the edge's subject to its object. <a href="#edges">Every edge</a> gives the same content as text.</figcaption>`);
  h.push('</figure>');
  h.push('<ul class="legend">');
  for (const r of header.relations) {
    const n = edges.filter((e) => e.relation === r.name).length;
    h.push(`<li>${sample(r.name)}<span><code>${esc(r.name)}</code> (${n}), ${RELATION_STYLE[r.name].shape} and ${RELATION_STYLE[r.name].line}. ${esc(r.def)}</span></li>`);
  }
  h.push(`<li><svg class="sample" viewBox="0 0 64 36" aria-hidden="true"><g class="unpinned">${shape('circle', 46, 18, 'mark plain')}</g></svg><span>Dashed outline: the other end's ref is <span class="absent">not pinned</span> (sha256 null). ${count(notPinned.length, 'edge', 'edges')}.</span></li>`);
  h.push('</ul>');
  h.push('</section>');

  // Every edge
  h.push('<section id="edges">');
  h.push(`<h2>Every edge (${edges.length})</h2>`);
  h.push(`<p>Every edge in <code>map.yaml</code>, in document order. This table is the picture's text equivalent. Each row gives the ref of the edge's other end. ${nearRefs.length === 1 ? `${esc(header.subject)}'s end carries the same ref on every edge: <a href="${esc(edges[0].near.ref.location)}">${esc(edges[0].near.ref.location)}</a>, sha256 <code>${esc(edges[0].near.ref.sha256)}</code>.` : `${esc(header.subject)}'s end carries ${nearRefs.length} different refs; see <code>map.yaml</code>.`}</p>`);
  h.push(`<p class="note">What a ref is, as the map states it: ${esc(header.refs)}</p>`);
  h.push(table(['#', 'Name', 'Publisher', 'Ring', 'Relation', 'Basis', 'Other end: id, location, sha256'], edgeRows(map)));
  h.push('</section>');

  // What the map leaves out
  h.push('<section id="absent">');
  h.push('<h2>What the map leaves out</h2>');
  h.push('<h3>No orbits edge</h3>');
  h.push(`<blockquote>${esc(header.edgeTypes)}</blockquote>`);
  h.push('<p class="note"><code>map.yaml</code>, <code>x-typedstandards.edgeTypes</code></p>');
  h.push(`<h3>Refs not pinned (${notPinned.length})</h3>`);
  if (notPinned.length) {
    h.push(`<ul>${notPinned.map((e) => `<li>${e.n}. ${esc(e.name)} (<a href="${esc(e.far.ref.location)}">${esc(e.far.ref.location)}</a>): sha256 null. ${esc(e.pin.reason ?? 'No reason given.')}</li>`).join('')}</ul>`);
  } else {
    h.push('<p>None.</p>');
  }
  h.push(`<h3>Dropped (${header.dropped.length})</h3>`);
  h.push('<p class="note">Entries considered and left out of the map, with the reason <code>map.yaml</code> gives.</p>');
  h.push(table(['Name', 'Seed', 'Reason'], header.dropped.map((d) => [esc(d.name), esc(d.seed), esc(d.reason)])));
  h.push('</section>');

  // core.md
  h.push('<section id="core">');
  h.push('<h2>The core record: <code>core.md</code></h2>');
  h.push(`<p><code>selfAssessment: ${esc(core.selfAssessment)}</code>, <code>typeDeclared: ${esc(core.typeDeclared)}</code>. The basis, as the record states it:</p>`);
  h.push(`<ul>${core.selfAssessmentBasis.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
  h.push(`<h3>Absence markers in the front matter (${core.markers.length})</h3>`);
  h.push(`<p class="note">These are comment lines in the front matter of <code>core.md</code> (lines ${core.frontLines[0]} to ${core.frontLines[1]}). A YAML parser discards comments, so the generator reads them from the text.</p>`);
  h.push(table(['Line', 'Commented-out field', 'As written'], core.markers.map((m) => [
    esc(m.line), `<code>${esc(m.field)}</code>`, `<span class="absent">${esc(m.text.replace(/^(NOT [A-Z]+).*$/, '$1'))}</span>${esc(m.text.replace(/^NOT [A-Z]+/, ''))}`,
  ])));
  h.push(`<h3>${esc(core.heading)}</h3>`);
  h.push(`<p class="note">The table from <code>core.md</code> (lines ${core.table.firstLine} to ${core.table.lastLine}), whole. ${notDone} of ${core.table.rows.length} verdicts read NOT DONE.</p>`);
  h.push(table(core.table.head, core.table.rows.map((r) => r.map((c, i) => (i === verdictCol && c === 'NOT DONE' ? `<span class="absent">${inline(c)}</span>` : inline(c))))));
  h.push('</section>');

  // README.md
  h.push('<section id="proof">');
  h.push(`<h2>${inline(readme.heading)}</h2>`);
  h.push(`<p class="note">From <code>README.md</code> (lines ${readme.lines[0]} to ${readme.lines[1]}), whole. <code>README.md</code> is not a signed record.</p>`);
  for (const b of readme.blocks) {
    if (b.kind === 'p') h.push(`<p>${inline(b.text)}</p>`);
    else if (b.kind === 'defs') h.push(`<dl>${b.defs.map((d) => `<dt>${inline(d.term)}</dt><dd>${inline(d.text)}</dd>`).join('')}</dl>`);
    else h.push(table(b.head, b.rows.map((r) => r.map((c) => (c === 'Not covered' ? `<span class="absent">${inline(c)}</span>` : inline(c))))));
  }
  h.push('</section>');

  // Provenance
  h.push('<section id="provenance" class="provenance">');
  h.push('<h2>Provenance</h2>');
  h.push(`<p><code>${esc(generatedFrom)}</code></p>`);
  h.push(table(['Input', 'SHA-256', 'Signed record'], [
    ['<code>map.yaml</code>', `<code>${digest.map}</code>`, 'Yes. Its bytes are the inline output of the record in <code>package/map.bundle.json</code>, and this digest is that record\'s <code>contentHash.sha256</code>.'],
    ['<code>core.md</code>', `<code>${digest.core}</code>`, 'Yes. Its bytes are the inline output of the record in <code>package/core.bundle.json</code>, and this digest is that record\'s <code>contentHash.sha256</code>.'],
    ['<code>README.md</code>', `<code>${digest.readme}</code>`, 'No. It is not a record and is not signed. It is an input because the table "What the records prove / what they do not" is there and in neither signed file.'],
  ]));
  h.push('<ul>');
  h.push('<li>The check is <code>npm run verify</code>. It verifies both records offline and compares each signed file on disk with its record\'s output byte for byte.</li>');
  h.push(`<li>The generator, <code>${GENERATOR}</code>, refuses to write this page unless the SHA-256 of <code>map.yaml</code> and of <code>core.md</code> each equals <code>contentHash.sha256</code> in its record. It does not verify signatures.</li>`);
  h.push('<li><code>npm run check:page</code> regenerates this page and compares it with <code>docs/index.html</code> byte for byte. The page carries no generation time: it is a function of the three inputs alone.</li>');
  h.push(`<li>Repository: <a href="https://${REPOSITORY}">${esc(REPOSITORY)}</a>. Generator: <code>${GENERATOR}</code> in that repository, with one YAML parser, <code>yaml</code>, pinned exactly in <code>package.json</code>.</li>`);
  h.push('</ul>');
  h.push('</section>');

  h.push('<footer>');
  h.push('<p>Text: CC BY 4.0 (<code>LICENSE-CC-BY-4.0.txt</code>). Code: MIT (<code>LICENSE</code>). Third-party documents are cited by location and digest and are not reproduced.</p>');
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
  const inputs = readInputs(root);
  const refused = refusals(root, inputs);
  if (refused.length) {
    for (const m of refused) console.error(`refused: ${m}`);
    console.error(`${PAGE} was not ${check ? 'checked' : 'written'}: the page is a view of signed bytes only.`);
    return 2;
  }
  const page = render(inputs);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
