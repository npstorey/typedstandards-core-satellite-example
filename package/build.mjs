#!/usr/bin/env node
// Program 2 of 2: package the published content files as signed Typed Standards records, and derive what
// the host serves from them.
//
//   node package/build.mjs keygen     generate a fresh Ed25519 seed outside the repository (mode 600) and
//                                     write package/signer.json with the did:key identifier derived from it
//   node package/build.mjs sign       sign every record file that has no bundle yet, as one step, with one
//                                     key supply. The key must first reproduce every committed signature,
//                                     and every signed file must still equal its record; otherwise nothing
//                                     is written. With no build log the step is version 1: core.md and
//                                     map.yaml. With nothing unsigned, nothing is written. A file that restates
//                                     a record (sources.json `replaces`) is signed only once that record is
//                                     withdrawn. `assemble` is the stage's earlier name.
//   node package/build.mjs withdraw <name> --reason <text>
//                                     sign an attestation/withdraws/v1 for the named record with the same
//                                     key, and carry it in that record's view
//   node package/build.mjs host       no key: write the registry if it is absent, then rewrite every
//                                     bundle's unsigned view, the served copies in docs/bundles/ and
//                                     docs/records.json
//   node package/build.mjs check      no key: rebuild every record and every withdrawal from the build log
//                                     and compare them with the bundles; check the signed files, the served
//                                     copies, the views, the registry and docs/records.json; list the record
//                                     files that have no bundle yet
//   --root <dir>                      run against another checkout (the tests' scratch copies)
//
// The signing key comes from the environment variable SIGNING_SEED_B64 (standard base64 of the 32-byte
// seed) when it is set, and from the seed file outside the repository only when it is not. The owner's
// key lives in 1Password, and signing runs in the owner's own terminal:
//   op run --env-file=.env.sign -- node package/build.mjs sign
// where .env.sign is a copy of .env.sign.example, which holds an op:// reference, never a value.
//
// The record files are core.md, map.yaml (version 1's map), the headers (map/header.yaml and each later one
// corpus/sources.json lists) and map/edges/<key>.yaml.
// corpus/pin.mjs writes them; this program reads their bytes from disk, which is what makes the capture
// method `script-run` (hub ADR-0029 §2). A record is named by its file's path without the extension, and
// its bundle is package/<name>.bundle.json, served byte for byte as docs/bundles/<name>.bundle.json. Each
// record carries its file's exact UTF-8 bytes inline as `output` under raw-bytes/v1, so
// `shasum -a 256 <file>` equals contentHash.sha256. The source digests a file cites are signed assertions
// in queries[].arguments; no check recomputes them.
//
// The build log records, for each record, the ids and time it was built with and the digests of the
// programs and inputs that built it: version 1's two records share the log's top-level `versions` and
// `inputs`, and every later record carries its own. `check` rebuilds each record from those digests, so a
// later change to a program or an input does not change what was signed; it reports such changes
// separately. A signed file is never rewritten: a correction is a withdrawal plus a new record.
//
// The signer is self-certifying: a did:key derived from the seed, bindingTier pseudonymous, no RFC 3161
// token, no Rekor entry. One identifier string is metadata.signingKeyId, the envelope kid and
// signer.identifier (hub ADR-0030 §5). The host's registry, docs/.well-known/typed-publisher.json, lists
// the key: that is the example publisher's own statement, and it is outside every signed record. Each view
// names it as trustRegistryUrl and carries a copy as trustRegistry; both are unsigned view fields.
// Nothing here prints the seed, a private key or a signature; identifiers and digests print abbreviated.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTESTATION_WITHDRAWS,
  buildAttestationNode,
  buildCommitmentView,
  buildEnvelope,
  DEFAULT_CONTENT_TYPE,
  deriveKeyDerivedIdentifierFromKey,
  derivePublicKeySpki,
  RAW_BYTES_CANONICALIZATION,
  sha256Hex,
  signEnvelopeHash,
} from '@typedstandards/produce-core';
import { validateRegistry, verifyLifecycleChain, verifyRecord } from '@typedstandards/verify-core';

const argv = process.argv.slice(2);
const rootAt = argv.indexOf('--root');
const ROOT = rootAt >= 0 ? path.resolve(argv[rootAt + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = path.join(ROOT, 'package');
const SERVED_DIR = path.join(ROOT, 'docs', 'bundles');
const SEED_PATH = path.join(os.homedir(), '.config', 'typedstandards-core-satellite-example', 'signing.seed');
const SIGNER_FILE = path.join(PKG_DIR, 'signer.json');
const BUILD_LOG = path.join(PKG_DIR, 'build-log.json');
const RECORDS_JSON = path.join(ROOT, 'docs', 'records.json');
const REGISTRY_FILE = path.join(ROOT, 'docs', '.well-known', 'typed-publisher.json');

const REPO = 'https://github.com/npstorey/typedstandards-core-satellite-example';
const NS = 'io.github.npstorey.core-satellite-example';
const DISPLAY_NAME = 'typedstandards-core-satellite-example (self-certifying example key)';
const PRODUCER_PROFILE = 'scripted-recomputation/core-satellite-example';
const CAPTURE_METHOD = 'script-run';
const SCIOS = { title: 'The Core-Satellite Model', publisher: 'SciOS', location: 'https://scios.tech/thoughts', dated: '2026-06-30', readAt: '2026-09-22' };
const MAP_TOPIC = 'the map of Typed Standards relations to public projects';

// Version 1's two records, as they were signed.
const V1 = {
  core: {
    file: 'core.md',
    title: 'core.md: Typed Standards in the core-record shape',
    task: 'the partial core record for Typed Standards in the SciOS core-and-satellite front-matter shape, self-assessed as a satellite',
  },
  map: {
    file: 'map.yaml',
    title: 'map.yaml: Typed Standards relations to public projects',
    task: 'the map of Typed Standards relations to public projects in three rings, with no orbits edge',
  },
};

const rel = (p) => path.relative(ROOT, p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
const writeJson = (p, v) => fs.writeFileSync(p, json(v), { flag: 'wx' });
const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const short = (s) => `${s.slice(0, 12)}…${s.slice(-4)}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bundlePath = (name) => path.join(PKG_DIR, `${name}.bundle.json`);
const servedPath = (name) => path.join(SERVED_DIR, `${name}.bundle.json`);
const die = (msg) => {
  console.error(`stopped: ${msg}`);
  process.exit(1);
};

function signerFile(identifier, publicKey) {
  return {
    $comment: 'The signer of the records in this repository. The identifier is derived from the public key (did:key, base58btc, hub ADR-0030 §2); it proves that one key signed every record and nothing about who holds the key. The host\'s registry, docs/.well-known/typed-publisher.json, lists the key; that is the example publisher\'s own statement. The seed is held outside the repository.',
    bindingTier: 'pseudonymous',
    identifier,
    displayName: DISPLAY_NAME,
    publicKey,
    algorithm: 'Ed25519ph',
  };
}

function keygen() {
  if (fs.existsSync(SEED_PATH)) die('a seed already exists outside the repository; not generating another');
  if (fs.existsSync(SIGNER_FILE)) die(`${rel(SIGNER_FILE)} exists`);
  fs.mkdirSync(path.dirname(SEED_PATH), { recursive: true, mode: 0o700 });
  const seed = crypto.randomBytes(32);
  fs.writeFileSync(SEED_PATH, seed, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(SEED_PATH, 0o600);
  const raw = new Uint8Array(seed);
  const identifier = deriveKeyDerivedIdentifierFromKey(raw);
  const publicKey = derivePublicKeySpki(raw);
  seed.fill(0);
  raw.fill(0);
  writeJson(SIGNER_FILE, signerFile(identifier, publicKey));
  const mode = (fs.statSync(SEED_PATH).mode & 0o777).toString(8);
  console.log(`seed written outside the repository, mode ${mode}; identifier ${short(identifier)} (${identifier.length} chars)`);
  console.log(`wrote ${rel(SIGNER_FILE)}`);
}

// The signing key: SIGNING_SEED_B64 when it is set (even if empty, which is an error), else the seed file.
// Neither the value nor any part of it is ever printed.
function loadSeed() {
  const b64 = process.env.SIGNING_SEED_B64;
  if (b64 !== undefined) {
    const text = b64.trim();
    const bytes = Buffer.from(text, 'base64');
    if (bytes.length !== 32 || bytes.toString('base64').replace(/=+$/, '') !== text.replace(/=+$/, '')) {
      die('SIGNING_SEED_B64 is set, but it is not the standard base64 of a 32-byte seed');
    }
    return { seed: new Uint8Array(bytes), source: 'SIGNING_SEED_B64' };
  }
  if (fs.existsSync(SEED_PATH)) {
    const seed = new Uint8Array(fs.readFileSync(SEED_PATH));
    if (seed.length !== 32) die('the seed file outside the repository is not 32 bytes');
    return { seed, source: 'the seed file outside the repository' };
  }
  die('no signing key: SIGNING_SEED_B64 is not set and there is no seed file. Run: op run --env-file=.env.sign -- node package/build.mjs sign');
}

// ---------------------------------------------------------------------------------------------------
// The record files and their inputs

// Every record file, in the order records are signed and listed: version 1's two, the headers
// (map/header.yaml, then each later one corpus/sources.json lists in `headers`), then one per edge in
// corpus/sources.json order. `present` says whether the file exists.
function recordFiles(sources) {
  const headerFiles = [{ name: 'map/header', file: 'map/header.yaml' }, ...(sources.headers ?? []).map((h) => ({ name: h.file.replace(/\.yaml$/, ''), file: h.file }))]
    .map((h) => ({ ...h, role: 'map-header' }));
  const edgeFiles = sources.edges.map((e) => ({ name: `map/edges/${e.key}`, file: `map/edges/${e.key}.yaml`, role: 'edge', edge: e }));
  const edgesDir = path.join(ROOT, 'map', 'edges');
  if (fs.existsSync(edgesDir)) {
    const known = new Set(edgeFiles.map((r) => r.file));
    const stray = fs.readdirSync(edgesDir).filter((f) => !f.startsWith('.')).map((f) => `map/edges/${f}`).filter((f) => !known.has(f));
    if (stray.length) die(`${stray.join(', ')} names no edge in corpus/sources.json`);
  }
  return [
    { name: 'core', file: 'core.md', role: 'core' },
    { name: 'map', file: 'map.yaml', role: 'map-v1' },
    ...headerFiles,
    ...edgeFiles,
  ].map((r) => ({ ...r, present: fs.existsSync(path.join(ROOT, r.file)) }));
}

// The digests of the programs and inputs on disk now.
function filesOnDisk() {
  const pathSha = (p) => ({ path: p, sha256: sha256File(path.join(ROOT, p)) });
  return {
    script: pathSha('corpus/pin.mjs'),
    sourcesJson: pathSha('corpus/sources.json'),
    template: pathSha('corpus/core.template.md'),
    manifestJson: pathSha('corpus/manifest.json'),
    builder: pathSha('package/build.mjs'),
  };
}

// The manifest and sources.json as they are on disk. The manifest is append-only, so an entry a record
// cites reads the same for every later step.
function corpus() {
  const manifest = readJson(path.join(ROOT, 'corpus', 'manifest.json'));
  const sources = readJson(path.join(ROOT, 'corpus', 'sources.json'));
  return {
    manifest,
    sources,
    pinned: new Map(manifest.sources.map((m) => [m.key, m])),
    unpinned: new Map(manifest.unpinned.map((m) => [m.key, m])),
  };
}

// The edge as the map's own triple: subject, relation, object, with the far end by its name.
const edgeSentence = (e, subject) => (e.subject === subject ? `${subject} ${e.relation} ${e.name}` : `${e.name} ${e.relation} ${subject}`);

// What a record says about itself: its title, task, cited sources and writer inputs.
function describe(rec, cp) {
  const nodeSource = (id) => cp.sources.nodes[id]?.source ?? die(`corpus/sources.json has no node ${id}`);
  const keysOf = (edges) => {
    const keys = [];
    for (const e of edges) for (const id of [e.subject, e.object]) if (!keys.includes(nodeSource(id))) keys.push(nodeSource(id));
    return keys;
  };
  if (rec.role === 'core') return { ...V1.core, keys: cp.sources.core.sources, extRole: 'core-record' };
  if (rec.role === 'map-v1') {
    // Version 1's edges are the ones map.yaml holds, in corpus/sources.json order.
    const ids = new Set([...fs.readFileSync(path.join(ROOT, 'map.yaml'), 'utf8').matchAll(/^id: (.+)$/gm)].map((m) => m[1]));
    return { ...V1.map, keys: keysOf(cp.sources.edges.filter((e) => ids.has(`${cp.sources.subject}/map/${e.key}`))), extRole: 'map' };
  }
  if (rec.role === 'map-header') {
    return {
      file: rec.file,
      title: `${rec.file}: the header of ${MAP_TOPIC}`,
      task: `the header of ${MAP_TOPIC}, whose edges are records of their own`,
      keys: [],
      extRole: 'map-header',
    };
  }
  const sentence = edgeSentence(rec.edge, cp.sources.subject);
  return {
    file: rec.file,
    title: `${rec.file}: ${sentence}`,
    task: `one edge of ${MAP_TOPIC}: ${sentence}, ring ${rec.edge.ring}`,
    keys: keysOf([rec.edge]),
    extRole: 'map-edge',
    edgeId: `${cp.sources.subject}/map/${rec.edge.key}`,
  };
}

// The envelope input for one record. `files` are the digests the record names (the build log's, or the
// files on disk when it is first built); `step` 1 is version 1's form, exactly as it was signed.
function recordInput(rec, ids, signer, cp, files, step) {
  const d = describe(rec, cp);
  const text = fs.readFileSync(path.join(ROOT, rec.file), 'utf8');
  const bytes = Buffer.byteLength(text, 'utf8');
  const fileSha = sha256File(path.join(ROOT, rec.file));
  if (sha256Hex(text) !== fileSha) die(`${rec.file} does not round-trip as UTF-8`);
  const pinned = d.keys.filter((k) => cp.pinned.has(k)).map((k) => cp.pinned.get(k));
  const unpinned = d.keys.filter((k) => cp.unpinned.has(k)).map((k) => cp.unpinned.get(k));
  if (pinned.length + unpinned.length !== d.keys.length) die(`${rec.file} cites a source the manifest does not record`);
  const writerInputs = [files.sourcesJson, ...(rec.role === 'core' ? [files.template] : []), files.manifestJson];
  const v1 = step === 1;
  const cites = v1 || pinned.length > 1
    ? `The ${pinned.length} source digests in queries are signed assertions that no check recomputes.`
    : pinned.length === 1
      ? 'The source digest in queries is a signed assertion that no check recomputes.'
      : 'It cites no pinned source.';
  const noPin = !v1 && unpinned.length ? ` ${unpinned.length === 1 ? 'One source has' : `${unpinned.length} sources have`} no immutable location; queries give its location and the reason.` : '';
  return {
    packageId: ids.packageId,
    createdAt: ids.createdAt,
    signingKeyId: signer.identifier,
    prompt: `Package the file ${rec.file}, ${d.task}, as the output of a scripted-recomputation record under raw-bytes/v1. corpus/pin.mjs wrote the file from ${writerInputs.map((f) => f.path).join(', ')}; this program read it from disk.`,
    promptVisibility: 'full_text',
    queries: [
      ...pinned.map((m) => ({
        tool: 'curl',
        operationType: 'retrieve',
        arguments: { url: m.location, sha256: m.sha256, bytes: m.bytes, httpStatus: m.httpStatus, fetchedAt: m.fetchedAt, licence: m.licence },
        datasetId: m.key,
      })),
      {
        tool: files.script.path,
        operationType: 'script-run',
        arguments: {
          command: 'node corpus/pin.mjs',
          scriptSha256: files.script.sha256,
          inputs: writerInputs,
          ...(unpinned.length ? { unpinned: unpinned.map((u) => ({ key: u.key, location: u.location, sha256: null, reason: u.reason })) } : {}),
          output: { path: rec.file, sha256: fileSha, bytes },
        },
      },
      {
        tool: files.builder.path,
        operationType: 'package-file',
        arguments: { command: `node package/build.mjs ${v1 ? 'assemble' : 'sign'}`, scriptSha256: files.builder.sha256, inputFile: rec.file, inputSha256: fileSha },
      },
    ],
    dataSources: pinned.map((m) => ({
      sourceId: m.key,
      catalogType: m.kind,
      portalUrl: new URL(m.location).origin,
      datasetId: m.key,
      datasetUrl: m.location,
      accessTimestamp: m.fetchedAt,
    })),
    cost: { model: 'none' },
    skillMetadata: {},
    output: text,
    trace: { resourceSpans: [] },
    summary: `${d.title}. The file's exact UTF-8 bytes (${bytes} bytes) are this record's output under raw-bytes/v1, so contentHash.sha256 is the file's ordinary SHA-256. ${cites}${noPin} The signer is a self-certifying did:key; it shows which key signed, not who holds it.`,
    captureMethod: CAPTURE_METHOD,
    producerProfile: PRODUCER_PROFILE,
    type: DEFAULT_CONTENT_TYPE,
    signer: { bindingTier: signer.bindingTier, identifier: signer.identifier, displayName: signer.displayName },
    contentCanonicalization: RAW_BYTES_CANONICALIZATION,
    extensions: {
      [NS]: {
        role: d.extRole,
        ...(d.edgeId ? { edgeId: d.edgeId } : {}),
        repository: REPO,
        file: { path: rec.file, sha256: fileSha, bytes },
        writer: files.script,
        writerInputs,
        pinnedAt: cp.manifest.pinnedAt,
        sourcesCited: { pinned: pinned.length, unpinned: unpinned.length },
        model: SCIOS,
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The host: the registry, each bundle's unsigned view, the served copies and docs/records.json

function hostConfig() {
  const cname = fs.readFileSync(path.join(ROOT, 'docs', 'CNAME'), 'utf8').trim();
  const origin = `https://${cname}`;
  return {
    host: `${origin}/`,
    trustRegistryUrl: `${origin}/.well-known/typed-publisher.json`,
    registry: fs.existsSync(REGISTRY_FILE) ? readJson(REGISTRY_FILE) : undefined,
  };
}

// The registry, derived: one key, as signer.json names it, active since the first record signed under it.
function registryFor(signer, log, host) {
  const activatedAt = Object.values(log.records).map((r) => r.createdAt).reduce((a, b) => (b < a ? b : a));
  return {
    $comment: `The example publisher's own statement about its signing key, served at ${host.trustRegistryUrl}. It is not a Typed Standards record, and not an endorsement by the Typed Standards specification or by typedstandards.org, although this host is a subdomain of it. activatedAt is the earliest createdAt in package/build-log.json: the first record signed under the key, as the signer states it.`,
    keys: [{
      kid: signer.identifier,
      publicKey: signer.publicKey,
      status: 'active',
      activatedAt,
      deprecatedAt: null,
      revokedAt: null,
      signerIdentity: { bindingTier: signer.bindingTier, identifier: signer.identifier, displayName: signer.displayName },
    }],
  };
}

// A bundle is the commitment view plus the signed package. Everything but `package`, `packageHash` and
// `signature` is derived here from those three, the record's title, its carried withdrawals and the host.
function bundleFor(pkg, packageHash, signature, title, lifecycleAttestations, host) {
  const view = buildCommitmentView({
    packageHash,
    visibility: 'public',
    captureMethod: pkg.metadata.captureMethod ?? null,
    producerProfile: pkg.producerProfile,
    type: pkg.type,
    signer: pkg.signer,
    contentHash: pkg.contentHash,
    contentCanonicalization: pkg.contentCanonicalization,
    signature: { ...signature },
    lifecycleAttestations,
    trustRegistryUrl: host.trustRegistryUrl,
    subjectTitle: title,
    subjectSummary: pkg.summary ?? null,
  });
  return { ...view, ...(host.registry ? { trustRegistry: host.registry } : {}), package: pkg };
}

const withdrawalsOf = (bundle) => bundle.lifecycleAttestations ?? [];
const lifecycleOf = (bundle) => verifyLifecycleChain(withdrawalsOf(bundle), bundle.packageHash, bundle.package.signer.identifier);

function recordsJsonFor(log, bundles, host) {
  return {
    $comment: 'The records this host serves, in the order they were signed. Written by package/build.mjs from the bundles and the build log, never by hand; node package/build.mjs check fails when this file differs from a fresh derivation. status is verify-core\'s verifyLifecycleChain reading of the withdrawals each view carries.',
    host: host.host,
    trustRegistryUrl: host.trustRegistryUrl,
    records: Object.entries(log.records).map(([name, entry]) => {
      const b = bundles[name];
      const life = lifecycleOf(b);
      return {
        name,
        file: entry.file,
        bundle: `bundles/${name}.bundle.json`,
        packageHash: b.packageHash,
        createdAt: b.package.metadata.createdAt,
        type: b.package.type,
        signer: b.package.signer.identifier,
        role: entry.role ?? (name === 'core' ? 'core' : 'map-v1'),
        edgeId: b.package.extensions?.[NS]?.edgeId ?? null,
        step: entry.step ?? 1,
        status: life.status,
        ...(life.status === 'withdrawn' ? { withdrawn: { at: life.withdrawnAt, reason: life.withdrawnReason } } : {}),
      };
    }),
  };
}

// Rewrite the unsigned parts. The signed part of every bundle is compared before and after.
function host() {
  const log = readLog();
  const signer = readJson(SIGNER_FILE);
  const cp = corpus();
  const files = new Map(recordFiles(cp.sources).map((r) => [r.name, r]));
  let cfg = hostConfig();
  if (!cfg.registry) {
    fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
    writeJson(REGISTRY_FILE, registryFor(signer, log, cfg));
    console.log(`wrote ${rel(REGISTRY_FILE)}`);
    cfg = hostConfig();
  }
  const bundles = {};
  for (const name of Object.keys(log.records)) {
    const old = readJson(bundlePath(name));
    const title = describe(files.get(name), cp).title;
    const b = bundleFor(old.package, old.packageHash, old.signature, title, old.lifecycleAttestations, cfg);
    if (!same([b.package, b.packageHash, b.signature], [old.package, old.packageHash, old.signature])) die(`${name}: the signed part would change; nothing written`);
    bundles[name] = b;
  }
  for (const [name, b] of Object.entries(bundles)) {
    fs.writeFileSync(bundlePath(name), json(b));
    fs.mkdirSync(path.dirname(servedPath(name)), { recursive: true });
    fs.writeFileSync(servedPath(name), json(b));
  }
  fs.writeFileSync(RECORDS_JSON, json(recordsJsonFor(log, bundles, cfg)));
  console.log(`views, served copies and ${rel(RECORDS_JSON)} written for ${Object.keys(bundles).length} records`);
}

// ---------------------------------------------------------------------------------------------------
// Rebuild and compare

function readLog() {
  if (!fs.existsSync(BUILD_LOG)) die(`${rel(BUILD_LOG)} does not exist`);
  return readJson(BUILD_LOG);
}

// Rebuild every logged record from the digests the log recorded for it, and every logged withdrawal from
// its logged fields; compare them with the bundles. Returns { ok, bundles, lines }.
function rebuild(log, signer, cp) {
  const lines = [];
  const bad = (m) => { lines.push(m); ok = false; };
  let ok = true;
  const files = new Map(recordFiles(cp.sources).map((r) => [r.name, r]));
  const bundles = {};
  const perStep = new Map();
  for (const [name, entry] of Object.entries(log.records)) {
    const rec = files.get(name);
    if (!rec) { bad(`${name}: in the build log, but not a record file corpus/sources.json names`); continue; }
    if (!rec.present) { bad(`${name}: ${rec.file} is missing; a signed file is never removed`); continue; }
    if (!fs.existsSync(bundlePath(name))) { bad(`${name}: ${rel(bundlePath(name))} is missing`); continue; }
    const step = entry.step ?? 1;
    const built = buildEnvelope(recordInput(rec, entry, signer, cp, entry.inputs ?? log.inputs, step));
    const b = readJson(bundlePath(name));
    bundles[name] = b;
    const hashSame = built.envelopeHash === entry.envelopeHash && b.packageHash === built.envelopeHash;
    const pkgSame = same(b.package, built.pkg);
    const fileSame = sha256File(path.join(ROOT, rec.file)) === b.package.contentHash?.sha256;
    if (!fileSame) bad(`${name}: ${rec.file} DIFFERS from its signed output; a correction is a withdrawal plus a new record under a new key`);
    if (!hashSame || !pkgSame) bad(`${name}: rebuilt envelope hash ${hashSame ? 'matches' : 'DIFFERS'}; bundle package ${pkgSame ? 'matches' : 'DIFFERS'}`);
    perStep.set(step, (perStep.get(step) ?? 0) + 1);
  }
  const counts = [...perStep].map(([s, n]) => `step ${s}: ${n}`).join(', ');
  if (ok) lines.push(`records: ${Object.keys(log.records).length} in the build log (${counts}); each rebuilds from the digests the log recorded for it, equals its bundle, and its file equals its signed output`);
  for (const w of log.withdrawals ?? []) {
    const b = bundles[w.target];
    const { node, nodeId } = buildAttestationNode(withdrawalInput(w, b, signer));
    const carried = withdrawalsOf(b ?? { lifecycleAttestations: [] }).find((c) => c.nodeId === w.nodeId);
    if (nodeId !== w.nodeId || !carried || !same(carried.node, node)) bad(`withdrawal of ${w.target}: the node rebuilt from the build log does not equal the one its view carries`);
  }
  for (const [name, b] of Object.entries(bundles)) {
    for (const c of withdrawalsOf(b)) {
      if (!(log.withdrawals ?? []).some((w) => w.target === name && w.nodeId === c.nodeId)) bad(`${name}: its view carries a withdrawal the build log does not record`);
    }
  }
  if (ok && (log.withdrawals ?? []).length) lines.push(`withdrawals: ${log.withdrawals.length}, each rebuilt from the build log and equal to the node its view carries`);
  return { ok, bundles, lines };
}

// Whether the programs and inputs on disk still match the digests each step's records name.
function inputsReport(log) {
  const now = filesOnDisk();
  const blocks = [['step 1 (the log\'s shared inputs)', log.inputs]];
  for (const [name, e] of Object.entries(log.records)) {
    if (e.inputs && !blocks.some(([, b]) => same(b, e.inputs))) blocks.push([`step ${e.step} (${name} and the records built with it)`, e.inputs]);
  }
  return blocks.map(([label, block]) => {
    const entries = Object.entries(block).filter(([k]) => now[k]);
    const moved = entries.filter(([k, v]) => now[k].sha256 !== v.sha256).map(([, v]) => v.path);
    return `inputs, ${label}: ${moved.length ? `${moved.join(', ')} ${moved.length === 1 ? 'has' : 'have'} changed on disk since; the rest match` : 'every file on disk matches'}`;
  });
}

function check() {
  const log = readLog();
  const signer = readJson(SIGNER_FILE);
  const cp = corpus();
  const cfg = hostConfig();
  const { ok: rebuilt, bundles, lines } = rebuild(log, signer, cp);
  let ok = rebuilt;
  const bad = (m) => { lines.push(m); ok = false; };
  lines.push(...inputsReport(log));

  // The views and the served copies.
  const files = new Map(recordFiles(cp.sources).map((r) => [r.name, r]));
  let viewsOk = true;
  for (const [name, b] of Object.entries(bundles)) {
    const want = bundleFor(b.package, b.packageHash, b.signature, describe(files.get(name), cp).title, b.lifecycleAttestations, cfg);
    const raw = fs.readFileSync(bundlePath(name), 'utf8');
    if (raw !== json(want)) { bad(`${name}: the view DIFFERS from its derivation (run node package/build.mjs host)`); viewsOk = false; }
    if (!fs.existsSync(servedPath(name)) || fs.readFileSync(servedPath(name), 'utf8') !== raw) { bad(`${name}: ${rel(servedPath(name))} is missing or differs from ${rel(bundlePath(name))}`); viewsOk = false; }
  }
  const served = [];
  const walk = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir).filter((x) => !x.startsWith('.'))) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else served.push(p); } };
  walk(SERVED_DIR);
  for (const p of served) {
    const name = path.relative(SERVED_DIR, p).replace(/\.bundle\.json$/, '');
    if (!log.records[name]) bad(`${rel(p)} is served, but the build log records no such record`);
  }
  if (viewsOk) lines.push(`views: each bundle's view equals its derivation, names ${cfg.trustRegistryUrl} and carries the registry; each is served byte for byte as docs/bundles/<name>.bundle.json`);

  // The registry.
  const reg = cfg.registry;
  const k = reg?.keys?.[0];
  const earliest = Object.values(log.records).map((r) => r.createdAt).reduce((a, b) => (b < a ? b : a));
  if (!reg || !validateRegistry(reg) || reg.keys.length !== 1 || k.kid !== signer.identifier || k.publicKey !== signer.publicKey ||
    k.status !== 'active' || !(k.activatedAt <= earliest) || k.deprecatedAt !== null || k.revokedAt !== null ||
    !same(k.signerIdentity, { bindingTier: signer.bindingTier, identifier: signer.identifier, displayName: signer.displayName })) {
    bad(`registry: ${rel(REGISTRY_FILE)} does not list exactly the signer's key as active, with activatedAt no later than ${earliest}`);
  } else lines.push(`registry: ${rel(REGISTRY_FILE)} lists exactly the key signer.json names, active since ${k.activatedAt}`);

  // docs/records.json.
  const want = json(recordsJsonFor(log, bundles, cfg));
  if (!fs.existsSync(RECORDS_JSON) || fs.readFileSync(RECORDS_JSON, 'utf8') !== want) bad(`${rel(RECORDS_JSON)} DIFFERS from a fresh derivation (run node package/build.mjs host)`);
  else lines.push(`${rel(RECORDS_JSON)}: equals a fresh derivation; statuses ${countStatuses(bundles)}`);

  // Record files with no bundle yet.
  const pending = recordFiles(cp.sources).filter((r) => r.present && !log.records[r.name]);
  lines.push(`pending: ${pending.length} record file${pending.length === 1 ? '' : 's'} with no bundle${pending.length ? ` (${pending.length > 3 ? `${pending.slice(0, 3).map((r) => r.file).join(', ')} …` : pending.map((r) => r.file).join(', ')}); sign them with: op run --env-file=.env.sign -- node package/build.mjs sign` : ''}`);
  for (const l of lines) console.log(l);
  console.log(ok ? 'check: passed' : 'check: FAILED');
  process.exit(ok ? 0 : 1);
}

function countStatuses(bundles) {
  const n = { active: 0, withdrawn: 0 };
  for (const b of Object.values(bundles)) n[lifecycleOf(b).status] += 1;
  return `active ${n.active}, withdrawn ${n.withdrawn}`;
}

// ---------------------------------------------------------------------------------------------------
// Signing

async function verifyOffline(pkg, envelopeHash, signature) {
  const realFetch = globalThis.fetch;
  const counter = { global: 0, injected: 0 };
  globalThis.fetch = () => {
    counter.global += 1;
    throw new Error('network blocked');
  };
  try {
    const r = await verifyRecord(
      { package: JSON.parse(JSON.stringify(pkg)), packageHash: envelopeHash, signature },
      {
        registry: undefined,
        fetch: () => {
          counter.injected += 1;
          throw new Error('network blocked');
        },
      },
    );
    return { r, counter };
  } finally {
    globalThis.fetch = realFetch;
  }
}

function versions() {
  const v = (n) => readJson(path.join(ROOT, 'node_modules', '@typedstandards', n, 'package.json')).version;
  return { produceCore: v('produce-core'), verifyCore: v('verify-core'), node: process.versions.node };
}

// Every existing record must rebuild and keep its file, and the supplied key must reproduce every
// committed signature, the withdrawals' included. Ed25519 signatures are deterministic, so only the
// signing key reproduces them.
function signingCheck(seed, signer, log, cp) {
  const { ok: rebuilt, bundles, lines } = rebuild(log, signer, cp);
  for (const l of lines) console.log(l);
  let n = 0;
  let ok = rebuilt;
  for (const b of Object.values(bundles)) {
    for (const [hash, committed] of [[b.packageHash, b.signature], ...withdrawalsOf(b).map((c) => [c.nodeId, c.signature])]) {
      const again = signEnvelopeHash(hash, seed, signer.identifier);
      const match = again.signature === committed?.signature && again.publicKey === committed?.publicKey && again.kid === (committed?.kid ?? again.kid);
      ok &&= match;
      n += 1;
    }
  }
  console.log(ok ? `signing check: the key reproduces all ${n} committed signatures` : 'signing check FAILED');
  return ok;
}

async function sign() {
  const signer = readJson(SIGNER_FILE);
  const { seed, source } = loadSeed();
  if (deriveKeyDerivedIdentifierFromKey(seed) !== signer.identifier) die(`the key from ${source} does not derive the identifier in ${rel(SIGNER_FILE)}`);
  console.log(`the key from ${source} derives the identifier in ${rel(SIGNER_FILE)}, ${short(signer.identifier)}`);
  const cp = corpus();
  const all = recordFiles(cp.sources);
  const log = fs.existsSync(BUILD_LOG) ? readJson(BUILD_LOG) : null;
  if (!log) {
    const found = all.filter((r) => fs.existsSync(bundlePath(r.name)));
    if (found.length) die(`${found.map((r) => rel(bundlePath(r.name))).join(', ')} exist but ${rel(BUILD_LOG)} does not; nothing written`);
  } else {
    for (const r of all) {
      if (fs.existsSync(bundlePath(r.name)) && !log.records[r.name]) die(`${rel(bundlePath(r.name))} exists, but the build log does not record it; nothing written`);
    }
    if (!signingCheck(seed, signer, log, cp)) die('an existing record does not rebuild, its file changed, or the key does not reproduce its signature; nothing written');
  }
  for (const m of cp.manifest.sources) {
    const file = path.join(ROOT, 'data', `${m.key}.bin`);
    if (fs.existsSync(file) && sha256File(file) !== m.sha256) die(`data/${m.key}.bin does not match the manifest`);
  }

  const pending = all.filter((r) => r.present && !log?.records[r.name]);
  const step = log ? Math.max(...Object.values(log.records).map((e) => e.step ?? 1)) + 1 : 1;
  const batch = step === 1 ? pending.filter((r) => r.role === 'core' || r.role === 'map-v1') : pending;
  if (step === 1 && batch.length !== 2) die('version 1 needs core.md and map.yaml');
  // A restatement is signed only after the record it restates is withdrawn, so the two are never current
  // together.
  const restates = (r) => (r.role === 'edge' ? (r.edge.replaces ? `map/edges/${r.edge.replaces}` : null)
    : (cp.sources.headers ?? []).find((h) => h.file === r.file)?.replaces?.replace(/\.yaml$/, '') ?? null);
  for (const r of batch) {
    const target = restates(r);
    if (target && log?.records[target] && lifecycleOf(readJson(bundlePath(target))).status !== 'withdrawn') {
      die(`${r.file} restates ${target}, which is not withdrawn yet; run withdraw for it first. Nothing written`);
    }
  }
  if (!batch.length) {
    seed.fill(0);
    console.log('nothing to sign: every record file has a bundle, so nothing was written');
    return;
  }

  const files = filesOnDisk();
  const cfg = hostConfig();
  const vers = versions();
  const built = [];
  for (const rec of batch) {
    const ids = { packageId: crypto.randomUUID(), createdAt: new Date().toISOString() };
    const { pkg, envelopeHash } = buildEnvelope(recordInput(rec, ids, signer, cp, files, step));
    const signature = signEnvelopeHash(envelopeHash, seed, signer.identifier);
    const { r, counter } = await verifyOffline(pkg, envelopeHash, signature);
    const ok =
      r.envelopeIntegrity.status === 'verified' && r.signatureValid === true &&
      r.contentCanonicalization?.status === 'ok' && r.contentCanonicalization?.rule === RAW_BYTES_CANONICALIZATION &&
      r.contentHash?.status === 'ok' && pkg.contentHash.sha256 === sha256File(path.join(ROOT, rec.file)) &&
      r.keyTrust?.status === 'self_certified' && r.keyTrust?.verified === false &&
      r.signingKeyIdConsistency?.status === 'ok' && signature.kid === pkg.signer.identifier &&
      r.typeResolution?.status === 'ok' && r.nodeId === envelopeHash && r.lifecycle?.status === 'active' &&
      r.signerIdentity?.status === 'key_derived_match' && r.captureMethodVocab?.status === 'ok' &&
      r.contentProfile?.status === 'contentProfile_absent' &&
      counter.global === 0 && counter.injected === 0;
    console.log(`${rec.name}: envelope ${short(envelopeHash)}  #1 ${r.envelopeIntegrity.status}  #2 ${r.signatureValid}  #4 ${r.contentHash?.status}  #5 ${r.keyTrust?.status}  #6 ${r.signingKeyIdConsistency?.status}  #14 ${r.signerIdentity?.status}  fetch ${counter.global}/${counter.injected}`);
    if (!ok) die(`${rec.name} did not verify locally as expected; nothing written`);
    built.push({ rec, ids, pkg, envelopeHash, signature });
  }
  seed.fill(0);

  const next = log ?? {
    $comment: '',
    signer: signer.identifier,
    producerProfile: PRODUCER_PROFILE,
    captureMethod: CAPTURE_METHOD,
    contentCanonicalization: RAW_BYTES_CANONICALIZATION,
    versions: vers,
    inputs: files,
    records: {},
  };
  next.$comment = LOG_COMMENT;
  for (const { rec, ids, pkg, envelopeHash, signature } of built) {
    const title = describe(rec, cp).title;
    const b = bundleFor(pkg, envelopeHash, signature, title, undefined, cfg);
    fs.mkdirSync(path.dirname(bundlePath(rec.name)), { recursive: true });
    writeJson(bundlePath(rec.name), b);
    next.records[rec.name] = step === 1
      ? { file: rec.file, ...ids, envelopeHash, bundle: rel(bundlePath(rec.name)) }
      : { file: rec.file, role: rec.role, step, ...ids, envelopeHash, bundle: rel(bundlePath(rec.name)), versions: vers, inputs: { script: files.script, sourcesJson: files.sourcesJson, manifestJson: files.manifestJson, builder: files.builder } };
  }
  fs.writeFileSync(BUILD_LOG, json(next));
  console.log(`step ${step}: signed ${built.length} record${built.length === 1 ? '' : 's'}; wrote ${built.length} bundle${built.length === 1 ? '' : 's'} in package/ and ${rel(BUILD_LOG)}`);
  host();
}

const LOG_COMMENT = 'Written by package/build.mjs sign. Version 1\'s two records (core, map) were built with the top-level versions and inputs; every later record names its own step, versions and inputs. The ids, times and digests below, with the files on disk, rebuild every envelope and every withdrawal (node package/build.mjs check).';

// ---------------------------------------------------------------------------------------------------
// Withdrawal: an attestation/withdraws/v1 node, signed by the same key, carried in the record's view.

function withdrawalInput(w, bundle, signer) {
  return {
    packageId: w.packageId,
    createdAt: w.createdAt,
    signingKeyId: signer.identifier,
    type: ATTESTATION_WITHDRAWS,
    targetNodeId: bundle?.packageHash ?? '',
    signer: { bindingTier: signer.bindingTier, identifier: signer.identifier, displayName: signer.displayName },
    reason: w.reason,
  };
}

function withdraw(name, reason) {
  if (!name || !reason || !reason.trim()) die('usage: node package/build.mjs withdraw <name> --reason <text>');
  const signer = readJson(SIGNER_FILE);
  const { seed, source } = loadSeed();
  if (deriveKeyDerivedIdentifierFromKey(seed) !== signer.identifier) die(`the key from ${source} does not derive the identifier in ${rel(SIGNER_FILE)}`);
  const log = readLog();
  const cp = corpus();
  if (!log.records[name]) die(`no signed record named ${name}`);
  if (!signingCheck(seed, signer, log, cp)) die('the signing check failed; nothing written');
  const bundle = readJson(bundlePath(name));
  if (lifecycleOf(bundle).status === 'withdrawn') die(`${name} is already withdrawn; nothing written`);
  const w = { target: name, type: ATTESTATION_WITHDRAWS, packageId: crypto.randomUUID(), createdAt: new Date().toISOString(), reason: reason.trim() };
  const { node, nodeId } = buildAttestationNode(withdrawalInput(w, bundle, signer));
  const signature = signEnvelopeHash(nodeId, seed, signer.identifier);
  seed.fill(0);
  const carried = [...withdrawalsOf(bundle), { node, nodeId, signature }];
  const life = verifyLifecycleChain(carried, bundle.packageHash, signer.identifier);
  if (life.status !== 'withdrawn') die(`the withdrawal does not resolve as withdrawn (${life.status}); nothing written`);
  fs.writeFileSync(bundlePath(name), json({ ...bundle, lifecycleAttestations: carried }));
  log.withdrawals = [...(log.withdrawals ?? []), { ...w, nodeId }];
  log.$comment = LOG_COMMENT;
  fs.writeFileSync(BUILD_LOG, json(log));
  console.log(`${name}: withdrawn by attestation ${short(nodeId)}; verifyLifecycleChain reads ${life.status}`);
  host();
}

// ---------------------------------------------------------------------------------------------------

const stage = argv[0];
if (stage === 'keygen') keygen();
else if (stage === 'sign' || stage === 'assemble') await sign();
else if (stage === 'withdraw') {
  const r = argv.indexOf('--reason');
  withdraw(argv[1], r >= 0 ? argv[r + 1] : undefined);
} else if (stage === 'host') host();
else if (stage === 'check') check();
else die('usage: node package/build.mjs keygen|sign|withdraw <name> --reason <text>|host|check [--root <dir>]');
