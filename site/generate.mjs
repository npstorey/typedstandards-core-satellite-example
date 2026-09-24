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
// It also refuses a record docs/host-policy.yaml does not display, two current map-header records, a ring
// caption the drawn edges do not bear out, a ring-3 fill whose cited ref is not the node's signed ref, and a
// page that would carry one of the FORBIDDEN phrases.
//
// The page quotes SciOS's paper where the example meets a rule the paper states. Every quotation is verbatim
// from the dated read named in PAPER, marked as a quotation, attributed and linked.
//
// Signed timestamps are shown in US Eastern time with UTC beside them (eastern()), by calendar arithmetic
// under a fixed zone rule, never the machine's zone. The page loads its two typefaces from docs/fonts/, on its
// own host, and nothing from any other host.
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
const SITE = 'https://typedstandards.org';
// Where the Typed Standards README says the specification text lives, and the two public repositories of the
// reference implementations core.md names: the producer and verifier, and the publishing application.
const SPECIFICATION = 'https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/typed-standards-specification.md';
const IMPLEMENTATIONS = 'https://github.com/npstorey/typedstandards';
const PUBLISHING_APP = 'https://github.com/npstorey/civic-ai-tools-website';
// The typefaces typedstandards.org loads, as committed subset files beside the page (docs/fonts/README.md).
export const FONTS = [
  { family: 'Space Grotesk', weight: '500 700', file: 'fonts/space-grotesk-latin.woff2' },
  { family: 'Noto Sans', weight: '400 600', file: 'fonts/noto-sans-latin.woff2' },
];
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

// One style per relation, so a relation is told apart by node shape and line as well as colour. Only a relation
// in which one end depends on the other has an arrowhead; complements and adjacent differ by shape alone.
// A relation the map defines but this table does not is an error, not a default. could-emit is defined only
// by the first header, map/header.yaml, and version 1's map.yaml; it keeps its style for that map.
const RELATION_STYLE = {
  'builds-on': { shape: 'circle', line: 'solid line with an arrowhead', head: true },
  complements: { shape: 'square', line: 'solid line with no head', head: false },
  'writes-recordable-output': { shape: 'hexagon', line: 'dotted line with no head', head: false },
  'could-emit': { shape: 'triangle', line: 'dash-dot line with an arrowhead', head: true },
  adjacent: { shape: 'diamond', line: 'solid line with no head', head: false },
};

// The SciOS paper, as quoted on the page: every quotation is verbatim from this dated read.
const PAPER = { publisher: 'SciOS', title: 'The Core-Satellite Model', url: 'https://scios.tech/thoughts', dated: '2026-06-30', read: '2026-09-22' };
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
const cap = (s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const num = (x) => String(Math.round(x)); // SVG coordinates, in whole units of an 800-unit viewBox
const link = (url) => `<a href="${esc(url)}">${esc(url)}</a>`;
const paperLink = () => `<a href="${PAPER.url}"><i>${esc(PAPER.title)}</i></a>`;
const paperRead = () => `dated ${PAPER.dated}, read ${PAPER.read}`;
// A quotation from the paper, set as one, with where in the paper it stands.
const quote = (text, where) => `<figure class="quote"><blockquote cite="${PAPER.url}"><p>“${esc(text)}”</p></blockquote><figcaption>${PAPER.publisher}, ${paperLink()}, ${esc(where)} (${paperRead()}).</figcaption></figure>`;
const q = (text) => `<q cite="${PAPER.url}">${esc(text)}</q>`;

// ---------- times ----------

// A signed timestamp as the page shows it: "23 September 2026, 21:52 ET (2026-09-24T01:52Z)". The zone is fixed:
// America/New_York under the US rule in force since 2007, UTC−4 from 02:00 local on the second Sunday in March
// to 02:00 local on the first Sunday in November, UTC−5 otherwise. It is applied by calendar arithmetic, so
// render() reads no clock, zone or locale. Seconds are dropped, not rounded.
export const ZONE_RULE = 'Times are US Eastern (America/New_York: UTC−4 from the second Sunday in March to the first Sunday in November, UTC−5 otherwise), with UTC in brackets; the signed values are UTC.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Days since 1970-01-01 of a proleptic Gregorian date, and back (H. Hinnant's civil-calendar algorithms).
function daysFromCivil(y0, m, d) {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, doy - Math.floor((153 * mp + 2) / 5) + 1];
}
// 0 is Sunday; day 0, 1970-01-01, was a Thursday.
const weekday = (days) => (((days % 7) + 7) % 7 + 4) % 7;
const nthSunday = (y, m, n) => {
  const first = daysFromCivil(y, m, 1);
  return first + ((7 - weekday(first)) % 7) + 7 * (n - 1);
};
export function eastern(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z$/.exec(iso ?? '');
  if (!m) throw new Error(`not a UTC timestamp: ${iso}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (y < 2007) throw new Error(`${iso}: the US Eastern rule applied here holds from 2007`);
  const utc = daysFromCivil(y, mo, d) * 1440 + h * 60 + mi;
  const summer = utc >= nthSunday(y, 3, 2) * 1440 + 7 * 60 && utc < nthSunday(y, 11, 1) * 1440 + 6 * 60;
  const local = utc - (summer ? 240 : 300);
  const day = Math.floor(local / 1440);
  const [ly, lm, ld] = civilFromDays(day);
  const minutes = local - day * 1440;
  const two = (n) => String(n).padStart(2, '0');
  return `${ld} ${MONTHS[lm - 1]} ${ly}, ${two(Math.floor(minutes / 60))}:${two(minutes % 60)} ET (${iso.slice(0, 16)}Z)`;
}

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
    createdAt: e.createdAt,
    record,
  };
}

// The map as the policy says to draw it: from the one current map-header record and the current edge
// records, or, while no map-header record is current, from the version-1 record's map.yaml. Two current
// map-header records are refused: a map has one header, and a later one is signed after the earlier one is
// withdrawn.
function parseMap(shown, text, policy) {
  const headers = shown.filter((r) => r.as === 'current' && r.role === 'map-header');
  if (headers.length > 1) throw new PolicyRefusal(`${POLICY}: ${headers.length} current map-header records (${headers.map((r) => r.file).join(', ')}); the map has one header`);
  const [header] = headers;
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

// Each ring's caption, as the policy gives it: the header's own definition, or a caption stating a relation
// that every drawn edge in the ring must have.
const neitherDepends = (header, relation) => /Neither depends on the other\b/.test(header.relations.find((r) => r.name === relation).def);
function ringCaptions(policy, { header, edges }) {
  const holds = {
    'subject-builds-on': (e) => e.outward && e.relation === 'builds-on',
    'neither-depends': (e) => neitherDepends(header, e.relation),
  };
  return header.rings.map(({ ring, def }) => {
    const rule = (policy.rings ?? []).find((r) => r.ring === ring);
    if (!rule) throw new PolicyRefusal(`${POLICY}: no caption for ring ${ring}`);
    if (rule.caption === 'header') return { ring, def, caption: def };
    if (!holds[rule.holds]) throw new PolicyRefusal(`${POLICY}: ring ${ring}: no rule "${rule.holds}"`);
    const broken = edges.filter((e) => e.ring === ring && !holds[rule.holds](e));
    if (broken.length) throw new PolicyRefusal(`${POLICY}: ring ${ring}'s caption "${rule.caption}" does not hold for ${broken.map((e) => e.id).join(', ')}`);
    return { ring, def, caption: rule.caption };
  });
}

// The policy's filled nodes, by edge number. Each must be the other end of a drawn edge in the policy's ring,
// citing exactly the ref that edge's signed record gives.
function fillOf(policy, { edges }) {
  const fill = policy.fill;
  if (!fill) return null;
  const filled = new Map();
  for (const f of fill.nodes ?? []) {
    const e = edges.find((x) => x.ring === fill.ring && x.far.id === f.id);
    if (!e) throw new PolicyRefusal(`${POLICY}: fill names ${f.id}, which is the other end of no drawn edge in ring ${fill.ring}`);
    if (e.far.ref?.location !== f.location || e.far.ref?.sha256 !== f.sha256) {
      throw new PolicyRefusal(`${POLICY}: fill cites ${f.location} (sha256 ${f.sha256}) for ${f.id}, which is not the ref ${e.record.file} gives`);
    }
    filled.set(e.n, { ...f, lines: String(f.lines) });
  }
  return { ring: fill.ring, filledText: fill.filled, hollowText: fill.hollow, filled };
}

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
// Ring captions run along the top of each band, 13 units inside its outer edge, in 11.5-unit type.
// CAPTION_ADVANCE is the width allowed per character: the three captions average 5.5 to 5.8 units a character
// in Noto Sans at weight 600 (measured with harfbuzz), so the gap has room to spare, and for a fallback face.
const CAPTION_INSET = 13;
const CAPTION_ADVANCE = 6.6;

// Angles are degrees clockwise from the top. Every node gets an angle of its own, so a radial line never runs
// through another node: the nodes are spread evenly over the circle less a gap at the top, and the gap holds
// the ring captions with 4 degrees to spare on each side. Each ring spreads its nodes evenly in document order,
// and the rings are merged slot by slot, taking next the node whose evenly spread angle is smallest (ties to
// the inner ring).
function slotAngles(counts, gap) {
  const total = counts.reduce((x, y) => x + y, 0);
  const step = (360 - gap) / Math.max(total - 1, 1);
  const next = counts.map(() => 0);
  const angles = counts.map(() => []);
  const ideal = (k) => ((next[k] + 0.5) * 360) / counts[k];
  for (let j = 0; j < total; j += 1) {
    let pick = -1;
    counts.forEach((n, k) => {
      if (next[k] < n && (pick < 0 || ideal(k) < ideal(pick))) pick = k;
    });
    angles[pick].push(total === 1 ? 180 : gap / 2 + j * step);
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
  if (kind === 'hexagon') return p([[x - 8, y - 14], [x + 8, y - 14], [x + 16, y], [x + 8, y + 14], [x - 8, y + 14], [x - 16, y]]);
  throw new Error(`no shape ${kind}`);
}

const captionText = (c) => `Ring ${c.ring}: ${c.caption}`;

function picture(map, core, captions, fill) {
  const { header, edges } = map;
  const rings = header.rings.map((r) => r.ring);
  const width = (RING_OUTER - RING_INNER) / rings.length;
  const band = (k) => ({ outer: RING_INNER + (k + 1) * width, mid: RING_INNER + (k + 0.5) * width });
  const captionR = (k) => band(k).outer - CAPTION_INSET;
  // The half-angle each caption spans, in degrees, and the gap that holds the widest.
  const half = captions.map((c, k) => ((captionText(c).length * CAPTION_ADVANCE) / 2 / captionR(k)) * (180 / Math.PI));
  const gap = Math.ceil(2 * (Math.max(...half) + 4));
  const byRing = rings.map((r) => edges.filter((e) => e.ring === r));
  const angles = slotAngles(byRing.map((es) => es.length), gap);
  const place = new Map();
  byRing.forEach((es, k) => es.forEach((e, i) => place.set(e.n, { deg: angles[k][i], r: band(k).mid })));
  const nOutward = edges.filter((e) => e.outward).length;
  const isFilled = (e) => Boolean(fill?.filled.has(e.n));

  const out = [];
  out.push(`<svg class="map" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-labelledby="map-title map-desc">`);
  out.push(`<title id="map-title">${esc(header.title)}: ${count(edges.length, 'edge', 'edges')} in ${count(rings.length, 'ring', 'rings')}</title>`);
  out.push(`<desc id="map-desc">${esc(header.subject)} at the centre, one end of every edge. Each numbered node is the other end of one edge, on its ring, shaped by relation. The lists "The edges, ring by ring" give the same content as text.</desc>`);
  const arcs = captions.map((c, k) => {
    const [x1, y1] = polar(captionR(k), -half[k] - 2);
    const [x2, y2] = polar(captionR(k), half[k] + 2);
    return `<path id="ring-arc-${k + 1}" d="M${num(x1)} ${num(y1)}A${num(captionR(k))} ${num(captionR(k))} 0 0 1 ${num(x2)} ${num(y2)}"/>`;
  });
  const markers = header.relations.filter((r) => RELATION_STYLE[r.name].head)
    .map((r) => `<marker id="arrow-${r.name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path class="ah rel-${r.name}" d="M0 0L10 5L0 10Z"/></marker>`);
  out.push(`<defs>${[...markers, ...arcs].join('')}</defs>`);
  for (let k = rings.length - 1; k >= 0; k -= 1) {
    out.push(`<circle class="band band-${k % 3 + 1}" cx="${C}" cy="${C}" r="${num(band(k).outer)}"/>`);
  }
  out.push(`<circle class="band-hole" cx="${C}" cy="${C}" r="${num(RING_INNER)}"/>`);
  captions.forEach((c, k) => {
    out.push(`<g><title>${esc(c.def)}</title><text class="ring-caption"><textPath href="#ring-arc-${k + 1}" startOffset="50%">${esc(captionText(c))}</textPath></text></g>`);
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
    out.push(`<g class="node${isFilled(e) ? ' filled' : ''}${unpinned(e) ? ' unpinned' : ''}"><title>${e.n}. ${esc(e.name)} (${esc(e.publisher)})</title>`);
    out.push(shape(RELATION_STYLE[e.relation].shape, x, y, `mark rel-${e.relation}`));
    out.push(`<text x="${num(x)}" y="${num(RELATION_STYLE[e.relation].shape === 'triangle' ? y + 3 : y)}">${e.n}</text>`);
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

function sample(relation, cls = '') {
  return `<svg class="sample" viewBox="0 0 64 36" aria-hidden="true"><line class="e rel-${relation}" x1="2" y1="18" x2="30" y2="18"/><g class="${cls}">${shape(RELATION_STYLE[relation].shape, 46, 18, `mark rel-${relation}`)}</g></svg>`;
}

// ---------- the page ----------

// The colour tokens and typefaces are typedstandards.org's (apps/web/src/app/globals.css and layout.tsx in
// npstorey/typedstandards at 68c6bf0); that site has no dark scheme, so the dark values are this page's own.
const CSS = `
${FONTS.map((f) => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${f.file}) format("woff2")}`).join('\n')}
:root{--bg:#ffffff;--fg:#0a0a0a;--muted:#5b5b5b;--rule:#e4e4e7;--panel:#fafafa;--code:#f4f4f5;--accent:#1452ff;--accent-ink:#0a2a9c;
--band-1:#eaeffc;--band-2:#f0f0f2;--band-3:#e8f2eb;--absent:#9a3412;--target:#fff4cc;
--r-builds-on:#1452ff;--r-complements:#157349;--r-writes-recordable-output:#7b3f98;--r-could-emit:#a8430c;--r-adjacent:#5b5b5b;
--sans:"Noto Sans",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--display:"Space Grotesk",var(--sans);
--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f10;--fg:#ececee;--muted:#a1a1aa;--rule:#2f2f35;--panel:#18181b;--code:#232327;--accent:#7d9bff;--accent-ink:#b7c7ff;
--band-1:#1a2033;--band-2:#1f1f23;--band-3:#17241b;--absent:#fb9a5b;--target:#3a3212;
--r-builds-on:#7d9bff;--r-complements:#6ccf9d;--r-writes-recordable-output:#cfa2ec;--r-could-emit:#f4a26a;--r-adjacent:#b5b5c0}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 var(--sans)}
[id]{scroll-margin-top:1rem}
h1,h2,h3{font-family:var(--display);font-weight:600;letter-spacing:-.02em}
strong,b,th,dt{font-weight:600}
main{max-width:72rem;margin:0 auto;padding:2rem 1rem 1rem;overflow-wrap:anywhere}
h1{font-size:2rem;line-height:1.15;margin:0 0 1rem}
h2{font-size:1.45rem;margin:2.5rem 0 .75rem;padding-top:1rem;border-top:1px solid var(--rule)}
h3{font-size:1.1rem;margin:1.75rem 0 .5rem}
p,li,dd{max-width:48rem}
li+li{margin-top:.25rem}
a{color:var(--accent)}a:hover{color:var(--accent-ink)}
code{font-family:var(--mono);font-size:.86em;background:var(--code);padding:.05em .3em;border-radius:3px;overflow-wrap:anywhere}
.lede{font-size:1.08rem}
.note{color:var(--muted);font-size:.92rem}
.absent{color:var(--absent);font-weight:600}
.idbar{border-bottom:1px solid var(--rule)}
.bar{max-width:72rem;margin:0 auto;padding:.75rem 1rem;display:flex;flex-wrap:wrap;align-items:baseline;gap:.2rem 1.25rem}
.wordmark{font-family:var(--display);font-weight:600;font-size:1.15rem;letter-spacing:-.025em;color:var(--fg);text-decoration:none}
.wordmark span{color:var(--accent)}
.bar p{margin:0;font-size:.92rem;color:var(--muted);max-width:none}
footer.site{border-top:1px solid var(--rule);margin-top:3rem}
footer.site .bar{display:block;padding:1.5rem 1rem 3rem;font-size:.9rem;color:var(--muted)}
footer.site p{margin:.6rem 0;max-width:56rem}
ul.links{list-style:none;padding:0;margin:.6rem 0;display:flex;flex-wrap:wrap;gap:.3rem 1.5rem}ul.links li{margin:0}
blockquote{margin:.5rem 0;padding:.25rem 0 .25rem 1rem;border-left:3px solid var(--rule);max-width:48rem}
figure.quote{margin:.75rem 0 1rem}figure.quote blockquote{margin:0}figure.quote blockquote p{margin:0}
figure.quote figcaption{margin-top:.3rem;font-size:.88rem;color:var(--muted)}
.check{max-width:48rem;margin:1.25rem 0;padding:.6rem 1rem;border:1px solid var(--rule);border-radius:6px;background:var(--panel)}
.check p{margin:.3rem 0}
pre.command{margin:.4rem 0;padding:.55rem .8rem;background:var(--code);border-radius:4px;font-size:1rem;overflow-x:auto}
pre.command code{background:none;padding:0}
ol.rules,ol.questions{padding-left:1.5rem}ol.rules>li,ol.questions>li{margin-top:1rem;max-width:48rem}ol.rules h3{margin:0 0 .25rem}
figure{margin:1rem 0}
.figure-grid{display:grid;grid-template-columns:minmax(0,46rem) minmax(0,1fr);gap:1.5rem;align-items:start}
svg.map{width:100%;height:auto;display:block}
figcaption{margin-top:.75rem;max-width:48rem}
.key h3{margin:0 0 .25rem;font-size:.95rem}
.key h3 span{font-family:var(--sans);font-weight:400;letter-spacing:0;color:var(--muted)}
.key ol{margin:0 0 1rem;padding-left:2.2rem;font-size:.92rem}
.key li{max-width:none;margin:0}.key a{color:inherit;text-decoration-color:var(--rule)}
.legend{list-style:none;padding:0;margin:1rem 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:.5rem 1.5rem}
.legend li{display:flex;gap:.6rem;align-items:flex-start;font-size:.92rem;margin:0}
svg.sample{flex:none;width:64px;height:36px}
.glyph{flex:none;width:64px;text-align:center;font-size:1.3rem;line-height:1.2}.glyph.ab{font-size:1rem;font-weight:600}
.band{stroke:none}.band-1{fill:var(--band-1)}.band-2{fill:var(--band-2)}.band-3{fill:var(--band-3)}.band-hole{fill:var(--bg)}
svg text{dominant-baseline:central;text-anchor:middle}
.ring-caption{font-size:11.5px;font-weight:600;fill:var(--muted)}
.e{fill:none;stroke-width:1.6}
.rel-builds-on{stroke:var(--r-builds-on)}.e.rel-builds-on{marker-end:url(#arrow-builds-on)}
.rel-complements{stroke:var(--r-complements)}
.rel-writes-recordable-output{stroke:var(--r-writes-recordable-output)}.e.rel-writes-recordable-output{stroke-dasharray:1 4;stroke-linecap:round;stroke-width:2.2}
.rel-could-emit{stroke:var(--r-could-emit)}.e.rel-could-emit{stroke-dasharray:10 3 2 3;marker-end:url(#arrow-could-emit)}
.rel-adjacent{stroke:var(--r-adjacent)}
.ah{stroke:none}.ah.rel-builds-on{fill:var(--r-builds-on)}.ah.rel-could-emit{fill:var(--r-could-emit)}
.mark{fill:var(--panel);stroke-width:2.2}
.filled .mark.rel-builds-on{fill:var(--r-builds-on)}.filled .mark.rel-complements{fill:var(--r-complements)}.filled .mark.rel-writes-recordable-output{fill:var(--r-writes-recordable-output)}.filled .mark.rel-could-emit{fill:var(--r-could-emit)}.filled .mark.rel-adjacent{fill:var(--r-adjacent)}.filled .mark.plain{fill:var(--muted)}
.unpinned .mark{stroke-dasharray:3 2.5}.mark.plain{stroke:var(--muted)}
.node text{font-size:11px;font-weight:600;fill:var(--fg)}.node.filled text{fill:var(--bg)}
.node text.unpinned-label{fill:var(--absent)}
.hub{fill:var(--panel);stroke:var(--muted);stroke-width:1.2}
.hub-name{font-family:var(--display);font-size:14px;font-weight:600;fill:var(--fg)}
.hub-note{font-size:11.5px;fill:var(--muted)}
ul.fills{padding-left:1.25rem}
table{border-collapse:collapse;width:100%;margin:.75rem 0 1.25rem;font-size:.92rem}
th,td{border-top:1px solid var(--rule);padding:.45rem .6rem;text-align:left;vertical-align:top;overflow-wrap:normal}
td a,td code{overflow-wrap:anywhere}
th{border-top:2px solid var(--rule);background:var(--panel)}
td small{display:block;color:var(--muted);font-size:.85em}
tr:target>td{background:var(--target)}
table.records td:nth-child(2),table.records td:nth-child(3),table.records td:nth-child(4),table.refs td:nth-child(1),table.refs td:nth-child(3){white-space:nowrap}
pre.listing{margin:.5rem 0;padding:.6rem;background:var(--code);border-radius:4px;font-size:.78rem;line-height:1.45;overflow-x:auto;white-space:pre}
details{margin:.6rem 0 1rem;border:1px solid var(--rule);border-radius:6px;background:var(--panel)}
details>summary{cursor:pointer;font-weight:600;padding:.55rem .9rem}
details[open]>summary{border-bottom:1px solid var(--rule)}
details>:not(summary){margin-left:.9rem;margin-right:.9rem}
details.fold{border:0;border-radius:0;background:none;margin:2.5rem 0 0;padding-top:1rem;border-top:1px solid var(--rule)}
details.fold>summary{padding:0}details.fold[open]>summary{border-bottom:0}details.fold>:not(summary){margin-left:0;margin-right:0}
details.fold>summary>h2{display:inline;margin:0;padding:0;border:0}
dl{margin:.5rem 0 1rem}
dt{margin-top:.4rem}
dd{margin:0 0 .2rem 1rem}
@media (max-width:62rem){.figure-grid{grid-template-columns:minmax(0,1fr)}.key{columns:2 16rem}}
@media (max-width:44rem){
main{padding:1.25rem 1rem 1rem}
h1{font-size:1.55rem}
table.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}
table.stack tr{border-top:2px solid var(--rule);padding:.4rem 0}
table.stack td{border:0;padding:.15rem 0;overflow-wrap:anywhere;white-space:normal}
table.stack td[data-label]::before{content:attr(data-label);display:block;font-size:.78em;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
}
`;

// Header cells are text with inline Markdown; body cells arrive already rendered to HTML. `ids`, if given,
// holds one anchor per row. A table without `labels` takes no phone-width labels.
function table(head, rows, { cls = '', labels = true, ids = [] } = {}) {
  const th = head.map((h) => `<th scope="col">${inline(h)}</th>`).join('');
  const td = (c, i) => (labels ? `<td data-label="${esc(stripMd(head[i]))}">${c}</td>` : `<td>${c}</td>`);
  const body = rows.map((r, i) => `<tr${ids[i] ? ` id="${esc(ids[i])}"` : ''}>${r.map(td).join('')}</tr>`).join('\n');
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

// The proof table in three bullets, from its own rows: every row is named by its first cell, grouped by its
// status and introduced by the first sentence of that status's definition. The third bullet holds the
// "Not covered" rows and the "Online only" row, so each stays visible while the table itself folds.
const PROOF_STATUSES = ['Attested', 'Asserted', 'Not covered', 'Online only'];
function proofSummary(proof) {
  const tbl = proof.blocks.find((b) => b.kind === 'table');
  const defs = proof.blocks.find((b) => b.kind === 'defs');
  if (!tbl || !defs) throw new Error(`${README}: the "${proof.heading}" section has no table or no definitions`);
  const groups = new Map(PROOF_STATUSES.map((s) => [s, []]));
  for (const row of tbl.rows) {
    const s = PROOF_STATUSES.find((x) => row[1] === x || row[1].startsWith(`${x} `) || row[1].startsWith(`${x},`));
    if (!s) throw new Error(`${README}: the row "${row[0]}" has status "${row[1]}", which the page does not summarize`);
    groups.get(s).push(`${row[0].charAt(0).toLowerCase()}${row[0].slice(1)}`);
  }
  const part = (s) => {
    if (!groups.get(s).length) return '';
    const d = defs.defs.find((x) => x.term === `${s}:`);
    if (!d) throw new Error(`${README}: no definition of ${s}`);
    return `<strong>${s}</strong>, ${inline(d.text.replace(/\..*$/, ''))}: ${groups.get(s).map(inline).join('; ')}.`;
  };
  return [part('Attested'), part('Asserted'), [part('Not covered'), part('Online only')].filter(Boolean).join(' ')].filter(Boolean);
}

// A record's anchor on the page: its name, with each / written -, after "record-".
const anchor = (r) => `record-${r.name.replace(/\//g, '-')}`;
const rowLink = (r, label) => `<a href="#${esc(anchor(r))}">${label}</a>`;

// One ring's edges as text: relation, basis, and the other end's location and SHA-256, each linked to the row
// of the record that carries it.
function ringRows(edges) {
  return edges.map((e) => {
    const intent = e.intent?.statedIn?.length
      ? `<small>Stated in: ${e.intent.statedIn.map((s) => `${link(s.url)} (${esc(s.date)})`).join('; ')}.</small>`
      : '';
    return [
      String(e.n),
      `${esc(e.name)}<small>${esc(e.publisher)}</small><small><code>${esc(e.far.id)}</code></small>`,
      `${arrow(e)} ${esc(e.relation)}`,
      `${esc(e.basis)}${intent}`,
      `${link(e.far.ref.location)}<br>${unpinned(e) ? notPinnedText(e) : `<code>${esc(e.far.ref.sha256)}</code>`}`,
      rowLink(e.record, 'record'),
    ];
  });
}

// One row of the records table: an edge by its name and publisher, anything else by its file; an unpinned
// edge says so, with the reason.
function recordRow(r, text, subject, verify) {
  let label = `<code>${esc(r.file)}</code>`;
  if (r.role === 'edge') {
    const e = yamlDocs(text(r.file), r.file)[0].toJS();
    const x = e['x-typedstandards'];
    const far = e.subject.id === subject ? e.object : e.subject;
    const np = far.ref?.sha256 === null ? `<small><span class="absent">not pinned</span>: sha256 null. ${esc(x.pin?.reason ?? 'No reason given.')}</small>` : '';
    label = `${esc(x.name)}<small>${esc(x.publisher)}</small><small><code>${esc(r.file)}</code></small>${np}`;
  }
  return [label, esc(r.step), esc(r.as), verify(r)];
}

// What one step added, from the roles and files of its records.
function stepText(records) {
  const parts = [];
  for (const role of ['core', 'map-v1', 'map-header']) {
    for (const r of records.filter((x) => x.role === role)) parts.push(`<code>${esc(r.file)}</code>`);
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

// A pinned file's place, from its raw GitHub location: "owner/repo path at abcdef0".
function pinnedFile(location) {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(location);
  return m ? `${esc(m[1])} <code>${esc(m[3])}</code> at ${m[2].slice(0, 7)}` : esc(location);
}
const lineText = (lines) => (lines.includes('-') ? `lines ${lines.replace('-', '–')}` : `line ${lines}`);

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
  const captions = ringCaptions(policy, map);
  const fill = fillOf(policy, map);
  const [how, proof] = parseReadme(text(README));
  const { header, edges } = map;
  const signedCount = inputs.filter((i) => i.bundle).length;
  const nOut = edges.filter((e) => e.outward).length;
  const notPinned = edges.filter(unpinned);
  const nearRefs = [...new Set(edges.map((e) => `${e.near.id} ${e.near.ref?.location} ${e.near.ref?.sha256}`))];
  const verdictCol = core.table.head.length - 1;
  const notDone = core.table.rows.filter((r) => r[verdictCol] === 'NOT DONE').length;
  const firstIn = edges.find((e) => !e.outward);
  const firstOut = edges.find((e) => e.outward);
  const steps = [];
  for (const r of shown) {
    if (!steps.length || steps[steps.length - 1].step !== r.step) steps.push({ step: r.step, records: [] });
    steps[steps.length - 1].records.push(r);
  }
  const newest = steps[steps.length - 1];
  const stepTime = (s) => eastern(s.records[0].createdAt);
  const current = shown.filter((r) => r.as === 'current');
  const versionOne = shown.filter((r) => r.as === 'version 1');
  const withdrawn = shown.filter((r) => r.as === 'withdrawn');
  const anchors = shown.map(anchor);
  const clash = anchors.find((a, i) => anchors.indexOf(a) !== i);
  if (clash) throw new Error(`two records share the anchor ${clash}`);
  const recordCount = `${count(current.length, 'current record', 'current records')}${versionOne.length ? ' and version 1' : ''}${withdrawn.length ? `, and ${withdrawn.length} withdrawn` : ''}`;
  const repoLink = `<a href="https://${REPOSITORY}">${esc(REPOSITORY)}</a>`;

  const h = [];
  h.push('<!doctype html>');
  h.push(`<!-- ${generatedFrom} -->`);
  h.push(`<!-- Generated by ${GENERATOR}; do not edit. npm run check:page compares this file with a fresh generation. -->`);
  h.push('<html lang="en">');
  h.push('<head>');
  h.push('<meta charset="utf-8">');
  h.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  h.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src data:; base-uri 'none'; form-action 'none'">`);
  h.push('<meta name="referrer" content="no-referrer">');
  h.push('<meta name="color-scheme" content="light dark">');
  h.push(`<meta name="generator" content="${GENERATOR}">`);
  h.push('<link rel="icon" href="data:,">');
  h.push(`<title>${esc(header.title)}</title>`);
  h.push(`<style>${CSS}</style>`);
  h.push('</head>');
  h.push('<body>');

  // The identity bar: affiliation only. How the example's key fits is said where the page first points to the
  // verifier, in the offline check below, and in the footer.
  h.push('<header class="idbar">');
  h.push(`<div class="bar"><a class="wordmark" href="${SITE}" aria-label="Typed Standards">Typed<span>Standards</span></a><p>A worked example from the Typed Standards project.</p></div>`);
  h.push('</header>');
  h.push('<main>');

  // Opening: the model, what this page is, what Typed Standards is, and what the record says; then the
  // offline check and the newest change.
  h.push('<header>');
  h.push(`<h1>${esc(header.title)}</h1>`);
  h.push(`<p class="lede">SciOS's paper ${paperLink()} describes open source and open science as cores, groups of people who hold a domain's judgment, and satellites, individuals or groups who each work on one artifact and orbit one or more cores. This page is a worked example: Typed Standards records used to describe Typed Standards' own position in that model. <a href="${SITE}">Typed Standards</a> is an open standard for signed records of how an analytical artifact was produced (<a href="${SPECIFICATION}">the specification</a>, a v0.1 working draft), with a reference producer and verifier (<a href="${IMPLEMENTATIONS}">typedstandards</a>) and a reference publishing application (<a href="${PUBLISHING_APP}">civic-ai-tools-website</a>). Applied to itself, the model places Typed Standards as a ${esc(core.selfAssessment)}: its signed record, <code>core.md</code>, says so and <a href="#basis">gives its basis</a>.</p>`);
  h.push('<div class="check">');
  h.push(`<p><strong>Check every record offline</strong> (${recordCount}), in a clone of ${repoLink}:</p>`);
  h.push('<pre class="command"><code>npm ci &amp;&amp; node verify.mjs</code></pre>');
  h.push('<p class="note">The output should match <a href="verify-output.txt"><code>verify-output.txt</code></a>. Each record also links to typedstandards.org\'s verifier. Records are signed with this example\'s own key, so the verifier reads <a href="#publisher">“Unknown publisher”</a> and checks every signature anyway. That is what a key-derived identity means. This page is a view of the records and is not signed itself.</p>');
  h.push('</div>');
  h.push(`<p><strong>Newest change:</strong> version ${esc(newest.step)}, ${esc(stepTime(newest))}: ${stepText(newest.records)}. <a href="#records">The records</a> lists every record.</p>`);
  h.push(`<p class="note">${esc(ZONE_RULE)}</p>`);
  h.push('</header>');

  // Two questions for the paper's authors, measured from the drawn edges: a report from implementation.
  const others = edges.filter((e) => !e.outward);
  const account = REPOSITORY.split('/')[1];
  const sameAccount = others.filter((e) => e.far.ref?.location?.startsWith(`https://raw.githubusercontent.com/${account}/`));
  const byPublisher = new Map();
  for (const e of others.filter((x) => !sameAccount.includes(x))) byPublisher.set(e.publisher, [...(byPublisher.get(e.publisher) ?? []), e.name]);
  const elsewhere = [...byPublisher].map(([p, names]) => `${word(names.length)}, ${andList(names.map(esc))}, published by ${esc(p)}`);
  h.push('<section id="questions">');
  h.push('<h2>Two questions from building this map</h2>');
  h.push('<p class="note">A report from implementation, not a review: two things this map needed that the paper\'s published examples do not show.</p>');
  h.push('<ol class="questions">');
  h.push(`<li><strong>Is a relation between two artifacts meant to be a typed edge?</strong> In the paper's examples, dependence is typed in one place, as a zone on an orbits edge from a satellite to a core: <code>orbitZone: critical-dependency</code>, and ${q('cryptoseal was an orbits / critical-dependency edge')}. The paper also says any number of cores can ${q('recognize an artifact, depend on it, or map it')}. This map's ${edges.length} edges run between artifacts and standards, in both directions, with no core at either end. Should such a relation be expressible in the schema, and as what edge type?</li>`);
  h.push(`<li><strong>How is an edge a third party asserts told apart from one its subject declares?</strong> One key signs all ${edges.length} edges drawn here. ${esc(header.subject)} is the subject of ${nOut}. ${cap(word(others.length))} name another project as subject: ${[...(sameAccount.length ? [`${word(sameAccount.length)} whose sources are in the same GitHub account as this repository`] : []), ...elsewhere].join(', and ')}. The paper's orbits example has a <code>type</code>, an <code>id</code>, a <code>createdAt</code>, a <code>subject</code>, an <code>object</code> and an <code>orbitZone</code>, and no field for who asserts the edge; insertion is ${q('how satellites declare or are recognized as orbiting a core')}.</li>`);
  h.push('</ol>');
  h.push(`<p class="note">Quoted from ${PAPER.publisher}, ${paperLink()} (${paperRead()}): “Core &lt;-&gt; Satellite” and “Conflict, competition, and common cores”, and the worked examples on the Veil Project and on cryptoseal.</p>`);
  h.push('</section>');

  // The map
  const byRing = captions.map((c) => ({ ...c, edges: edges.filter((e) => e.ring === c.ring) }));
  h.push('<section id="map">');
  h.push('<h2>The map</h2>');
  h.push('<figure>');
  h.push('<div class="figure-grid">');
  h.push(picture(map, core, captions, fill));
  h.push('<div class="key">');
  for (const c of byRing) {
    h.push(`<h3>Ring ${esc(c.ring)} (${c.edges.length}) <span>${esc(c.caption)}</span></h3>`);
    h.push(`<ol>${c.edges.map((e) => `<li value="${e.n}">${rowLink(e.record, esc(e.name))}${unpinned(e) ? ' <span class="absent">(not pinned)</span>' : ''}</li>`).join('')}</ol>`);
  }
  h.push('</div>');
  h.push('</div>');
  h.push(`<figcaption><strong>${esc(header.subject)}</strong> is at the centre only because it is one end of every edge: the subject of ${nOut} and the object of ${edges.length - nOut}. Its own record, <code>core.md</code>, assesses it as a ${esc(core.selfAssessment)} and does not declare <code>type: core</code>. The rings group each edge's other end by kind, as the header defines them. A ring is not a distance or a rank, and none is an orbit: the map has no orbits edge (<a href="#absent">What the map leaves out</a>). Each numbered node is one edge's other end. <a href="#edges">The edges, ring by ring</a> give the same as text.</figcaption>`);
  h.push('</figure>');
  h.push('<ul class="legend">');
  const headed = header.relations.filter((r) => RELATION_STYLE[r.name].head).map((r) => r.name);
  const neither = header.relations.filter((r) => neitherDepends(header, r.name)).map((r) => `<code>${esc(r.name)}</code>`);
  const neitherText = neither.length === 1
    ? ` ${neither[0]} says neither depends on the other, so its line has no head; the tables give each edge's direction.`
    : ` ${andList(neither)} each say neither depends on the other, so their lines have no head; the tables give each edge's direction.`;
  h.push(`<li><span class="glyph ab" aria-hidden="true">A ${ARROW_OUT} B</span><span>Every edge runs from subject to object, the direction of the paper's orbits edge, from satellite to core. An arrowhead marks ${andList(headed.map((n) => `<code>${esc(n)}</code>`))} and points at the object: A ${ARROW_OUT} B reads “A ${esc(headed[0] ?? header.relations[0].name)} B”.${neither.length ? neitherText : ''}</span></li>`);
  for (const r of header.relations) {
    const n = edges.filter((e) => e.relation === r.name).length;
    h.push(`<li>${sample(r.name)}<span><code>${esc(r.name)}</code> (${n}), ${RELATION_STYLE[r.name].shape} and ${RELATION_STYLE[r.name].line}. ${esc(r.def)}</span></li>`);
  }
  if (fill) {
    const inRing = edges.filter((e) => e.ring === fill.ring);
    const nFilled = inRing.filter((e) => fill.filled.has(e.n)).length;
    const dot = (cls) => `<svg class="sample" viewBox="0 0 64 36" aria-hidden="true"><g class="${cls}">${shape('circle', 46, 18, 'mark plain')}</g></svg>`;
    h.push(`<li>${dot('filled')}<span>Ring ${esc(fill.ring)}, filled: ${esc(fill.filledText)} (${nFilled}; <a href="#fill">the lines</a>).</span></li>`);
    h.push(`<li>${dot('')}<span>Ring ${esc(fill.ring)}, hollow: ${esc(fill.hollowText)} (${inRing.length - nFilled}).</span></li>`);
  }
  h.push(`<li><svg class="sample" viewBox="0 0 64 36" aria-hidden="true"><g class="unpinned">${shape('circle', 46, 18, 'mark plain')}</g></svg><span>Dashed outline: the source has no fixed version, so it is <span class="absent">not pinned</span> (sha256 null). ${count(notPinned.length, 'edge', 'edges')}.</span></li>`);
  h.push(`<li><span class="glyph" aria-hidden="true">${ARROW_OUT} ${ARROW_IN}</span><span>In the tables, ${ARROW_OUT} marks an edge whose subject is ${esc(header.subject)} (${esc(header.subject)} ${esc(firstOut.relation)} ${esc(firstOut.name)}). ${ARROW_IN} marks one whose subject is the project in the row (${esc(firstIn.name)} ${esc(firstIn.relation)} ${esc(header.subject)}).</span></li>`);
  h.push('</ul>');
  if (fill) {
    const inRing = edges.filter((e) => e.ring === fill.ring);
    const filledEs = inRing.filter((e) => fill.filled.has(e.n));
    const hollowEs = inRing.filter((e) => !fill.filled.has(e.n));
    h.push(`<h3 id="fill">Ring ${esc(fill.ring)}: filled and hollow nodes</h3>`);
    h.push(`<p class="note">The host's reading of each project's pinned file, declared in <a href="host-policy.yaml"><code>host-policy.yaml</code></a>. It is not a signed statement.</p>`);
    h.push(`<p><strong>Filled (${filledEs.length})</strong>: ${esc(fill.filledText)}.</p>`);
    h.push(`<ul class="fills">${filledEs.map((e) => {
      const f = fill.filled.get(e.n);
      return `<li>${e.n}. ${esc(e.name)}: <a href="${esc(f.location)}">${pinnedFile(f.location)}</a>, ${lineText(f.lines)}, pinned ${esc(e.createdAt)}: <q cite="${esc(f.location)}">${esc(f.quote)}</q></li>`;
    }).join('')}</ul>`);
    h.push(`<p><strong>Hollow (${hollowEs.length})</strong>: ${esc(fill.hollowText)}. ${hollowEs.map((e) => `${e.n}. ${esc(e.name)}${unpinned(e) ? ', which has no pinned file' : ''}`).join('; ')}.</p>`);
  }
  h.push('<h3 id="edges">The edges, ring by ring</h3>');
  h.push(map.from === 'records'
    ? `<p class="note">Every current edge record, in the order it was signed: the picture as text. ${ARROW_OUT} and ${ARROW_IN} as in the legend. Each row links to the row of the record that carries the edge, in <a href="#records">The records</a>. ${esc(header.refs)}</p>`
    : `<p class="note">Every edge in <code>map.yaml</code>, version 1, in document order: the picture as text. ${ARROW_OUT} and ${ARROW_IN} as in the legend. Each row links to version 1's record, which carries every edge. ${esc(header.refs)}</p>`);
  h.push(nearRefs.length === 1
    ? `<p class="note">${esc(header.subject)}'s own end carries the same ref on every edge: ${link(edges[0].near.ref.location)}, sha256 <code>${esc(edges[0].near.ref.sha256)}</code>.</p>`
    : `<p class="note">${esc(header.subject)}'s own end carries ${nearRefs.length} different refs; see the edge files.</p>`);
  for (const c of byRing) {
    h.push(`<details id="ring-${esc(c.ring)}"><summary>Ring ${esc(c.ring)} (${c.edges.length}): ${esc(c.caption)}</summary>`);
    h.push(table(['#', 'Name', 'Relation', 'Basis', 'Location and SHA-256', 'Record'], ringRows(c.edges), { cls: 'refs' }));
    h.push('</details>');
  }
  h.push('</section>');

  // The paper's rules: each quoted where the example meets it, and a plain statement where it does not.
  const CRUCIBLE = 'the worked example on crucible, a materials-science core';
  h.push('<section id="rules">');
  h.push('<h2>The paper\'s rules, and what this example does</h2>');
  h.push('<p class="note">Where the paper states a rule, it is quoted here, not paraphrased. Two of these rules are not implemented in this example, and one is not the paper\'s.</p>');
  h.push('<ol class="rules">');
  h.push(`<li><h3>Refs by content hash</h3>${quote('The agent pulls SMRS v3 by its content hash, not by a URL that might have moved or been edited since.', CRUCIBLE)}<p><strong>Here:</strong> every ref in <code>core.md</code> and the map gives a location and the SHA-256 of what that location served; ${word(notPinned.length)} ${notPinned.length === 1 ? 'edge gives' : 'edges give'} sha256 null and the reason (<a href="#absent">What the map leaves out</a>). The paper's examples write a ref as <code>ref: &lt;location + content-hash&gt;</code> in some places and <code>ref: &lt;content-hash&gt;</code> in others; this example always writes both. A check recomputes each signed file's own SHA-256. The source digests are signed assertions, which anyone can download again and compare.</p></li>`);
  h.push(`<li><h3>Endorsements</h3>${quote('Any participant can endorse a core, or withdraw a prior endorsement — append-only and attributable.', '“Cores”')}<p><strong>Here:</strong> <span class="absent">not built.</span> This example makes no endorsement. Its own records keep both properties: a signed file is never rewritten, a correction is a signed withdrawal plus a new record, the withdrawn record stays served (<a href="#records">The records</a>), and one <code>did:key</code> signs every record and every withdrawal.</p></li>`);
  h.push(`<li><h3>Agent contributions</h3>${quote('…stamped with provenance that marks it agent-generated and human-validated.', CRUCIBLE)}<p><strong>Here:</strong> <span class="absent">not implemented.</span> No record here marks anything as agent-generated or human-validated. Each record's labels say that a script wrote its file, and nothing verifies that label. The repository's commits name the AI assistant in a co-author line; the records carry no such mark.</p></li>`);
  h.push('<li><h3>Identifiers</h3><p><strong>Here:</strong> the paper names no scheme for identifying who signs or publishes a record; its examples give each record an <code>id</code> such as <code>veil.org</code>. The signer here is a <code>did:key</code>, an identifier derived from its public key (hub ADR-0030): this example\'s choice, not the paper\'s. It shows which key signed, not who holds it.</p></li>');
  h.push('</ol>');
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
    ? `<ul>${notPinned.map((e) => `<li>${e.n}. ${esc(e.name)} (${link(e.far.ref.location)}): sha256 null. ${esc(e.pin.reason ?? 'No reason given.')}</li>`).join('')}</ul><p class="note">Why no digest: a ref here is a file at a 40-character commit, a dated W3C TR URL, an rfc-editor.org text or a published release archive, each a location whose bytes do not change. A page that can change between two reads has no such digest, so the edge gives the location, sha256 null and the reason instead.</p>`
    : '<p>None.</p>');
  h.push(`<h3>Dropped (${header.dropped.length})</h3>`);
  h.push(`<p class="note">Considered for the map and left out, with the reason <code>${esc(header.file)}</code> gives.</p>`);
  h.push(table(['Name', 'Seed', 'Reason'], header.dropped.map((d) => [esc(d.name), esc(d.seed), esc(d.reason)])));
  h.push('</section>');

  // core.md
  h.push('<section id="core">');
  h.push('<h2>The core record: <code>core.md</code></h2>');
  h.push(`<p><code>selfAssessment: ${esc(core.selfAssessment)}</code>, <code>typeDeclared: ${esc(core.typeDeclared)}</code>. Its record: ${verify(coreRecord)}.</p>`);
  h.push(`<h3 id="basis">The record's basis for its self-assessment (${core.selfAssessmentBasis.length})</h3>`);
  h.push(`<ul>${core.selfAssessmentBasis.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
  h.push(quote('One library or repo surfacing a record is, in spirit, a satellite.', '“What a core is not”'));
  h.push(`<h3>Absence markers in the front matter (${core.markers.length})</h3>`);
  h.push(`<p class="note">Comment lines ${andList(core.markers.map((m) => String(m.line)))} of <code>core.md</code>. A YAML parser discards comments, so the generator reads them from the text.</p>`);
  h.push(table(['Commented-out field', 'As written'], core.markers.map((m) => [
    `<code>${esc(m.field)}</code>`, `<span class="absent">${esc(m.text.replace(/^(NOT [A-Z]+).*$/, '$1'))}</span>${esc(m.text.replace(/^NOT [A-Z]+/, ''))}`,
  ])));
  h.push(`<h3>${esc(core.heading)}</h3>`);
  h.push(`<p class="note">The table from <code>core.md</code> (lines ${core.table.firstLine} to ${core.table.lastLine}), whole. ${notDone} of ${core.table.rows.length} verdicts read NOT DONE.</p>`);
  h.push(table(core.table.head, core.table.rows.map((r) => r.map((c, i) => (i === verdictCol && c === 'NOT DONE' ? `<span class="absent">${inline(c)}</span>` : inline(c))))));
  h.push('</section>');

  // The records: one row per served record, each with its own anchor and its verifier link.
  h.push('<section id="records">');
  h.push('<h2>The records</h2>');
  h.push(`<p>This host serves ${count(served.records.length, 'signed record', 'signed records')}: ${recordCount}. The rows are in the order the records were signed. Each has its own anchor, <code>#record-</code> followed by the record's name with each <code>/</code> written <code>-</code>, and links to typedstandards.org's verifier. <a href="#mechanics">Versions, withdrawals and the host's rule</a> gives each signing step and each withdrawal.</p>`);
  h.push(table(['Record', 'Version', 'Shown as', 'Check'], shown.map((r) => recordRow(r, text, header.subject, verify)), { cls: 'records', ids: anchors }));
  h.push('</section>');

  // How the records change: the signing steps, the withdrawals, and whose rules the page follows.
  h.push('<section id="mechanics">');
  h.push('<details class="fold"><summary><h2>Versions, withdrawals and the host\'s rule</h2></summary>');
  h.push('<p>Each version is one signing step, and no record is ever re-signed. A correction is a withdrawal plus a new record, and the withdrawn record stays served.</p>');
  h.push(`<ol class="versions">${steps.map((s) => `<li>Version ${esc(s.step)}, ${esc(stepTime(s))}: ${stepText(s.records)}.</li>`).join('')}</ol>`);
  h.push(`<h3>Withdrawn (${withdrawn.length})</h3>`);
  h.push(withdrawn.length
    ? `<ul>${withdrawn.map((r) => `<li>${recordLabel(r, text)}, withdrawn ${esc(eastern(r.withdrawn?.at))}: ${esc(r.withdrawn?.reason ?? '')} ${rowLink(r, 'Its row')}.</li>`).join('')}</ul>`
    : '<p>None.</p>');
  h.push('<h3>Whose rules these are</h3>');
  h.push('<p>What this page shows, and how, follows <a href="host-policy.yaml"><code>docs/host-policy.yaml</code></a>: the host\'s own display rule. It is not a Typed Standards record, and no Typed Standards check covers it.</p>');
  h.push(`<p>The key's registry, <a href=".well-known/typed-publisher.json"><code>docs/.well-known/typed-publisher.json</code></a>, is the example publisher's own statement that the key is active. It is not an endorsement by the Typed Standards specification or by typedstandards.org, although this host is a subdomain of typedstandards.org. Every record's view names it as <code>trustRegistryUrl</code>, which is not part of what the key signed.</p>`);
  h.push('<p>A possible next step, not a commitment: publishing these records into a store that others operate, where scoring that others write can run over them.</p>');
  h.push('</details>');
  h.push('</section>');

  // What the records prove / what they do not: every row named in three bullets, the table itself folded.
  h.push('<section id="proof">');
  h.push(`<h2>${inline(proof.heading)}</h2>`);
  h.push(`<ul class="summary">${proofSummary(proof).map((b) => `<li>${b}</li>`).join('')}</ul>`);
  h.push(`<details><summary>The table, with the check behind each row</summary>`);
  h.push(`<p class="note">From <code>README.md</code> (lines ${proof.lines[0]} to ${proof.lines[1]}), whole. <code>README.md</code> is not a signed record.</p>`);
  h.push(blocks(proof.blocks));
  h.push('</details>');
  h.push('</section>');

  // Provenance
  h.push('<section id="provenance">');
  h.push('<h2>Provenance</h2>');
  h.push(`<p><code>${esc(generatedFrom)}</code></p>`);
  h.push(`<p>Generated by <code>${GENERATOR}</code> in ${repoLink}, with one YAML parser, <code>yaml</code>, pinned exactly. The page carries no generation time: it is a function of its inputs alone.</p>`);
  h.push(`<details><summary>The ${inputs.length} inputs</summary>`);
  h.push(`<p class="note">The digest above is the SHA-256 of this listing, which <code>shasum -a 256</code> prints for the files in this order. The first ${signedCount} are signed: each file's bytes are the inline output of its record, and its SHA-256 is that record's <code>contentHash.sha256</code>; the generator refuses to write this page otherwise. The last three are not signed. <code>README.md</code> is an input because the sections above that come from it are in no signed file.</p>`);
  h.push(`<pre class="listing">${esc(inputListing)}</pre>`);
  h.push('</details>');
  h.push('</section>');
  h.push('</main>');

  // The footer: who signs, why the verifier reads "Unknown publisher", and the links.
  h.push('<footer class="site">');
  h.push('<div class="bar">');
  h.push(`<p id="publisher"><strong>Publisher.</strong> The records are signed with this example's own key, <code>${esc(policy.signer)}</code>. The host's registry lists it as active; that is this example's own statement, not an endorsement by the Typed Standards specification or by typedstandards.org. The registry's host, ${esc(new URL(served.trustRegistryUrl).host)}, is not listed in typedstandards.org's host directory, so typedstandards.org's verifier reads “Unknown publisher”, which it reports separately from the signature checks.</p>`);
  h.push(`<ul class="links"><li>Repository: ${repoLink}</li><li>Verifier: <a href="${SITE}/verify">typedstandards.org/verify</a></li><li>Publisher key: <a href=".well-known/typed-publisher.json"><code>.well-known/typed-publisher.json</code></a></li><li>Host policy: <a href="host-policy.yaml"><code>host-policy.yaml</code></a>, the host's own display rule, not signed</li></ul>`);
  h.push('<p>Text: CC BY 4.0. Code: MIT. Typefaces: Space Grotesk and Noto Sans, SIL Open Font License 1.1 (<a href="fonts/README.md"><code>fonts/</code></a>). Third-party documents are cited by location and SHA-256 and are not reproduced.</p>');
  h.push('</div>');
  h.push('</footer>');
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
