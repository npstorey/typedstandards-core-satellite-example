// Tests for corpus/pin.mjs, the writer:  node --test corpus/pin.test.mjs
//
// No network: the manifest exists, so the writer fetches nothing. Every run is on a scratch copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';
import { ROOT, addEdge, read, readJson, run, scratch, sha256, snapshot } from '../test/scratch.mjs';

const PIN = 'corpus/pin.mjs';
// The SHA-256 of the two files version 1's records signed, as committed at 4546ae2.
const V1_FILES = {
  'core.md': 'c85c650af7c47608a27cff4f6760d3313d62ff18095e8f4f0fdb947df6aece3b',
  'map.yaml': '38945eb4cb3ac6528f77647e082778fa8d0ebc9afb66c8cc25508127ba8d155c',
};
const written = (dir) => new Map([...snapshot(dir)].filter(([f]) => ['core.md', 'map.yaml'].includes(f) || f.startsWith('map/')));

test('determinism: a rerun of the writer rewrites core.md and map/ byte for byte, and leaves map.yaml', (t) => {
  const dir = scratch(t);
  const before = written(dir);
  const r = run(PIN, [], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /corpus\/manifest\.json exists; not fetching/);
  assert.match(r.stdout, /map\.yaml, version 1's map: not rewritten, and the current inputs write it byte for byte/);
  assert.deepEqual([...written(dir).keys()], [...before.keys()]);
  for (const [f, bytes] of before) assert.ok(written(dir).get(f).equals(bytes), f);
});

test('C2 core.md and map.yaml are the bytes version 1 signed', () => {
  for (const [f, digest] of Object.entries(V1_FILES)) assert.equal(sha256(fs.readFileSync(path.join(ROOT, f))), digest, f);
});

test('C2 each first-header edge file parses to the same value as its document in map.yaml, and the ids are the same set', () => {
  const [header, ...docs] = YAML.parseAllDocuments(read('map.yaml')).map((d) => d.toJS());
  const files = readJson('corpus/sources.json').edges.filter((e) => !e.header).map((e) => `${e.key}.yaml`);
  assert.equal(files.length, docs.length);
  assert.deepEqual(new Set(files.map((f) => YAML.parse(read(`map/edges/${f}`)).id)), new Set(docs.map((d) => d.id)));
  for (const d of docs) {
    const key = d.id.split('/map/')[1];
    assert.ok(isDeepStrictEqual(YAML.parse(read(`map/edges/${key}.yaml`)), d), key);
  }
  const without = structuredClone(header);
  delete without['x-typedstandards'].writtenFrom.manifestSha256;
  assert.ok(isDeepStrictEqual(YAML.parse(read('map/header.yaml')), without), 'the header is map.yaml\'s minus manifestSha256 (G0 D1)');
});

test('D2 the writer never overwrites map.yaml', (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'map.yaml');
  fs.appendFileSync(file, '# a changed byte\n');
  const changed = fs.readFileSync(file);
  const r = run(PIN, [], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /map\.yaml, version 1's map: not rewritten, and it differs from what the current inputs write/);
  assert.ok(fs.readFileSync(file).equals(changed));
});

test('D3 an added edge writes one new file and leaves every existing file byte-identical, core.md and both headers included', (t) => {
  const dir = scratch(t);
  const before = written(dir);
  const { file } = addEdge(dir);
  const r = run(PIN, [], dir);
  assert.equal(r.status, 0, r.stderr);
  // map.yaml's header names the manifest's SHA-256, and an addition grows the manifest.
  assert.match(r.stdout, /map\.yaml, version 1's map: not rewritten, and it differs/);
  const after = written(dir);
  assert.deepEqual([...after.keys()].filter((f) => !before.has(f)), [file]);
  for (const [f, bytes] of before) assert.ok(after.get(f).equals(bytes), f);
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  assert.ok(text.startsWith('# One edge of the map whose header is map/header-2.yaml.'), 'the added edge names the newest header');
  const edge = YAML.parse(text);
  assert.equal(edge.createdAt, '2026-10-01', 'the added edge carries its own fetch date');
  assert.equal(edge.object.ref.sha256, sha256('example-added'));
});

test('the second header differs from the first only in its comment, its relations and ring 3, and drops every forward-looking phrase', () => {
  const first = YAML.parse(read('map/header.yaml'))['x-typedstandards'];
  const second = YAML.parse(read('map/header-2.yaml'))['x-typedstandards'];
  const { relations: r1, rings: g1, ...rest1 } = first;
  const { relations: r2, rings: g2, ...rest2 } = second;
  assert.deepEqual(rest2, rest1);
  assert.deepEqual(Object.keys(r2), ['builds-on', 'complements', 'writes-recordable-output', 'adjacent']);
  assert.equal(r2['builds-on'], r1['builds-on']);
  assert.equal(r2.complements, r1.complements);
  assert.equal(r2.adjacent, 'A related problem space. Neither depends on the other.');
  assert.deepEqual([g2[1], g2[2]], [g1[1], g1[2]]);
  assert.equal(g2[3], 'Implementations, tools and agent runtimes.');
  assert.doesNotMatch(read('map/header-2.yaml'), /could-emit|intent|emitter/i);
});

test('each restated edge keeps the ends of the edge it replaces, and belongs to the second header', () => {
  const edges = readJson('corpus/sources.json').edges;
  const restated = edges.filter((e) => e.replaces);
  assert.equal(restated.length, 14);
  for (const e of restated) {
    const was = edges.find((x) => x.key === e.replaces);
    assert.deepEqual([e.subject, e.object], [was.subject, was.object], e.key);
    assert.equal(e.header, 'map/header-2.yaml', e.key);
    const a = YAML.parse(read(`map/edges/${e.key}.yaml`));
    const b = YAML.parse(read(`map/edges/${was.key}.yaml`));
    assert.deepEqual([a.subject, a.object, a.createdAt], [b.subject, b.object, b.createdAt], e.key);
    assert.ok(read(`map/edges/${e.key}.yaml`).startsWith('# One edge of the map whose header is map/header-2.yaml.'), e.key);
  }
});

test('the writer stops on an edge whose header does not define its relation, and on a stray header file', (t) => {
  const a = scratch(t);
  const file = path.join(a, 'corpus', 'sources.json');
  const sources = JSON.parse(fs.readFileSync(file, 'utf8'));
  sources.edges.find((e) => e.key === 'qsv-2').relation = 'could-emit';
  fs.writeFileSync(file, `${JSON.stringify(sources, null, 2)}\n`);
  const r = run(PIN, [], a);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /edge qsv-2: map\/header-2\.yaml does not define the relation could-emit/);
  const b = scratch(t);
  fs.writeFileSync(path.join(b, 'map', 'header-3.yaml'), 'x: 1\n');
  const s = run(PIN, [], b);
  assert.equal(s.status, 1);
  assert.match(s.stderr, /map\/ holds header-3\.yaml, which corpus\/sources\.json does not list as a header/);
});

test('the writer stops on a file in map/edges/ that names no edge', (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, 'map', 'edges', 'stray.yaml'), 'id: stray\n');
  const r = run(PIN, [], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /map\/edges\/ holds stray\.yaml, which corpus\/sources\.json does not list as an edge/);
});

test('the manifest the writer reads is the committed one, and its pinnedAt is version 1\'s', () => {
  assert.equal(readJson('corpus/manifest.json').pinnedAt, '2026-09-22T19:20:31Z');
});
