// Tests for package/build.mjs and verify.mjs:  node --test package/build.test.mjs
//
// No network. A throwaway key, made in memory for this run (test/scratch.mjs), signs every record afresh
// on a scratch copy: version 1, then the batch. The owner's key is never read. Every red runs on a scratch
// copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT, addEdge, flipByte, read, readJson, run, scratch, sha256, signedBaseline, signedCopy, signedThroughVersion2, snapshot, throwawayKey, useKey } from '../test/scratch.mjs';

const BUILD = 'package/build.mjs';
const VERIFY = 'verify.mjs';
const h = (v) => sha256(JSON.stringify(v));
// Version 1's two records as committed at 4546ae2: the SHA-256 of each signed package and signature, as
// JSON, and the envelope hash; and the build log's entries for them.
const V1 = {
  core: {
    package: '55fc0cd070c4856fbb4d8c589837cec4879f5d64127d94bd4ee5af0f623c7861',
    packageHash: 'a9623ef408e4dc1b1f3833c3bf1dc5e4aff6dfd96139f088c0493975ce8f0a93',
    signature: '8888853fb02cd01c184f0267942d9d6fe02f44da60e710c9c1d8426a96d9b420',
    log: 'adfc1fb02978ad26a039f418d59e96c50cd124750532deaa8b3b750f3d3d77eb',
  },
  map: {
    package: 'f34ccd32b299a587ce29e86a04009df6cd44a0a672edf2b947cde268c1fa89b9',
    packageHash: '7f1c14cd34919dfe540f75c6de041133f17cfebd59e607596a8e610827cf2911',
    signature: '33b117aeae133ab235b8c3bd3cd68d0a7753a92143efe81c821d83c17859082d',
    log: 'ccdc439a636161551c108965d52f615e32878c523699cd39024198c0b7f0df02',
  },
};
const V1_LOG = { inputs: '09553db705f3d8d5d00b985096df2cc0db7895f2262296427ed3f39396242a94', versions: '14b04cfa8ca3904ff3c1557f1ea6db4b5335307f65159dec4a3f2365f5285d54' };

// ---------- the committed tree ----------

test('C4 both version-1 records keep the signed package, packageHash and signature they had at 4546ae2, served and in package/', () => {
  for (const [name, want] of Object.entries(V1)) {
    for (const f of [`package/${name}.bundle.json`, `docs/bundles/${name}.bundle.json`]) {
      const b = readJson(f);
      assert.deepEqual({ package: h(b.package), packageHash: b.packageHash, signature: h(b.signature) },
        { package: want.package, packageHash: want.packageHash, signature: want.signature }, f);
    }
  }
});

test('the build log keeps version 1\'s two entries and its shared inputs and versions as they were at 4546ae2', () => {
  const log = readJson('package/build-log.json');
  assert.equal(h(log.records.core), V1.core.log);
  assert.equal(h(log.records.map), V1.map.log);
  assert.equal(h(log.inputs), V1_LOG.inputs);
  assert.equal(h(log.versions), V1_LOG.versions);
});

test('check passes on the committed tree', () => {
  const r = run(BUILD, ['check'], ROOT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^records: \d+ in the build log .*each rebuilds from the digests the log recorded for it/m);
  assert.match(r.stdout, /^docs\/records\.json: equals a fresh derivation/m);
  assert.match(r.stdout, /^check: passed$/m);
});

test('C7 the registry lists exactly the signer\'s key, active since the first record signed, and every served view names it and carries it', () => {
  const signer = readJson('package/signer.json');
  const registry = readJson('docs/.well-known/typed-publisher.json');
  assert.equal(registry.keys.length, 1);
  const [k] = registry.keys;
  assert.equal(k.kid, signer.identifier);
  assert.equal(k.publicKey, signer.publicKey);
  assert.equal(k.status, 'active');
  assert.deepEqual(k.signerIdentity, { bindingTier: signer.bindingTier, identifier: signer.identifier, displayName: signer.displayName });
  const earliest = Object.values(readJson('package/build-log.json').records).map((r) => r.createdAt).reduce((a, b) => (b < a ? b : a));
  assert.equal(k.activatedAt, earliest);
  const served = readJson('docs/records.json');
  assert.equal(served.trustRegistryUrl, 'https://core-satellite.typedstandards.org/.well-known/typed-publisher.json');
  for (const r of served.records) {
    const b = readJson(`docs/${r.bundle}`);
    assert.equal(b.trustRegistryUrl, served.trustRegistryUrl, r.name);
    assert.deepEqual(b.trustRegistry, registry, r.name);
  }
});

test('C7 offline, #5 stays self_certified for every served record, and verify.mjs passes', () => {
  const r = run(VERIFY, [], ROOT);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /no registry is supplied offline, so #5 reads self_certified/);
  assert.match(r.stdout, /^network: global fetch calls 0; injected fetch calls 0$/m);
});

// ---------- a batch signed with a throwaway key ----------

test('C3/C5 the replay signs version 1, the 35 files of version 2, then the 15 later files after 15 withdrawals, and every record verifies offline under one key', () => {
  const { dir } = signedBaseline();
  const log = readJson('package/build-log.json', dir);
  const steps = Object.values(log.records).map((e) => e.step ?? 1);
  assert.equal(steps.filter((s) => s === 1).length, 2);
  assert.equal(steps.filter((s) => s === 2).length, 35);
  assert.equal(steps.filter((s) => s === 3).length, 15);
  assert.equal((log.withdrawals ?? []).length, 15);
  const r = run(VERIFY, [], dir);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /52 served; 36 current records and version 1; #10 active 37, withdrawn 15/);
  assert.match(r.stdout, /0 record files with no bundle yet/);
  assert.match(r.stdout, /all 52 signatures carry one public key and one identifier/);
  assert.match(r.stdout, /^network: global fetch calls 0; injected fetch calls 0$/m);
  for (const rec of readJson('docs/records.json', dir).records) {
    const b = readJson(`docs/${rec.bundle}`, dir);
    assert.equal(sha256(fs.readFileSync(path.join(dir, rec.file))), b.package.contentHash.sha256, rec.file);
  }
  const c = run(BUILD, ['check'], dir);
  assert.equal(c.status, 0, c.stdout + c.stderr);
});

test('C5 a second run signs nothing and writes nothing', (t) => {
  const dir = signedCopy(t);
  const before = snapshot(dir);
  const r = run(BUILD, ['sign'], dir, { env: signedBaseline().env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /signing check: the key reproduces all 67 committed signatures/);
  assert.match(r.stdout, /nothing to sign: every record file has a bundle, so nothing was written/);
  assert.deepEqual(snapshot(dir), before);
});

test('C5 the batch refuses to re-sign a signed file that changed, and writes nothing', (t) => {
  const dir = signedCopy(t);
  flipByte(path.join(dir, 'map', 'edges', 'qsv.yaml'), 'qsv');
  const before = snapshot(dir);
  const r = run(BUILD, ['sign'], dir, { env: signedBaseline().env });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /map\/edges\/qsv: map\/edges\/qsv\.yaml DIFFERS from its signed output; a correction is a withdrawal plus a new record/);
  assert.match(r.stderr, /nothing written/);
  assert.deepEqual(snapshot(dir), before);
});

test('C5 one key supply: a key that does not derive signer.json\'s identifier, or cannot reproduce the committed signatures, signs nothing', (t) => {
  const other = throwawayKey();
  const a = signedCopy(t);
  addEdge(a);
  assert.equal(run('corpus/pin.mjs', [], a).status, 0);
  const before = snapshot(a);
  const r1 = run(BUILD, ['sign'], a, { env: { SIGNING_SEED_B64: other.b64 } });
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /does not derive the identifier in package\/signer\.json/);
  assert.deepEqual(snapshot(a), before);
  useKey(a, other);
  const b = snapshot(a);
  const r2 = run(BUILD, ['sign'], a, { env: { SIGNING_SEED_B64: other.b64 } });
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /signing check FAILED/);
  assert.deepEqual(snapshot(a), b);
});

test('D3 a later addition is one more step: exactly one record is signed, and every earlier file and bundle is byte-identical', (t) => {
  const dir = signedCopy(t);
  const before = snapshot(dir);
  const { file } = addEdge(dir);
  assert.equal(run('corpus/pin.mjs', [], dir).status, 0);
  const r = run(BUILD, ['sign'], dir, { env: signedBaseline().env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /step 4: signed 1 record;/);
  const after = snapshot(dir);
  const bundles = (m) => [...m].filter(([f]) => f.endsWith('.bundle.json'));
  for (const [f, bytes] of bundles(before)) assert.ok(after.get(f).equals(bytes), f);
  for (const f of ['core.md', 'map.yaml', 'map/header.yaml', 'map/header-2.yaml', ...fs.readdirSync(path.join(dir, 'map', 'edges')).map((e) => `map/edges/${e}`).filter((e) => e !== file)]) {
    assert.ok(after.get(f).equals(before.get(f)), f);
  }
  const log = readJson('package/build-log.json', dir);
  assert.equal(log.records['map/edges/example-added'].step, 4);
  assert.equal(run(BUILD, ['check'], dir).status, 0);
  assert.equal(run('site/generate.mjs', [], dir).status, 0);
  const v = run(VERIFY, [], dir);
  assert.equal(v.status, 0, v.stdout);
  assert.match(v.stdout, /53 served; 37 current records and version 1/);
});

// ---------- withdrawal ----------

test('C6 a withdrawal reads withdrawn, records.json says so, and the policy lists it without drawing it', (t) => {
  const dir = signedCopy(t);
  const w = run(BUILD, ['withdraw', 'map/edges/w3c-prov-o', '--reason', 'A test withdrawal.'], dir, { env: signedBaseline().env });
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stdout, /map\/edges\/w3c-prov-o: withdrawn by attestation .*; verifyLifecycleChain reads withdrawn/);
  const rec = readJson('docs/records.json', dir).records.find((r) => r.name === 'map/edges/w3c-prov-o');
  assert.equal(rec.status, 'withdrawn');
  assert.equal(rec.withdrawn.reason, 'A test withdrawal.');
  const b = readJson(`docs/${rec.bundle}`, dir);
  assert.equal(b.lifecycleAttestations.length, 1);
  assert.equal(b.lifecycleAttestations[0].node.type, 'attestation/withdraws/v1');
  assert.equal(b.lifecycleAttestations[0].node.targetNodeId, b.packageHash);
  const v = run(VERIFY, [], dir);
  assert.equal(v.status, 0, v.stdout);
  assert.match(v.stdout, /^ {2}ok {4}withdrawn {2}map\/edges\/w3c-prov-o\.yaml$/m);
  assert.match(v.stdout, /52 served; 35 current records and version 1; #10 active 36, withdrawn 16/);
  assert.equal(run(BUILD, ['check'], dir).status, 0);
  const g = run('site/generate.mjs', [], dir);
  assert.equal(g.status, 0, g.stderr);
  const html = read('docs/index.html', dir);
  const svg = html.slice(html.indexOf('<svg class="map"'), html.indexOf('</svg>'));
  assert.doesNotMatch(svg, /<title>\d+\. W3C PROV-O /, 'a withdrawn edge is not drawn');
  const sectionOf = (id) => html.slice(html.indexOf(`<section id="${id}"`), html.indexOf('</section>', html.indexOf(`<section id="${id}"`)));
  const mechanics = sectionOf('mechanics');
  assert.match(mechanics, /<h3>Withdrawn \(16\)<\/h3>/);
  assert.match(mechanics, /<li>W3C PROV-O <small><code>map\/edges\/w3c-prov-o\.yaml<\/code><\/small>, withdrawn \d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2} ET \(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z\): A test withdrawal\. <a href="#record-map-edges-w3c-prov-o">Its row<\/a>\.<\/li>/);
  assert.match(sectionOf('records'), /<tr id="record-map-edges-w3c-prov-o"><td data-label="Record">W3C PROV-O<small>W3C<\/small>.*<td data-label="Shown as">withdrawn<\/td><td data-label="Check"><a href="https:\/\/typedstandards\.org\/verify\?url=https:\/\/core-satellite\.typedstandards\.org\/bundles\/map\/edges\/w3c-prov-o\.bundle\.json">verify<\/a><\/td><\/tr>/);
  assert.match(html, /35 current records and version 1, and 16 withdrawn/);
  const again = run(BUILD, ['withdraw', 'map/edges/w3c-prov-o', '--reason', 'Again.'], dir, { env: signedBaseline().env });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already withdrawn; nothing written/);
});

test('C6 records.json claiming active for a withdrawn record is red, in check and in verify.mjs', (t) => {
  const dir = signedCopy(t);
  assert.equal(run(BUILD, ['withdraw', 'map/edges/w3c-prov-o', '--reason', 'A test withdrawal.'], dir, { env: signedBaseline().env }).status, 0);
  const file = path.join(dir, 'docs', 'records.json');
  const served = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rec = served.records.find((r) => r.name === 'map/edges/w3c-prov-o');
  rec.status = 'active';
  delete rec.withdrawn;
  fs.writeFileSync(file, `${JSON.stringify(served, null, 2)}\n`);
  const c = run(BUILD, ['check'], dir);
  assert.equal(c.status, 1);
  assert.match(c.stdout, /docs\/records\.json DIFFERS from a fresh derivation/);
  const v = run(VERIFY, [], dir);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /map\/edges\/w3c-prov-o\.yaml: #10 reads withdrawn, docs\/records\.json says active/);
});

test('C6 a view that drops its carried withdrawal is red: the build log records it', (t) => {
  const dir = signedCopy(t);
  assert.equal(run(BUILD, ['withdraw', 'map/edges/w3c-prov-o', '--reason', 'A test withdrawal.'], dir, { env: signedBaseline().env }).status, 0);
  for (const f of ['package/map/edges/w3c-prov-o.bundle.json', 'docs/bundles/map/edges/w3c-prov-o.bundle.json']) {
    const b = readJson(f, dir);
    delete b.lifecycleAttestations;
    fs.writeFileSync(path.join(dir, f), `${JSON.stringify(b, null, 2)}\n`);
  }
  const c = run(BUILD, ['check'], dir);
  assert.equal(c.status, 1);
  assert.match(c.stdout, /withdrawal of map\/edges\/w3c-prov-o: the node rebuilt from the build log does not equal the one its view carries/);
});

test('C6 the replay withdraws exactly the records sources.json\'s replaces names, and each restatement is current', () => {
  const { dir, later } = signedBaseline();
  const records = readJson('docs/records.json', dir).records;
  assert.deepEqual(records.filter((r) => r.status === 'withdrawn').map((r) => r.name), later.withdrawn);
  for (const f of later.files) assert.equal(records.find((r) => r.file === f)?.status, 'active', f);
  assert.equal(later.withdrawn.length, 15);
  assert.ok(later.withdrawn.includes('map/header') && later.withdrawn.includes('map/edges/qsv'));
});

test('C6 sign refuses a restatement while the record it restates is current, and writes nothing', (t) => {
  const dir = scratch(t, signedThroughVersion2().dir);
  const { env } = signedThroughVersion2();
  const before = snapshot(dir);
  const r = run(BUILD, ['sign'], dir, { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /map\/header-2\.yaml restates map\/header, which is not withdrawn yet; run withdraw for it first\. Nothing written/);
  assert.deepEqual(snapshot(dir), before);
});

test('on the committed tree, no restatement is current beside the record it restates', () => {
  const sources = readJson('corpus/sources.json');
  const records = readJson('docs/records.json').records;
  const status = (file) => records.find((r) => r.file === file)?.status;
  const pairs = [...(sources.headers ?? []).map((h) => [h.file, h.replaces]),
    ...sources.edges.filter((e) => e.replaces).map((e) => [`map/edges/${e.key}.yaml`, `map/edges/${e.replaces}.yaml`])];
  assert.equal(pairs.length, 15);
  for (const [restatement, restated] of pairs) {
    if (status(restatement) === 'active') assert.equal(status(restated), 'withdrawn', `${restatement} is current, so ${restated} must be withdrawn`);
  }
});

// ---------- the host's other checks ----------

test('a served copy that differs from package/ by one byte is red', (t) => {
  const dir = scratch(t);
  flipByte(path.join(dir, 'docs', 'bundles', 'core.bundle.json'), 'core-record shape');
  const c = run(BUILD, ['check'], dir);
  assert.equal(c.status, 1);
  assert.match(c.stdout, /core: docs\/bundles\/core\.bundle\.json is missing or differs from package\/core\.bundle\.json/);
});

test('a registry that no longer lists the key as active is red, in check and in verify.mjs', (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'docs', '.well-known', 'typed-publisher.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"status": "active"', '"status": "revoked"'));
  assert.equal(run(BUILD, ['check'], dir).status, 1);
  const v = run(VERIFY, [], dir);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /FAIL {2}docs\/\.well-known\/typed-publisher\.json lists exactly that key, revoked/);
});

test('host rewrites only unsigned parts: on the committed tree it changes no byte', (t) => {
  const dir = scratch(t);
  const before = snapshot(dir);
  const r = run(BUILD, ['host'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(snapshot(dir), before);
});
