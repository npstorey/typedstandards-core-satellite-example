#!/usr/bin/env node
// Verify this example's two records offline:  node verify.mjs
//
// Reads package/core.bundle.json and package/map.bundle.json. Each bundle is the spec §8.8 inline shape:
// the commitment view plus the signed package. Runs @typedstandards/verify-core's verifyRecord on each,
// with no trust registry, no Rekor entry id and no RFC 3161 token, and prints the spec §9.2 checks with
// the statuses this signer produces. The global fetch is replaced by a stub that throws and counts, and
// the fetch injected into verify-core throws and counts too; both counts must end at 0.
//
// Each record carries its file's exact UTF-8 bytes inline under raw-bytes/v1, so check #4 needs no fetch,
// and this program also compares the file on disk with the signed output byte for byte. Check #6
// (signature kid = metadata.signingKeyId) is verify-core's since 0.11.0 (typedstandards#88). #6 does not
// compare signer.identifier, so the example's own rule that the kid is also signer.identifier (hub
// ADR-0030 §5) is a line of its own. Identifiers and digests print abbreviated; the full values are in
// the bundles. Exits non-zero on any failure.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAW_BYTES_CANONICALIZATION, verifyRecord } from '@typedstandards/verify-core';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RECORDS = [
  { name: 'core', bundle: 'package/core.bundle.json', file: 'core.md' },
  { name: 'map', bundle: 'package/map.bundle.json', file: 'map.yaml' },
];
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const short = (s) => (typeof s === 'string' && s.length > 20 ? `${s.slice(0, 12)}…${s.slice(-4)}` : String(s));

let globalCalls = 0;
globalThis.fetch = (...args) => {
  globalCalls += 1;
  throw new Error(`network blocked: ${String(args[0])}`);
};
let injectedCalls = 0;
const blockedFetch = async (url) => {
  injectedCalls += 1;
  throw new Error(`network blocked: ${String(url)}`);
};

const failures = [];
// ok: true = passed, false = failed, null = not applicable in this version.
const line = (label, ok, text) => {
  if (ok === false) failures.push(label);
  const mark = ok === false ? 'FAIL' : ok === null ? 'n/a ' : 'ok  ';
  console.log(`  ${label.padEnd(24)} ${mark}  ${text}`);
};

const pkgJson = read('package.json');
const installed = (n) => read(`node_modules/@typedstandards/${n}/package.json`).version;
console.log(`verify-core ${installed('verify-core')} (pinned ${pkgJson.dependencies['@typedstandards/verify-core']}), produce-core ${installed('produce-core')} (pinned ${pkgJson.dependencies['@typedstandards/produce-core']}), node ${process.versions.node}`);

const signers = [];
for (const rec of RECORDS) {
  const b = read(rec.bundle);
  const pkg = b.package;
  console.log(`\n${rec.name}  ${rec.bundle} -> ${rec.file}`);
  const r = await verifyRecord(
    { package: JSON.parse(JSON.stringify(pkg)), packageHash: b.packageHash, signature: b.signature },
    { registry: undefined, fetch: blockedFetch },
  );
  signers.push({ publicKey: b.signature.publicKey, identifier: pkg.signer?.identifier });

  line('#1 envelope integrity', r.envelopeIntegrity.status === 'verified' && r.recomputedHash === b.packageHash,
    `${r.envelopeIntegrity.status}; recomputed ${short(r.recomputedHash)} ${r.recomputedHash === b.packageHash ? 'equals' : 'differs from'} packageHash`);
  line('#2 signature', r.signatureValid === true, `${r.signatureValid ? 'valid' : 'invalid'} (${b.signature.algorithm})`);
  const cc = r.contentCanonicalization;
  line('#3 canonicalization', cc?.status === 'ok' && cc?.rule === RAW_BYTES_CANONICALIZATION,
    `${cc?.status} ${cc?.rule === RAW_BYTES_CANONICALIZATION ? 'raw-bytes/v1' : cc?.rule}`);
  const ch = r.contentHash;
  line('#4 content hash', ch?.status === 'ok' && ch?.matched === 'sha256', `${ch?.status}, ${ch?.matched} matched, from the inline output`);
  const onDisk = fs.readFileSync(path.join(ROOT, rec.file));
  const diskSha = crypto.createHash('sha256').update(onDisk).digest('hex');
  const sameBytes = Buffer.compare(onDisk, Buffer.from(pkg.output, 'utf8')) === 0;
  line('file on disk', sameBytes && diskSha === pkg.contentHash.sha256,
    `${rec.file} equals the signed output byte for byte: ${sameBytes}; its SHA-256 ${short(diskSha)} equals contentHash.sha256: ${diskSha === pkg.contentHash.sha256}`);
  line('#5 key trust', r.keyTrust?.status === 'self_certified' && r.keyTrust?.verified === false,
    `${r.keyTrust?.status}, verified ${r.keyTrust?.verified}; no registry vouches for the key`);
  const kid = b.signature.kid;
  const k6 = r.signingKeyIdConsistency;
  line('#6 kid consistency', k6?.status === 'ok', k6?.status === 'ok'
    ? `ok: signature.kid equals metadata.signingKeyId (${short(kid)})`
    : `${k6?.status}: signature.kid ${short(kid)}, metadata.signingKeyId ${short(pkg.metadata?.signingKeyId)}`);
  const idOk = typeof kid === 'string' && kid === pkg.signer?.identifier;
  line('kid = signer.identifier', idOk, `signature.kid equals signer.identifier: ${idOk}; the example's own rule, which #6 does not compare`);
  line('#7 RFC 3161 timestamp', r.rfc3161 === null && !r.hasTimestamp && !('rfc3161Timestamp' in b) ? null : false,
    'no token; none is requested in this version');
  line('#8 Rekor inclusion', r.rekorInclusion === null && !r.hasRekor && !('rekorEntryId' in b) ? null : false,
    'no entry; none is submitted in this version');
  line('#9 BlobRef', r.blobRefs.length === 0 ? null : false, 'no BlobRef fields; output is inline');
  line('#10 lifecycle', r.lifecycle?.status === 'active', `${r.lifecycle?.status}, source ${r.lifecycle?.source}`);
  line('#11 captureMethod', pkg.metadata.captureMethod === 'script-run', `${pkg.metadata.captureMethod} (a signed label; nothing verifies the run it names)`);
  line('#12 type', r.typeResolution?.status === 'ok', `${r.typeResolution?.status} ${r.typeResolution?.type}`);
  line('#13 node id', r.nodeId === b.packageHash, `nodeId ${r.nodeId === b.packageHash ? 'equals' : 'differs from'} the bundle's packageHash`);
  line('#14 signer identity', r.signerIdentity?.status === 'key_derived_match',
    `${r.signerIdentity?.status}; the identifier is derived from the signing key (bindingTier ${pkg.signer?.bindingTier})`);
  const cm = r.captureMethodVocab;
  line('#15 captureMethod vocab', cm?.status === 'ok', `${cm?.status}: '${cm?.captureMethod}' under '${pkg.producerProfile}'`);
  line('#16 content profile', r.contentProfile?.status === 'contentProfile_absent', `${r.contentProfile?.status} (read as "default")`);
  const viewSame = ['producerProfile', 'type', 'contentCanonicalization', 'captureMethod'].every((k) =>
    JSON.stringify(b[k]) === JSON.stringify(k === 'captureMethod' ? pkg.metadata.captureMethod : pkg[k])) &&
    JSON.stringify(b.signer) === JSON.stringify(pkg.signer) && JSON.stringify(b.contentHash) === JSON.stringify(pkg.contentHash);
  const noRegistry = !('trustRegistryUrl' in b) && !('trustRegistry' in b);
  line('bundle view', viewSame && noRegistry,
    `the view's signer, content hash, rule, type, profile and capture method equal the package's: ${viewSame}; no trust registry named or carried: ${noRegistry}`);
}

console.log('\nboth records');
const oneKey = signers.every((s) => s.publicKey === signers[0].publicKey && s.identifier === signers[0].identifier);
line('one key', oneKey, `both signatures carry one public key and one identifier, ${short(signers[0].identifier)}`);

console.log(`\nnetwork: global fetch calls ${globalCalls}; injected fetch calls ${injectedCalls}`);
if (globalCalls !== 0 || injectedCalls !== 0) failures.push('network');
console.log(failures.length === 0 ? 'result: all checks passed' : `result: FAILED (${failures.join(', ')})`);
process.exit(failures.length === 0 ? 0 : 1);
