// Shared by the tests: scratch copies of this repository, and a throwaway signing key.
//
// Every red runs on a scratch copy in the system temp directory, never on a committed file. A throwaway key
// is made here, in memory, for one test run; it reaches a child process only as SIGNING_SEED_B64 and is
// never written to disk. A scratch copy's package/signer.json names the throwaway key's identifier and
// public key, which are not secret.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKeyDerivedIdentifierFromKey, derivePublicKeySpki } from '@typedstandards/produce-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COPIED = ['package.json', 'README.md', 'core.md', 'map.yaml', 'map', 'corpus', 'package', 'docs', 'site', 'verify.mjs'];

export const read = (f, root = ROOT) => fs.readFileSync(path.join(root, f), 'utf8');
export const readJson = (f, root = ROOT) => JSON.parse(read(f, root));
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// A copy of the repository's files (no .git, data/ or node_modules; node_modules is linked).
export function scratch(t, from = ROOT) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'core-sat-test-')));
  if (t) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of COPIED) {
    if (fs.existsSync(path.join(from, f))) fs.cpSync(path.join(from, f), path.join(dir, f), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}

// Runs one of the repository's programs, from the scratch copy, against the scratch copy.
export function run(script, args, root, { env = {}, stdout = 'pipe' } = {}) {
  return spawnSync(process.execPath, [path.join(root, script), ...args, '--root', root], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: root, ...env },
    stdio: ['ignore', stdout, 'pipe'],
  });
}

export function throwawayKey() {
  const seed = crypto.randomBytes(32);
  const raw = new Uint8Array(seed);
  return { b64: seed.toString('base64'), identifier: deriveKeyDerivedIdentifierFromKey(raw), publicKey: derivePublicKeySpki(raw) };
}

// Point a scratch copy's signer.json, and the signer its host policy displays, at a throwaway key.
export function useKey(dir, key) {
  const signer = readJson('package/signer.json', dir);
  fs.writeFileSync(path.join(dir, 'package', 'signer.json'), `${JSON.stringify({ ...signer, identifier: key.identifier, publicKey: key.publicKey }, null, 2)}\n`);
  const policy = path.join(dir, 'docs', 'host-policy.yaml');
  fs.writeFileSync(policy, fs.readFileSync(policy, 'utf8').replace(/^signer: .*$/m, `signer: ${key.identifier}`));
}

// A scratch copy with every record signed afresh by a throwaway key: version 1 (core.md, map.yaml) and
// then the batch, as the owner's two signing steps did, with docs/records.json and the page regenerated.
// Built once per test file; each test copies it.
let baseline;
export function signedBaseline() {
  if (baseline) return baseline;
  const dir = scratch(null);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const key = throwawayKey();
  useKey(dir, key);
  for (const p of ['package/build-log.json', 'package/map', 'docs/bundles', 'docs/records.json', 'docs/.well-known/typed-publisher.json']) {
    fs.rmSync(path.join(dir, p), { recursive: true, force: true });
  }
  for (const f of fs.readdirSync(path.join(dir, 'package')).filter((x) => x.endsWith('.bundle.json'))) fs.rmSync(path.join(dir, 'package', f));
  const env = { SIGNING_SEED_B64: key.b64 };
  for (const step of [1, 2]) {
    const r = run('package/build.mjs', ['sign'], dir, { env });
    assert.equal(r.status, 0, `step ${step}: ${r.stderr}`);
  }
  const g = run('site/generate.mjs', [], dir);
  assert.equal(g.status, 0, g.stderr);
  baseline = { dir, key, env };
  return baseline;
}

// A throwaway copy of the signed baseline.
export function signedCopy(t) {
  return scratch(t, signedBaseline().dir);
}

// Every file under a directory, as a map of relative path to bytes.
export function snapshot(dir, sub = '.') {
  const out = new Map();
  const walk = (d) => {
    for (const f of fs.readdirSync(path.join(dir, d))) {
      const p = path.join(d, f);
      if (f === 'node_modules') continue;
      if (fs.statSync(path.join(dir, p)).isDirectory()) walk(p);
      else out.set(p, fs.readFileSync(path.join(dir, p)));
    }
  };
  walk(sub);
  return out;
}

// Changes one byte: the ASCII case of the first letter of `needle`, at its first occurrence.
export function flipByte(file, needle) {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf(needle);
  assert.ok(at >= 0, `"${needle}" not found in ${file}`);
  buf[at] ^= 0x20;
  fs.writeFileSync(file, buf);
}

// Appends one source, one node and one edge, as a later addition would: the manifest only grows, and
// neither an existing entry nor pinnedAt changes.
export function addEdge(dir, key = 'example-added', fetchedAt = '2026-10-01T12:00:00Z') {
  const sourcesFile = path.join(dir, 'corpus', 'sources.json');
  const manifestFile = path.join(dir, 'corpus', 'manifest.json');
  const sources = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const location = `https://example.org/${key}/v1.json`;
  sources.sources.push({ key, location, kind: 'test-fixture', pinBasis: 'a test fixture', licence: 'not stated', licenceSource: location });
  sources.nodes[`example.org/${key}`] = { source: key };
  sources.edges.push({ key, ring: 3, name: `Example ${key}`, publisher: 'Example', subject: sources.subject, object: `example.org/${key}`, relation: 'adjacent', basis: 'A test edge.', curation: { seed: 'added', reason: 'a test' } });
  manifest.sources.push({ key, location, kind: 'test-fixture', pinBasis: 'a test fixture', httpStatus: 200, bytes: 10, sha256: sha256(key), contentType: 'application/json', fetchedAt, licence: 'not stated', licenceSource: location });
  fs.writeFileSync(sourcesFile, `${JSON.stringify(sources, null, 2)}\n`);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { key, file: `map/edges/${key}.yaml` };
}
