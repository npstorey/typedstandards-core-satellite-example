#!/usr/bin/env node
// Verify every record this example's host serves, offline:  node verify.mjs [--root <dir>]
//
// Reads docs/records.json, the list of served records, and each record's served bundle in docs/bundles/:
// the spec §8.8 inline shape, the commitment view plus the signed package. Runs @typedstandards/verify-core's
// verifyRecord on each, with no trust registry, no Rekor entry id and no RFC 3161 token, and prints one line
// per record, then the totals. The global fetch is replaced by a stub that throws and counts, and the fetch
// injected into verify-core throws and counts too; both counts must end at 0.
//
// Each record carries its file's exact UTF-8 bytes inline under raw-bytes/v1, so check #4 needs no fetch,
// and this program also compares the file on disk with the signed output byte for byte. Check #6
// (signature kid = metadata.signingKeyId) is verify-core's (typedstandards#88); the example's own rule that
// the kid is also signer.identifier (hub ADR-0030 §5) is checked beside it. For check #10 each view's
// carried withdrawals are resolved with verify-core's verifyLifecycleChain and passed to verifyRecord, so a
// carried withdrawal reads withdrawn. No registry is supplied, so #5 reads self_certified for every record;
// the registry the host serves is read only to check that it lists exactly the signer's key, and that each
// view names it and carries the same copy. Exits non-zero on any failure.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAW_BYTES_CANONICALIZATION, validateRegistry, verifyLifecycleChain, verifyRecord } from '@typedstandards/verify-core';

const rootAt = process.argv.indexOf('--root');
const ROOT = rootAt >= 0 ? path.resolve(process.argv[rootAt + 1]) : path.dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const short = (s) => (typeof s === 'string' && s.length > 20 ? `${s.slice(0, 12)}…${s.slice(-4)}` : String(s));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
const line = (label, ok, text) => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${text}`);
};

const pkgJson = read('package.json');
const installed = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', '@typedstandards', n, 'package.json'), 'utf8')).version;
console.log(`verify-core ${installed('verify-core')} (pinned ${pkgJson.dependencies['@typedstandards/verify-core']}), produce-core ${installed('produce-core')} (pinned ${pkgJson.dependencies['@typedstandards/produce-core']}), node ${process.versions.node}`);

const served = read('docs/records.json');
const signer = read('package/signer.json');
const registry = read('docs/.well-known/typed-publisher.json');

console.log(`
Each served record, from docs/bundles/<name>.bundle.json. ok means every one of these holds; a failing line names what does not:
  #1 verified, the recomputed hash equals packageHash · #2 valid (Ed25519ph) · #3 ok, raw-bytes/v1 · #4 ok, sha256 matched from the inline output
  the file on disk equals the signed output byte for byte · #5 self_certified, verified false · #6 ok · kid equals signer.identifier
  #7 no RFC 3161 token · #8 no Rekor entry · #9 no BlobRef · #10 read from the carried withdrawals, and equal to docs/records.json's status
  #11 script-run (a signed label; nothing verifies the run it names) · #12 ok, content/analysis/v1 · #13 nodeId equals packageHash
  #14 key_derived_match · #15 ok · #16 contentProfile_absent (read as "default")
  the view's signer, content hash, rule, type, profile and capture method equal the package's; it names the host's trustRegistryUrl and carries the served registry
`);

const keys = [];
const statuses = { active: 0, withdrawn: 0 };
let current = 0;
let versionOne = 0;
for (const rec of served.records) {
  const b = read(`docs/${rec.bundle}`);
  const pkg = b.package;
  const lifecycle = verifyLifecycleChain(b.lifecycleAttestations ?? [], b.packageHash, b.signer?.identifier ?? '');
  const r = await verifyRecord(
    { package: JSON.parse(JSON.stringify(pkg)), packageHash: b.packageHash, signature: b.signature },
    { registry: undefined, fetch: blockedFetch, lifecycleResolution: lifecycle },
  );
  keys.push({ publicKey: b.signature.publicKey, identifier: pkg.signer?.identifier });
  const onDisk = fs.readFileSync(path.join(ROOT, rec.file));
  const diskSha = crypto.createHash('sha256').update(onDisk).digest('hex');
  const cc = r.contentCanonicalization;
  const kid = b.signature.kid;
  const fail = [
    [r.envelopeIntegrity.status === 'verified' && r.recomputedHash === b.packageHash, `#1 ${r.envelopeIntegrity.status}`],
    [r.signatureValid === true, `#2 ${r.signatureValid}`],
    [cc?.status === 'ok' && cc?.rule === RAW_BYTES_CANONICALIZATION, `#3 ${cc?.status} ${cc?.rule}`],
    [r.contentHash?.status === 'ok' && r.contentHash?.matched === 'sha256', `#4 ${r.contentHash?.status}`],
    [Buffer.compare(onDisk, Buffer.from(pkg.output, 'utf8')) === 0 && diskSha === pkg.contentHash.sha256, `${rec.file} differs from the signed output`],
    [r.keyTrust?.status === 'self_certified' && r.keyTrust?.verified === false, `#5 ${r.keyTrust?.status}`],
    [r.signingKeyIdConsistency?.status === 'ok', `#6 ${r.signingKeyIdConsistency?.status}`],
    [typeof kid === 'string' && kid === pkg.signer?.identifier, `kid ${short(kid)} is not signer.identifier`],
    [r.rfc3161 === null && !r.hasTimestamp && !('rfc3161Timestamp' in b), '#7 a token is present'],
    [r.rekorInclusion === null && !r.hasRekor && !('rekorEntryId' in b), '#8 a Rekor entry is present'],
    [r.blobRefs.length === 0, '#9 BlobRef fields are present'],
    [r.lifecycle?.status === lifecycle.status && r.lifecycle?.source === 'attestation-chain', `#10 ${r.lifecycle?.status}, source ${r.lifecycle?.source}`],
    [r.lifecycle?.status === rec.status, `#10 reads ${r.lifecycle?.status}, docs/records.json says ${rec.status}`],
    [pkg.metadata.captureMethod === 'script-run', `#11 ${pkg.metadata.captureMethod}`],
    [r.typeResolution?.status === 'ok' && r.typeResolution?.type === 'content/analysis/v1', `#12 ${r.typeResolution?.status} ${r.typeResolution?.type}`],
    [r.nodeId === b.packageHash && b.packageHash === rec.packageHash, '#13 nodeId, packageHash and docs/records.json disagree'],
    [r.signerIdentity?.status === 'key_derived_match', `#14 ${r.signerIdentity?.status}`],
    [r.captureMethodVocab?.status === 'ok', `#15 ${r.captureMethodVocab?.status}`],
    [r.contentProfile?.status === 'contentProfile_absent', `#16 ${r.contentProfile?.status}`],
    [['producerProfile', 'type', 'contentCanonicalization', 'signer', 'contentHash'].every((k) => same(b[k], pkg[k])) && b.captureMethod === pkg.metadata.captureMethod,
      'the view differs from the package'],
    [b.trustRegistryUrl === served.trustRegistryUrl && same(b.trustRegistry, registry), 'the view does not name the host\'s registry or carry the served copy'],
  ].filter(([ok]) => !ok).map(([, what]) => what);
  statuses[r.lifecycle?.status] = (statuses[r.lifecycle?.status] ?? 0) + 1;
  if (rec.role === 'map-v1') versionOne += 1;
  else if (r.lifecycle?.status === 'active') current += 1;
  line(rec.file, fail.length === 0, `${String(r.lifecycle?.status).padEnd(9)}  ${rec.file}${fail.length ? `: ${fail.join('; ')}` : ''}`);
}

// Record files corpus/pin.mjs wrote that no served record carries yet.
const inDir = (dir, keep) => (fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => !f.startsWith('.') && keep(f)).map((f) => `${dir}/${f}`) : []);
const candidates = ['core.md', 'map.yaml', ...inDir('map', (f) => /^header(-[a-z0-9-]+)?\.yaml$/.test(f)), ...inDir('map/edges', () => true)];
const listed = new Set(served.records.map((r) => r.file));
const pending = candidates.filter((f) => fs.existsSync(path.join(ROOT, f)) && !listed.has(f));

console.log(`\nall records`);
line('records', true, `${served.records.length} served; ${current} current record${current === 1 ? '' : 's'}${versionOne ? ' and version 1' : ''}; #10 active ${statuses.active}, withdrawn ${statuses.withdrawn}`);
line('pending', true, `${pending.length} record file${pending.length === 1 ? '' : 's'} with no bundle yet`);
const oneKey = keys.every((k) => k.publicKey === signer.publicKey && k.identifier === signer.identifier);
line('one key', oneKey, `all ${keys.length} signatures carry one public key and one identifier, ${short(signer.identifier)}, the key package/signer.json names`);
const k = registry.keys?.[0];
const listsKey = !!validateRegistry(registry) && registry.keys.length === 1 && k.kid === signer.identifier && k.publicKey === signer.publicKey &&
  k.status === 'active' && same(k.signerIdentity, { bindingTier: signer.bindingTier, identifier: signer.identifier, displayName: signer.displayName });
line('registry', listsKey, `docs/.well-known/typed-publisher.json lists exactly that key, ${k?.status}; no registry is supplied offline, so #5 reads self_certified`);

console.log(`\nnetwork: global fetch calls ${globalCalls}; injected fetch calls ${injectedCalls}`);
if (globalCalls !== 0 || injectedCalls !== 0) failures.push('network');
console.log(failures.length === 0 ? 'result: all checks passed' : `result: FAILED (${failures.join(', ')})`);
process.exit(failures.length === 0 ? 0 : 1);
