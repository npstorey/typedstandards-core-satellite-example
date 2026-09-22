#!/usr/bin/env node
// Program 2 of 2: package the two published content files as signed Typed Standards records.
//
//   node package/build.mjs keygen    generate a fresh Ed25519 seed outside the repository (mode 600) and
//                                    write package/signer.json with the did:key identifier derived from it
//   node package/build.mjs assemble  read core.md and map.yaml from disk, build one record per file, sign
//                                    both, verify both offline, then write package/core.bundle.json,
//                                    package/map.bundle.json and package/build-log.json
//   node package/build.mjs check     rebuild both envelopes unsigned from the build log and the files on
//                                    disk, and compare them with the signed bundles
//
// This program runs after corpus/pin.mjs has written the two files, and reads their bytes from disk. That
// is what makes the capture method `script-run` (hub ADR-0029 §2). Each record carries its file's exact
// UTF-8 bytes inline as `output` under raw-bytes/v1, so `shasum -a 256 <file>` equals contentHash.sha256.
// The source digests the files cite are signed assertions in queries[].arguments; no check recomputes them.
//
// The signer is self-certifying: a did:key derived from the seed, bindingTier pseudonymous, no trust
// registry, no RFC 3161 token, no Rekor entry. One identifier string is metadata.signingKeyId, the
// envelope kid and signer.identifier (hub ADR-0030 §5). Stages refuse to overwrite their outputs.
// Nothing here prints the seed, a private key or a signature; identifiers and digests print abbreviated.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCommitmentView,
  buildEnvelope,
  DEFAULT_CONTENT_TYPE,
  deriveKeyDerivedIdentifierFromKey,
  derivePublicKeySpki,
  sha256Hex,
  signEnvelopeHash,
} from '@typedstandards/produce-core';
import { RAW_BYTES_CANONICALIZATION, verifyRecord } from '@typedstandards/verify-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = path.join(ROOT, 'package');
const SEED_PATH = path.join(os.homedir(), '.config', 'typedstandards-core-satellite-example', 'signing.seed');
const SIGNER_FILE = path.join(PKG_DIR, 'signer.json');
const BUILD_LOG = path.join(PKG_DIR, 'build-log.json');

const REPO = 'https://github.com/npstorey/typedstandards-core-satellite-example';
const NS = 'io.github.npstorey.core-satellite-example';
const DISPLAY_NAME = 'typedstandards-core-satellite-example (self-certifying example key)';
const PRODUCER_PROFILE = 'scripted-recomputation/core-satellite-example';
const CAPTURE_METHOD = 'script-run';
const SCIOS = { title: 'The Core-Satellite Model', publisher: 'SciOS', location: 'https://scios.tech/thoughts', dated: '2026-06-30', readAt: '2026-09-22' };

const RECORDS = {
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
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, { flag: 'wx' });
const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const short = (s) => `${s.slice(0, 12)}…${s.slice(-4)}`;
const die = (msg) => {
  console.error(`stopped: ${msg}`);
  process.exit(1);
};

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
  writeJson(SIGNER_FILE, {
    $comment: 'The signer of the two records in this repository. The identifier is derived from the public key (did:key, base58btc, hub ADR-0030 §2); it proves that one key signed both records and nothing about who holds the key. No trust registry lists it. The seed is held outside the repository.',
    bindingTier: 'pseudonymous',
    identifier,
    displayName: DISPLAY_NAME,
    publicKey,
    algorithm: 'Ed25519ph',
  });
  const mode = (fs.statSync(SEED_PATH).mode & 0o777).toString(8);
  console.log(`seed written outside the repository, mode ${mode}; identifier ${short(identifier)} (${identifier.length} chars)`);
  console.log(`wrote ${rel(SIGNER_FILE)}`);
}

function inputs() {
  const pathsSha = (p) => ({ path: p, sha256: sha256File(path.join(ROOT, p)) });
  const manifest = readJson(path.join(ROOT, 'corpus', 'manifest.json'));
  const sources = readJson(path.join(ROOT, 'corpus', 'sources.json'));
  return {
    manifest,
    sources,
    pinned: new Map(manifest.sources.map((m) => [m.key, m])),
    unpinned: new Map(manifest.unpinned.map((m) => [m.key, m])),
    files: {
      script: pathsSha('corpus/pin.mjs'),
      sourcesJson: pathsSha('corpus/sources.json'),
      template: pathsSha('corpus/core.template.md'),
      manifestJson: pathsSha('corpus/manifest.json'),
      builder: pathsSha('package/build.mjs'),
    },
  };
}

// The source keys each file cites: core.md its listed sources, map.yaml every node's source.
function sourceKeys(name, inp) {
  if (name === 'core') return inp.sources.core.sources;
  const keys = [];
  for (const e of inp.sources.edges) {
    for (const id of [e.subject, e.object]) {
      const k = inp.sources.nodes[id].source;
      if (!keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}

function recordInput(name, ids, signer, inp) {
  const r = RECORDS[name];
  const text = fs.readFileSync(path.join(ROOT, r.file), 'utf8');
  const bytes = Buffer.byteLength(text, 'utf8');
  const fileSha = sha256File(path.join(ROOT, r.file));
  if (sha256Hex(text) !== fileSha) die(`${r.file} does not round-trip as UTF-8`);
  const keys = sourceKeys(name, inp);
  const pinned = keys.filter((k) => inp.pinned.has(k)).map((k) => inp.pinned.get(k));
  const unpinned = keys.filter((k) => inp.unpinned.has(k)).map((k) => inp.unpinned.get(k));
  if (pinned.length + unpinned.length !== keys.length) die(`${r.file} cites a source the manifest does not record`);
  const writerInputs = [inp.files.sourcesJson, ...(name === 'core' ? [inp.files.template] : []), inp.files.manifestJson];
  return {
    packageId: ids.packageId,
    createdAt: ids.createdAt,
    signingKeyId: signer.identifier,
    prompt: `Package the file ${r.file}, ${r.task}, as the output of a scripted-recomputation record under raw-bytes/v1. corpus/pin.mjs wrote the file from ${writerInputs.map((f) => f.path).join(', ')}; this program read it from disk.`,
    promptVisibility: 'full_text',
    queries: [
      ...pinned.map((m) => ({
        tool: 'curl',
        operationType: 'retrieve',
        arguments: { url: m.location, sha256: m.sha256, bytes: m.bytes, httpStatus: m.httpStatus, fetchedAt: m.fetchedAt, licence: m.licence },
        datasetId: m.key,
      })),
      {
        tool: inp.files.script.path,
        operationType: 'script-run',
        arguments: {
          command: 'node corpus/pin.mjs',
          scriptSha256: inp.files.script.sha256,
          inputs: writerInputs,
          ...(unpinned.length ? { unpinned: unpinned.map((u) => ({ key: u.key, location: u.location, sha256: null, reason: u.reason })) } : {}),
          output: { path: r.file, sha256: fileSha, bytes },
        },
      },
      {
        tool: inp.files.builder.path,
        operationType: 'package-file',
        arguments: { command: 'node package/build.mjs assemble', scriptSha256: inp.files.builder.sha256, inputFile: r.file, inputSha256: fileSha },
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
    summary: `${r.title}. The file's exact UTF-8 bytes (${bytes} bytes) are this record's output under raw-bytes/v1, so contentHash.sha256 is the file's ordinary SHA-256. The ${pinned.length} source digests in queries are signed assertions that no check recomputes. The signer is a self-certifying did:key; it shows which key signed, not who holds it.`,
    captureMethod: CAPTURE_METHOD,
    producerProfile: PRODUCER_PROFILE,
    type: DEFAULT_CONTENT_TYPE,
    signer: { bindingTier: signer.bindingTier, identifier: signer.identifier, displayName: signer.displayName },
    contentCanonicalization: RAW_BYTES_CANONICALIZATION,
    extensions: {
      [NS]: {
        role: name === 'core' ? 'core-record' : 'map',
        repository: REPO,
        file: { path: r.file, sha256: fileSha, bytes },
        writer: inp.files.script,
        writerInputs,
        pinnedAt: inp.manifest.pinnedAt,
        sourcesCited: { pinned: pinned.length, unpinned: unpinned.length },
        model: SCIOS,
      },
    },
  };
}

function buildBoth(ids, signer, inp) {
  const out = {};
  for (const name of Object.keys(RECORDS)) out[name] = buildEnvelope(recordInput(name, ids[name], signer, inp));
  return out;
}

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

async function assemble() {
  for (const name of Object.keys(RECORDS)) if (fs.existsSync(path.join(PKG_DIR, `${name}.bundle.json`))) die(`package/${name}.bundle.json exists`);
  if (fs.existsSync(BUILD_LOG)) die(`${rel(BUILD_LOG)} exists`);
  const signer = readJson(SIGNER_FILE);
  const seed = new Uint8Array(fs.readFileSync(SEED_PATH));
  if (seed.length !== 32) die('the seed is not 32 bytes');
  if (deriveKeyDerivedIdentifierFromKey(seed) !== signer.identifier) die('the seed does not derive the identifier in package/signer.json');
  const inp = inputs();
  for (const m of inp.manifest.sources) {
    const file = path.join(ROOT, 'data', `${m.key}.bin`);
    if (fs.existsSync(file) && sha256File(file) !== m.sha256) die(`data/${m.key}.bin does not match the manifest`);
  }

  const ids = {};
  for (const name of Object.keys(RECORDS)) ids[name] = { packageId: crypto.randomUUID(), createdAt: new Date().toISOString() };
  const built = buildBoth(ids, signer, inp);

  const log = {
    $comment: 'Written by package/build.mjs assemble. The ids and times below, with the files on disk, rebuild both envelopes (node package/build.mjs check).',
    signer: signer.identifier,
    producerProfile: PRODUCER_PROFILE,
    captureMethod: CAPTURE_METHOD,
    contentCanonicalization: RAW_BYTES_CANONICALIZATION,
    versions: versions(),
    inputs: inp.files,
    records: {},
  };
  const bundles = {};
  for (const name of Object.keys(RECORDS)) {
    const { pkg, envelopeHash } = built[name];
    const signature = signEnvelopeHash(envelopeHash, seed, signer.identifier);
    const { r, counter } = await verifyOffline(pkg, envelopeHash, signature);
    const file = RECORDS[name].file;
    const ok =
      r.envelopeIntegrity.status === 'verified' && r.signatureValid === true &&
      r.contentCanonicalization?.status === 'ok' && r.contentCanonicalization?.rule === RAW_BYTES_CANONICALIZATION &&
      r.contentHash?.status === 'ok' && pkg.contentHash.sha256 === sha256File(path.join(ROOT, file)) &&
      r.keyTrust?.status === 'self_certified' && r.keyTrust?.verified === false &&
      r.typeResolution?.status === 'ok' && r.nodeId === envelopeHash &&
      r.signerIdentity?.status === 'key_derived_match' && r.captureMethodVocab?.status === 'ok' &&
      r.contentProfile?.status === 'contentProfile_absent' &&
      signature.kid === pkg.metadata.signingKeyId && pkg.metadata.signingKeyId === pkg.signer.identifier &&
      counter.global === 0 && counter.injected === 0;
    console.log(`${name}: envelope ${short(envelopeHash)}  #1 ${r.envelopeIntegrity.status}  #2 ${r.signatureValid}  #3 ${r.contentCanonicalization?.status}  #4 ${r.contentHash?.status}  #5 ${r.keyTrust?.status}  #12 ${r.typeResolution?.status}  #14 ${r.signerIdentity?.status}  #15 ${r.captureMethodVocab?.status}  #16 ${r.contentProfile?.status}  fetch ${counter.global}/${counter.injected}`);
    if (!ok) die(`${name} did not verify locally as expected; nothing written`);
    const view = buildCommitmentView({
      packageHash: envelopeHash,
      visibility: 'public',
      captureMethod: pkg.metadata.captureMethod ?? null,
      producerProfile: pkg.producerProfile,
      type: pkg.type,
      signer: pkg.signer,
      contentHash: pkg.contentHash,
      contentCanonicalization: pkg.contentCanonicalization,
      signature: { ...signature },
      subjectTitle: RECORDS[name].title,
      subjectSummary: pkg.summary ?? null,
    });
    bundles[name] = { ...view, package: pkg };
    log.records[name] = { file, ...ids[name], envelopeHash, bundle: `package/${name}.bundle.json` };
  }
  seed.fill(0);
  for (const name of Object.keys(RECORDS)) writeJson(path.join(PKG_DIR, `${name}.bundle.json`), bundles[name]);
  writeJson(BUILD_LOG, log);
  console.log('wrote package/core.bundle.json, package/map.bundle.json, package/build-log.json');
}

function versions() {
  const v = (n) => readJson(path.join(ROOT, 'node_modules', '@typedstandards', n, 'package.json')).version;
  return { produceCore: v('produce-core'), verifyCore: v('verify-core'), node: process.versions.node };
}

function check() {
  const log = readJson(BUILD_LOG);
  const signer = readJson(SIGNER_FILE);
  const built = buildBoth(log.records, signer, inputs());
  let ok = true;
  for (const name of Object.keys(RECORDS)) {
    const bundle = readJson(path.join(PKG_DIR, `${name}.bundle.json`));
    const same = built[name].envelopeHash === log.records[name].envelopeHash && bundle.packageHash === built[name].envelopeHash;
    const pkgSame = JSON.stringify(bundle.package) === JSON.stringify(built[name].pkg);
    ok &&= same && pkgSame;
    console.log(`${name}: rebuilt envelope hash ${same ? 'matches' : 'DIFFERS'}; bundle package ${pkgSame ? 'matches' : 'DIFFERS'}`);
  }
  process.exit(ok ? 0 : 1);
}

const stage = process.argv[2];
if (stage === 'keygen') keygen();
else if (stage === 'assemble') await assemble();
else if (stage === 'check') check();
else die('usage: node package/build.mjs keygen|assemble|check');
