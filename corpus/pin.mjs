#!/usr/bin/env node
// Program 1 of 2: pin the sources, then write the published content files.
//
//   node corpus/pin.mjs            fetch every source into data/ and write corpus/manifest.json, only
//                                  if the manifest does not exist yet; then write core.md, the map's
//                                  header map/header.yaml and one file per edge, map/edges/<key>.yaml
//   node corpus/pin.mjs --force    refetch and overwrite corpus/manifest.json (never needed for a rerun)
//   node corpus/pin.mjs --verify   re-hash the bytes in data/ against the manifest; no network, no writes
//   node corpus/pin.mjs --draft    write the files with every digest shown as "pending"; no fetch and no
//                                  manifest (the G1 drafts only)
//
// The fetch stage runs once. After it, every file this program writes is a pure function of
// corpus/sources.json, corpus/core.template.md and corpus/manifest.json: no clock, no network, no
// randomness. A rerun writes the same bytes, which `git diff --exit-code core.md map.yaml map/` shows.
//
// map.yaml is version 1's map: one file, header and every edge, signed as one record. It is never
// overwritten. When it exists, this program computes what the current inputs would write in that form
// and says whether map.yaml still equals it; while the inputs are version 1's, it does.
//
// The manifest is append-only. A later addition appends its sources and changes no existing entry and
// not `pinnedAt`, because core.md's and the header's `createdAt` are pinnedAt's date. Each edge's
// `createdAt` is the fetch date of its other end's source (pinnedAt's date for an unpinned source), so an
// added edge carries its own date and leaves every existing file byte-identical.
//
// Every fetch is curl with a header dump, no redirects followed. A source must answer HTTP 200 with a
// non-empty body whose byte count matches any Content-Length. An empty body hashes to e3b0c442…, the same
// digest for every source, so the program also refuses any two sources that share a digest.
//
// This program signs nothing and packages nothing. package/build.mjs, run afterwards, reads the files
// from disk and packages them; that is what makes the records' capture method `script-run`.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = path.join(ROOT, 'corpus', 'sources.json');
const TEMPLATE = path.join(ROOT, 'corpus', 'core.template.md');
const MANIFEST = path.join(ROOT, 'corpus', 'manifest.json');
const DATA = path.join(ROOT, 'data');
const CORE_OUT = path.join(ROOT, 'core.md');
const MAP_OUT = path.join(ROOT, 'map.yaml');
const HEADER_OUT = path.join(ROOT, 'map', 'header.yaml');
const EDGES_DIR = path.join(ROOT, 'map', 'edges');
const HEADER_COMMENT = [
  'map/header.yaml: the header of the map of Typed Standards\' technical relations to public projects.',
  'Each edge is one file in map/edges/. Written by corpus/pin.mjs; this file\'s exact bytes are the output of',
  'one signed Typed Standards record in package/.',
];
const EDGE_COMMENT = [
  'One edge of the map whose header is map/header.yaml. Written by corpus/pin.mjs; this file\'s exact bytes',
  'are the output of one signed Typed Standards record in package/.',
];
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const rel = (p) => path.relative(ROOT, p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const nowSeconds = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const die = (msg) => {
  console.error(`stopped: ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------------------------------------------
// Fetch stage

function curlVersion() {
  return execFileSync('curl', ['--version'], { encoding: 'utf8' }).split('\n')[0].split(' ').slice(0, 2).join(' ');
}

function fetchOne(src) {
  const file = path.join(DATA, `${src.key}.bin`);
  const headers = path.join(DATA, `${src.key}.headers`);
  const fetchedAt = nowSeconds();
  let status;
  try {
    const out = execFileSync(
      'curl',
      ['-sS', '--max-time', '60', '--proto', '=https', '-D', headers, '-o', file, '-w', '%{http_code}', src.location],
      { encoding: 'utf8' },
    );
    status = Number(out.trim());
  } catch (e) {
    die(`${src.key}: curl failed for ${src.location}: ${String(e.message).split('\n')[0]}`);
  }
  if (status !== 200) die(`${src.key}: HTTP ${status} for ${src.location} (redirects are not followed)`);
  const bytes = fs.statSync(file).size;
  if (bytes === 0) die(`${src.key}: empty body from ${src.location}`);
  const sha256 = sha256File(file);
  if (sha256 === EMPTY_SHA256) die(`${src.key}: body hashes to the empty-input digest`);
  const head = fs.readFileSync(headers, 'utf8').split(/\r?\n/);
  const header = (name) => {
    const hit = head.filter((l) => l.toLowerCase().startsWith(`${name}:`)).pop();
    return hit ? hit.slice(name.length + 1).trim() : null;
  };
  const contentLength = header('content-length');
  if (contentLength !== null && Number(contentLength) !== bytes) {
    die(`${src.key}: ${bytes} bytes received, Content-Length says ${contentLength}`);
  }
  return {
    key: src.key,
    location: src.location,
    kind: src.kind,
    pinBasis: src.pinBasis,
    httpStatus: status,
    bytes,
    sha256,
    contentType: header('content-type'),
    fetchedAt,
    licence: src.licence,
    licenceSource: src.licenceSource,
  };
}

function pin(force) {
  if (fs.existsSync(MANIFEST) && !force) return false;
  const { sources } = readJson(SOURCES);
  fs.mkdirSync(DATA, { recursive: true });
  const pinned = [];
  const unpinned = [];
  for (const src of sources) {
    if (src.kind === 'none') {
      unpinned.push({ key: src.key, location: src.location, sha256: null, reason: src.nullReason, licence: src.licence, licenceSource: src.licenceSource });
      console.log(`  unpinned  ${src.key}: ${src.nullReason}`);
      continue;
    }
    const m = fetchOne(src);
    pinned.push(m);
    console.log(`  ${m.httpStatus}  ${m.sha256.slice(0, 16)}…  ${String(m.bytes).padStart(8)}  ${m.key}`);
  }
  const seen = new Map();
  for (const m of pinned) {
    if (seen.has(m.sha256)) die(`${m.key} and ${seen.get(m.sha256)} share the digest ${m.sha256}`);
    seen.set(m.sha256, m.key);
  }
  const manifest = {
    $comment: 'Written once by corpus/pin.mjs. Each pinned source was fetched with curl, no redirects followed, and answered HTTP 200 with a non-empty body; no two share a digest. The bytes are in data/, which is git-ignored and never committed. Licences are as each source states them, or "not stated".',
    pinnedAt: pinned.length ? pinned[pinned.length - 1].fetchedAt : nowSeconds(),
    fetcher: curlVersion(),
    sources: pinned,
    unpinned,
  };
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${rel(MANIFEST)}: ${pinned.length} pinned, ${unpinned.length} unpinned`);
  return true;
}

function verifyData() {
  const manifest = readJson(MANIFEST);
  let ok = true;
  for (const m of manifest.sources) {
    const file = path.join(DATA, `${m.key}.bin`);
    const got = fs.existsSync(file) ? sha256File(file) : null;
    const same = got === m.sha256;
    ok &&= same;
    console.log(`  ${same ? 'ok  ' : got === null ? 'MISSING' : 'DIFFERS'}  ${m.key}`);
  }
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------------
// Writer: a pure function of sources.json, core.template.md and the manifest

// A minimal, deterministic YAML emitter for the shapes this program writes: mappings, sequences,
// strings, numbers, booleans and null. A string is written plain only when it cannot be read as
// anything but that string; otherwise it is written as a JSON string, which YAML reads as a
// double-quoted scalar with the same value.
const PLAIN = /^[A-Za-z0-9/][A-Za-z0-9 ._/:@+,()'-]*$/;
const RESERVED = /^(true|false|null|yes|no|on|off|~|[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?|\d{4}-\d\d-\d\d.*)$/i;
function scalar(v, inFlow = false) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  // Inside [ ] or { } a comma ends the scalar, so a string with one is quoted there.
  if (PLAIN.test(s) && !RESERVED.test(s) && !/: |\s$|,$/.test(s) && !s.includes(' #') && !(inFlow && s.includes(','))) return s;
  return JSON.stringify(s);
}
function isFlat(v) {
  return v !== null && typeof v === 'object' && Object.values(v).every((x) => x === null || typeof x !== 'object');
}
function flow(obj) {
  if (Array.isArray(obj)) return `[${obj.map((x) => scalar(x, true)).join(', ')}]`;
  return `{ ${Object.entries(obj).map(([k, v]) => `${k}: ${scalar(v, true)}`).join(', ')} }`;
}
function emit(value, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(value)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (Object.keys(v).length === 0) lines.push(`${pad}${k}: {}`);
      else if (isFlat(v) && flow(v).length + indent + k.length < 118) lines.push(`${pad}${k}: ${flow(v)}`);
      else lines.push(`${pad}${k}:`, emit(v, indent + 2));
    } else if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${pad}${k}: []`);
      else if (v.every((x) => x === null || typeof x !== 'object') && flow(v).length + indent + k.length < 118) lines.push(`${pad}${k}: ${flow(v)}`);
      else {
        lines.push(`${pad}${k}:`);
        for (const item of v) {
          if (item !== null && typeof item === 'object') {
            const inner = emit(item, indent + 4).split('\n');
            lines.push(`${pad}  - ${inner[0].trimStart()}`, ...inner.slice(1));
          } else lines.push(`${pad}  - ${scalar(item)}`);
        }
      }
    } else lines.push(`${pad}${k}: ${scalar(v)}`);
  }
  return lines.join('\n');
}

// A ref carries a location and a content hash together, as the model's published examples require of
// every link. An unpinned source carries its location, a null hash and the reason.
function refFor(key, pins) {
  const pinnedSrc = pins.byKey.get(key);
  if (pinnedSrc) return { location: pinnedSrc.location, sha256: pinnedSrc.sha256 };
  const unpinnedSrc = pins.unpinnedByKey.get(key);
  if (unpinnedSrc) return { location: unpinnedSrc.location, sha256: null };
  const draftSrc = pins.draftByKey?.get(key);
  if (draftSrc) return draftSrc.kind === 'none' ? { location: draftSrc.location, sha256: null } : { location: draftSrc.location, sha256: 'pending' };
  die(`no source with key ${key}`);
}

function pinsFrom(manifest, sources, draft) {
  if (draft) {
    return { byKey: new Map(), unpinnedByKey: new Map(), draftByKey: new Map(sources.map((s) => [s.key, s])), date: 'pending', pinnedAt: 'pending', manifestSha256: 'pending' };
  }
  const known = new Set(sources.map((s) => s.key));
  for (const m of [...manifest.sources, ...manifest.unpinned]) {
    if (!known.has(m.key)) die(`the manifest pins ${m.key}, which corpus/sources.json no longer lists`);
  }
  for (const s of sources) {
    const inManifest = manifest.sources.some((m) => m.key === s.key) || manifest.unpinned.some((m) => m.key === s.key);
    if (!inManifest) die(`corpus/sources.json lists ${s.key}, which the manifest does not pin; rerun with --force`);
    const m = manifest.sources.find((x) => x.key === s.key);
    if (m && m.location !== s.location) die(`${s.key}: the manifest pinned ${m.location}, sources.json now says ${s.location}`);
  }
  return {
    byKey: new Map(manifest.sources.map((m) => [m.key, m])),
    unpinnedByKey: new Map(manifest.unpinned.map((m) => [m.key, m])),
    date: manifest.pinnedAt.slice(0, 10),
    pinnedAt: manifest.pinnedAt,
    manifestSha256: sha256File(MANIFEST),
  };
}

function sourceLine(src, pins) {
  const m = pins.byKey.get(src.key);
  const u = pins.unpinnedByKey.get(src.key);
  if (m) return `- \`${src.key}\`: ${src.location}\n  sha256 \`${m.sha256}\`, ${m.bytes} bytes, HTTP ${m.httpStatus}, fetched ${m.fetchedAt}; licence: ${m.licence}`;
  if (u) return `- \`${src.key}\`: ${src.location}\n  sha256 null: ${u.reason}`;
  return `- \`${src.key}\`: ${src.location}\n  sha256 ${src.kind === 'none' ? `null: ${src.nullReason}` : 'pending'}; licence: ${src.licence}`;
}

function writeCore(spec, pins) {
  const bySource = new Map(spec.sources.map((s) => [s.key, s]));
  let text = fs.readFileSync(TEMPLATE, 'utf8');
  text = text.replace(/\{\{ref:([a-z0-9-]+)\}\}/g, (_, key) => flow(refFor(key, pins)));
  text = text.replace(/\{\{createdAt\}\}/g, pins.date);
  text = text.replace(/\{\{sources:core\}\}/g, () => spec.core.sources.map((k) => sourceLine(bySource.get(k), pins)).join('\n'));
  const left = text.match(/\{\{[^}]*\}\}/);
  if (left) die(`core.template.md has an unfilled placeholder ${left[0]}`);
  fs.writeFileSync(CORE_OUT, text);
}

// One edge as a mapping. Its createdAt is the fetch date of its other end's source, so an edge added
// later carries its own date (pinnedAt's date for an unpinned source).
function edgeValue(e, spec, pins) {
  const node = (id) => {
    const n = spec.nodes[id];
    if (!n) die(`edge ${e.key} names ${id}, which corpus/sources.json does not define`);
    return { id, ref: refFor(n.source, pins) };
  };
  const src = spec.sources.find((s) => s.key === spec.nodes[e.object === spec.subject ? e.subject : e.object].source);
  const m = pins.byKey.get(src.key);
  const u = pins.unpinnedByKey.get(src.key);
  return {
    id: `${spec.subject}/map/${e.key}`,
    createdAt: m ? m.fetchedAt.slice(0, 10) : pins.date,
    subject: node(e.subject),
    object: node(e.object),
    'x-typedstandards': {
      relation: e.relation,
      basis: e.basis,
      ring: e.ring,
      name: e.name,
      publisher: e.publisher,
      ...(e.intent ? { intent: e.intent } : {}),
      pin: m
        ? { fetchedAt: m.fetchedAt, bytes: m.bytes, httpStatus: m.httpStatus, basis: src.pinBasis, licence: m.licence }
        : u
          ? { sha256: null, reason: u.reason, licence: u.licence }
          : { basis: src.kind === 'none' ? src.nullReason : src.pinBasis, licence: src.licence },
      curation: e.curation,
    },
  };
}

// The header as a mapping. `withManifestDigest` is version 1's form: map.yaml's header names the
// manifest's SHA-256. map/header.yaml does not, so that a manifest grown by a later addition leaves it
// unchanged; each record names its writer inputs' digests in its own signed queries.
function headerValue(spec, pins, withManifestDigest) {
  return {
    'x-typedstandards': {
      map: spec.map.title,
      domain: spec.map.domain,
      subject: spec.subject,
      createdAt: pins.date,
      writtenFrom: {
        sources: 'corpus/sources.json',
        manifest: 'corpus/manifest.json',
        ...(withManifestDigest ? { manifestSha256: pins.manifestSha256 } : {}),
      },
      edgeTypes: spec.map.edgeTypes,
      relations: spec.map.relations,
      rings: spec.map.rings,
      refs: spec.map.refs,
      dropped: spec.map.dropped,
    },
  };
}

const comment = (lines) => `# ${lines.join('\n# ')}`;

// Version 1's map.yaml, as the current inputs would write it: the comment, the header, every edge.
function mapYaml(spec, pins) {
  const out = [comment(spec.map.comment), `---\n${emit(headerValue(spec, pins, true))}`, ...spec.edges.map((e) => `---\n${emit(edgeValue(e, spec, pins))}`)];
  return `${out.join('\n')}\n`;
}

// map.yaml is written only when it is absent. Otherwise it is compared, never overwritten.
function writeMapYaml(spec, pins) {
  const text = mapYaml(spec, pins);
  if (!fs.existsSync(MAP_OUT)) {
    fs.writeFileSync(MAP_OUT, text);
    return 'written';
  }
  return fs.readFileSync(MAP_OUT, 'utf8') === text ? 'unchanged' : 'differs';
}

// The split: map/header.yaml and one file per edge in map/edges/. A file there that names no edge in
// corpus/sources.json stops the program; no signed file is ever removed.
function writeSplit(spec, pins) {
  fs.mkdirSync(EDGES_DIR, { recursive: true });
  fs.writeFileSync(HEADER_OUT, `${comment(HEADER_COMMENT)}\n${emit(headerValue(spec, pins, false))}\n`);
  const written = new Set();
  for (const e of spec.edges) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.key)) die(`edge key ${e.key} is not lowercase letters, digits and hyphens`);
    const file = `${e.key}.yaml`;
    if (written.has(file)) die(`two edges share the key ${e.key}`);
    fs.writeFileSync(path.join(EDGES_DIR, file), `${comment(EDGE_COMMENT)}\n${emit(edgeValue(e, spec, pins))}\n`);
    written.add(file);
  }
  const stray = fs.readdirSync(EDGES_DIR).filter((f) => !f.startsWith('.') && !written.has(f));
  if (stray.length) die(`map/edges/ holds ${stray.join(', ')}, which corpus/sources.json does not list as an edge`);
  return written.size;
}

// ---------------------------------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
if (args.has('--verify')) verifyData();
const draft = args.has('--draft');
const spec = readJson(SOURCES);
if (!draft) {
  const fetched = pin(args.has('--force'));
  if (!fetched) console.log(`${rel(MANIFEST)} exists; not fetching (use --force to refetch)`);
}
const pins = pinsFrom(draft ? null : readJson(MANIFEST), spec.sources, draft);
writeCore(spec, pins);
const edges = writeSplit(spec, pins);
const mapState = writeMapYaml(spec, pins);
console.log(`wrote core.md (${fs.statSync(CORE_OUT).size} bytes), map/header.yaml and ${edges} edge files in map/edges/${draft ? ' as drafts' : ''}`);
console.log({
  written: 'wrote map.yaml, version 1\'s map',
  unchanged: 'map.yaml, version 1\'s map: not rewritten, and the current inputs write it byte for byte',
  differs: 'map.yaml, version 1\'s map: not rewritten, and it differs from what the current inputs write (they are not version 1\'s, or map.yaml changed)',
}[mapState]);
