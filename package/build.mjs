#!/usr/bin/env node
// Program 2 of 2: package the two published content files as signed Typed Standards records.
//
//   node package/build.mjs keygen    generate a fresh Ed25519 seed outside the repository (mode 600) and
//                                    write package/signer.json with the did:key identifier derived from it
//   node package/build.mjs sign      read core.md and map.yaml from disk, build one record per file, sign
//                                    both, verify both offline, then write package/core.bundle.json,
//                                    package/map.bundle.json and package/build-log.json. When those exist
//                                    already, write nothing: re-sign each committed envelope hash with the
//                                    supplied key and confirm it reproduces the committed signature
//                                    (Ed25519 is deterministic). `assemble` is the same stage's earlier name.
//   node package/build.mjs check     rebuild both envelopes unsigned from the build log and the files on
//                                    disk, and compare them with the signed bundles
//
// The signing key comes from the environment variable SIGNING_SEED_B64 (standard base64 of the 32-byte
// seed) when it is set, and from the seed file outside the repository only when it is not. The owner's
// key lives in 1Password, and signing runs in the owner's own terminal:
//   op run --env-file=.env.sign -- node package/build.mjs sign
// where .env.sign is a copy of .env.sign.example, which holds an op:// reference, never a value.
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
  RAW_BYTES_CANONICALIZATION,
  sha256Hex,
  signEnvelopeHash,
} from '@typedstandards/produce-core';
import { verifyRecord } from '@typedstandards/verify-core';

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

// `logged` is the build log's inputs. When it is given, the builder is named by the digest the build log
// recorded, because that is the program that signed the records; a later change to this file (for example,
// how the key is supplied) does not change what was signed.
function inputs(logged) {
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
      builder: logged?.builder ?? pathsSha('package/build.mjs'),
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

async function sign() {
  const signer = readJson(SIGNER_FILE);
  const { seed, source } = loadSeed();
  if (deriveKeyDerivedIdentifierFromKey(seed) !== signer.identifier) die(`the key from ${source} does not derive the identifier in ${rel(SIGNER_FILE)}`);
  console.log(`the key from ${source} derives the identifier in ${rel(SIGNER_FILE)}, ${short(signer.identifier)}`);
  const outputs = [...Object.keys(RECORDS).map((n) => path.join(PKG_DIR, `${n}.bundle.json`)), BUILD_LOG];
  const present = outputs.filter((p) => fs.existsSync(p));
  if (present.length === outputs.length) {
    const ok = signingCheck(seed, signer);
    seed.fill(0);
    process.exit(ok ? 0 : 1);
  }
  if (present.length) die(`${present.map(rel).join(', ')} exist but not all outputs do; nothing written`);
  const inp = inputs();
  for (const m of inp.manifest.sources) {
    const file = path.join(ROOT, 'data', `${m.key}.bin`);
    if (fs.existsSync(file) && sha256File(file) !== m.sha256) die(`data/${m.key}.bin does not match the manifest`);
  }

  const ids = {};
  for (const name of Object.keys(RECORDS)) ids[name] = { packageId: crypto.randomUUID(), createdAt: new Date().toISOString() };
  const built = buildBoth(ids, signer, inp);

  const log = {
    $comment: 'Written by package/build.mjs sign. The ids and times below, with the files on disk, rebuild both envelopes (node package/build.mjs check).',
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

// Rebuild both envelopes unsigned from the build log and the files on disk. The builder is named by the
// digest the build log recorded; every other input is read from disk and compared with the log.
function rebuild() {
  const log = readJson(BUILD_LOG);
  const signer = readJson(SIGNER_FILE);
  const inp = inputs(log.inputs);
  let ok = true;
  for (const [k, logged] of Object.entries(log.inputs)) {
    if (k === 'builder') {
      const now = sha256File(path.join(ROOT, logged.path));
      console.log(`builder: the records name ${logged.path} at ${short(logged.sha256)} (from the build log); the file on disk ${now === logged.sha256 ? 'is that version' : 'has changed since signing'}`);
      continue;
    }
    const same = inp.files[k].sha256 === logged.sha256;
    ok &&= same;
    if (!same) console.log(`input ${logged.path}: DIFFERS from the build log`);
  }
  if (ok) console.log('inputs: corpus/pin.mjs, corpus/sources.json, corpus/core.template.md and corpus/manifest.json match the build log');
  const built = buildBoth(log.records, signer, inp);
  const bundles = {};
  for (const name of Object.keys(RECORDS)) {
    const bundle = readJson(path.join(PKG_DIR, `${name}.bundle.json`));
    bundles[name] = bundle;
    const same = built[name].envelopeHash === log.records[name].envelopeHash && bundle.packageHash === built[name].envelopeHash;
    const pkgSame = JSON.stringify(bundle.package) === JSON.stringify(built[name].pkg);
    ok &&= same && pkgSame;
    console.log(`${name}: rebuilt envelope hash ${same ? 'matches' : 'DIFFERS'}; bundle package ${pkgSame ? 'matches' : 'DIFFERS'}`);
  }
  return { ok, bundles };
}

function check() {
  process.exit(rebuild().ok ? 0 : 1);
}

// With the records already signed: rebuild them, then sign each committed envelope hash with the supplied
// key. Ed25519 signatures are deterministic, so the same key reproduces the committed signature exactly.
function signingCheck(seed, signer) {
  const { ok: rebuilt, bundles } = rebuild();
  let ok = rebuilt;
  for (const name of Object.keys(RECORDS)) {
    const committed = bundles[name].signature;
    const again = signEnvelopeHash(bundles[name].packageHash, seed, signer.identifier);
    const same = again.signature === committed.signature && again.publicKey === committed.publicKey && again.kid === committed.kid;
    ok &&= same;
    console.log(`${name}: re-signing the committed envelope hash with this key reproduces the committed signature: ${same}`);
  }
  console.log(ok ? 'signing check passed; the records are already signed, so nothing was written' : 'signing check FAILED; nothing was written');
  return ok;
}

const stage = process.argv[2];
if (stage === 'keygen') keygen();
else if (stage === 'sign' || stage === 'assemble') await sign();
else if (stage === 'check') check();
else die('usage: node package/build.mjs keygen|sign|check');
