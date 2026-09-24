# typedstandards-core-satellite-example

This repository applies the "core and satellite" model from SciOS's paper *The Core-Satellite Model*
(scios.tech/thoughts, dated 2026-06-30) to the domain [Typed Standards](https://typedstandards.org) works
in. Its published files are signed as Typed Standards records that verify offline. The host
https://core-satellite.typedstandards.org/ serves every record and shows the map and the records as a
picture and tables.

- **`core.md`** puts Typed Standards in the core-record front-matter shape the paper's examples use,
  filled from public sources. It assesses the project as a satellite, omits `type: core`, and marks
  each core responsibility the project does not hold NOT DONE.
- **The map** gives Typed Standards' technical relations to 34 public projects in three rings. It has no
  `orbits` edge (see [Relations and the published schema](#relations-and-the-published-schema)). It is
  written in two forms from the same inputs:
  - `map.yaml`, the whole map in one file, which version 1 signed as one record;
  - a header and one file per edge in `map/edges/`, each for a record of its own, so that a project can be
    added without re-signing the others. The current header is `map/header-2.yaml`; the first,
    `map/header.yaml`, is withdrawn.
- **The records.** Each signed file is the inline output of one record under `raw-bytes/v1`, so
  `shasum -a 256 core.md` prints the record's `contentHash.sha256`. `docs/records.json` lists the records
  the host serves: 36 current records and version 1, and 15 withdrawn. After `npm ci`, one command checks
  every one of them with no network access: `node verify.mjs`.

The example follows `typedstandards-eval-run-example` (hub ADR-0028). It pins the published releases
`@typedstandards/produce-core` 0.6.0 and `@typedstandards/verify-core` 0.11.0 exactly. They carry
`raw-bytes/v1` (hub ADR-0029), the self-certifying `did:key` signer (hub ADR-0030) and check #6
(typedstandards#88). The two version-1 records were built with 0.5.0 and 0.10.0 (`package/build-log.json`).

## How Typed Standards was used here

**What was produced.** Signed records, one per published file. Version 1 has two: `package/core.bundle.json`
for `core.md`, and `package/map.bundle.json` for `map.yaml`. Version 2 is the map again, one record per
file: its header, `map/header.yaml`, and each edge, `map/edges/<key>.yaml`. Version 3 is a second header,
`map/header-2.yaml`, and 14 edges that restate withdrawn ones. Each record carries:

- the file's exact bytes and their SHA-256, a 64-character fingerprint that changes if any byte changes;
- the sources the file cites, each with its location, SHA-256, size, HTTP status, fetch time and licence,
  from the 40 recorded in `corpus/manifest.json`. An edge's record cites the specification and the project
  at the edge's other end;
- the two programs that made the file, each named by the SHA-256 of its code;
- two labels. The profile says a script wrote the file and can write it again. The capture method says
  the packaging program read the finished file rather than watching the writer run. Nothing verifies
  that label (`docs/verify-output.txt`, the line for #11);
- the signer: a key that names itself, with no account or person behind it.

**How it was made.**

1. `corpus/pin.mjs` fetched each source once and pinned it: it recorded the SHA-256 of what the location
   served. Then it wrote `core.md`, `map.yaml` and the files in `map/` from the list in
   `corpus/sources.json` and those pins.
2. `package/build.mjs` read the finished files, then packaged and signed each one. It signs in steps: each
   step signs every file that has no record yet, with one supply of the key. It never re-signs a record.

The key was generated for this example, outside the repository. It is now held in the publisher's
1Password vault, and signing runs only in the publisher's own terminal.

**Where the records are served.** GitHub Pages serves `docs/` at https://core-satellite.typedstandards.org/:

- each record's bundle at `bundles/<name>.bundle.json`, a byte-for-byte copy of
  `package/<name>.bundle.json`. The page links each record to typedstandards.org's verifier;
- `records.json`, the records served and each one's status, and `host-policy.yaml`, the host's own rule for
  what the page shows. Neither is signed;
- `.well-known/typed-publisher.json`, a registry that lists the key as active. It is the example
  publisher's own statement, not an endorsement by the Typed Standards specification or by
  typedstandards.org, although this host is a subdomain of typedstandards.org.

Each record's view names that registry as `trustRegistryUrl` and carries a copy of it. The view is not the
part the key signed, so adding both re-signed nothing.

**What you can check.** After cloning the repository, in a terminal:

- Every served record verifies offline: `npm ci && node verify.mjs`. The output should match
  `docs/verify-output.txt`, which ends `network: global fetch calls 0; injected fetch calls 0` and
  `result: all checks passed`.
- Each file is byte for byte what was signed: `shasum -a 256 core.md map.yaml` prints the SHA-256 that
  each record states for its file, as `contentHash.sha256`.
- Any pinned source can be fetched again and compared: `node corpus/pin.mjs --force` in a scratch clone,
  then `git diff corpus/manifest.json`.
- The files can be written again from the pins, offline: `node corpus/pin.mjs`, then
  `git diff --exit-code core.md map.yaml map/`.
- The web page, `docs/index.html`, comes only from signed bytes: `npm run check:page` regenerates it and
  compares, and the generator refuses a signed file whose SHA-256 differs from its record.

**What it does not establish.** The table below marks four things as not covered: who holds the key, when
the records existed, inclusion in a public transparency log, and whether any statement in any file is
correct. It marks revocation of the key as online only, and four more things as asserted: signed, but
resting on the signer's word.

**Why it was useful.**

- The checks run offline on your own copy. They show that the files are what this key signed, whichever
  server delivered them, but not who holds the key.
- The source pins and the labels are inside the signed bytes, so changing any of them breaks check #1,
  which recomputes the hash of the whole signed record.
- A signed git commit also fixes bytes. A record is also self-contained, verifies offline against the
  specification's numbered checks, and carries its source pins and labels inside its signed bytes.
- With one record per edge, adding a project signs one new record and leaves every other record as it is.
  The tests show it with a throwaway key (`package/build.test.mjs`).
- A correction is a withdrawal plus a new record. Version 3 read every edge again against its pinned
  source. It withdrew the 14 edges whose text said more than those bytes show, and the first header,
  which defined `could-emit`, and signed a restatement of each. The withdrawn
  records still verify, and each carries its reason.
- Building this example ran into three gaps in the specification and its reference packages
  (`docs/findings.md`): two filed before (typedstandards#91, #88) and one found here (typedstandards#96,
  hub#230). All four issues are closed. The releases pinned now carry the three package fixes (their
  `CHANGELOG.md` files), and specification v0.1.10 lists `attestation/revises/v1` in all five places it
  states the sub-type table.

**Terms used below.**

- **ref:** a location, with the SHA-256 of what that location served.
- **front matter:** the YAML block between the two `---` lines at the top of `core.md`.
- **inline output:** the file's bytes, carried inside the record. `raw-bytes/v1` is the rule that they are
  carried exactly as they are.
- **envelope:** the whole signed record. The key signs its hash.
- **view:** the unsigned part of a bundle, around the signed envelope. A verifier reads it first.
- **did:key:** an identifier made from the public key itself, so no registry is needed.
- **registry:** a file that lists a publisher's keys and whether each is active.
- **withdrawal:** a separately signed statement that a record is withdrawn. The record still verifies.
- **Ed25519ph:** the signature algorithm.

## What the records prove / what they do not

This section describes the offline output of verify-core as `node verify.mjs` prints it
(`docs/verify-output.txt`).

**Attested:** checkable by anyone from the served bundles. The row names the check that establishes it.
**Asserted:** stated inside the signed bytes, but resting on the signer's word. No check establishes it.
**Online only:** a verifier reads it only from the host's registry, over the network.
**Not covered:** nothing in this repository addresses it.

| Property | Status | Why |
|---|---|---|
| The bytes of each signed file | Attested (#3, #4, #1) | Each record carries its file's exact UTF-8 bytes inline, under `raw-bytes/v1` (#3 `ok`). #4 recomputes `contentHash.sha256` from those bytes (`ok`), and #1 recomputes the envelope hash (`verified`). The digest is the file's ordinary SHA-256, so `shasum -a 256` checks it without any Typed Standards code, and `verify.mjs` compares each file on disk with its signed output byte for byte. |
| The signature over each record | Attested (#2) | Ed25519ph over the envelope-hash hex string. Valid for every served record. |
| One key signed every record | Attested (#14, #2) | #14 reports `key_derived_match` for each record: the `did:key` identifier is derived from the public key in that record's signature. `verify.mjs` then confirms that every signature carries the same key and identifier, the ones `package/signer.json` names. |
| The key names itself consistently | Attested (#6) | #6 reports `ok`: `signature.kid` equals `metadata.signingKeyId`. #6 does not compare `signer.identifier`, so `verify.mjs` also confirms that it is the same string, as hub ADR-0030 §5 says it should be. |
| Whether a record is withdrawn | Attested (#10), for what the view carries | `verify.mjs` resolves the withdrawals each view carries with verify-core's `verifyLifecycleChain`, which checks each one's signature and signer, and passes the result to #10. A withdrawal is carried in the unsigned view, so a host could leave one out, and the record's own signature cannot show that it was not withdrawn. `docs/records.json` gives each record's status. |
| Who holds the key | Not covered | Offline, #5 reports `self_certified` with `verified: false`: no registry is supplied. The host's registry lists the key as active, online; that shows which host publishes the statement, not who holds the key. `displayName` names the example, not a person. |
| Capture method and producer profile | Asserted | #15 reports `ok`: `script-run` is a value the `scripted-recomputation` profile allows. No check establishes that one program wrote the files and a second one packaged them. The label is signed, so it cannot be changed without breaking #1. |
| The source digests | Asserted | `corpus/manifest.json` pins 40 sources. Each record lists the ones its file cites in `queries[].arguments`: location, SHA-256, bytes, HTTP status, fetch time and stated licence. These are signed assertions that no check recomputes. Every location is immutable, so anyone can re-fetch it and compare. An accidental second fetch, 38 seconds after the pin, got identical digests for all 40 (`docs/pin-record.md`). |
| The signed files follow from the manifest | Asserted | `node corpus/pin.mjs` rewrites `core.md` and every file in `map/` from `corpus/sources.json` and `corpus/manifest.json` without the network, and `git diff --exit-code` shows the same bytes. It never overwrites `map.yaml`, version 1's file; it reports whether the current inputs still write it byte for byte. That reproduces the writer, but it is not a §9.2 check. |
| The relations, the bases and the self-assessment | Asserted | They are the signer's reading of each project's own public text. No check evaluates them, and the published schema has no edge type for any of these relations. Version 3 read each edge's basis again against its pinned bytes and restated the 14 that said more. |
| Revocation of the key | Online only | A `did:key` has no rotation and no revocation (hub ADR-0030 §7). The host's registry could list the key as revoked, and a verifier that fetches it from the URL each view names would then report #5 `revoked` (verify-core, `self-certifying.ts`). Offline, `verify.mjs` supplies no registry, so nothing here reads it. |
| When the records existed | Not covered | Check #7 reads n/a because no RFC 3161 token was requested. External proofs are left out of this version (gate G1, D7), and `metadata.createdAt` is the signer's own claim. |
| Inclusion in a public transparency log | Not covered | Check #8 reads n/a because no Rekor entry was submitted. A Rekor entry is public and permanent, and a record re-signed after a gate would leave an abandoned hash in the log under this key. |
| That any statement in any file is correct | Not covered | A signature shows the bytes are unchanged since signing, not that they are true (spec §5.3). |

## What the key proves

Every record verifies under one key, and its identifier is derived from that key. Anything else signed
under this identifier was signed by the same key. The key says nothing about who holds it. The host's
registry, `docs/.well-known/typed-publisher.json`, lists it as active since `2026-09-22T19:25:30.535Z`, the
`createdAt` of the first record signed under it. That is the example publisher's own statement, read online
only, and `displayName` ("typedstandards-core-satellite-example (self-certifying example key)") names this
example, not a person.

The publisher keeps the signing key, so that later records can be signed by the same key. A `did:key`
cannot be rotated (hub ADR-0030 §7), so keeping the key is the only way to continue under this identifier.
If the key were compromised, the registry could list it as revoked, which a verifier reads online only, and
the example would continue under a new identifier with no link to this one. The key was generated for this
example only. It is held in the publisher's 1Password vault, outside the repository, and has never been
printed.

Signing runs only in the publisher's own terminal:

    cp .env.sign.example .env.sign
    op run --env-file=.env.sign -- node package/build.mjs sign

- **How the key reaches the program.** `op run` passes the key to that one process as `SIGNING_SEED_B64`.
  No session that builds or checks this repository can read it.
- **What `.env.sign.example` holds.** An `op://` reference, never a value. The vault name contains spaces,
  so a shell command that uses the reference directly must quote it.
- **What `sign` does.** It first re-signs every committed envelope hash, and every carried withdrawal, with
  the supplied key and confirms that each result equals the committed signature. Ed25519 signatures are
  deterministic, so only the signing key reproduces them. Then it signs every record file that has no bundle
  yet, as one step, and verifies each one offline before it writes anything. With none left, it writes
  nothing. If a signed file has changed, it refuses and writes nothing: a correction is a withdrawal plus a
  new record. It also refuses, and writes nothing, while a file that restates a record (`replaces` in
  `corpus/sources.json`) would be signed before that record is withdrawn.
- **How a record is withdrawn.** `op run --env-file=.env.sign -- node package/build.mjs withdraw <name>
  --reason "<text>"` signs an `attestation/withdraws/v1` for the named record with the same key and carries
  it in that record's view. The record still verifies, and #10 reads it as withdrawn.

## What the SciOS schema would still need from the standard

- **Endorsements.** The paper lets any participant endorse a core or withdraw an endorsement, "append-only
  and attributable". In Typed Standards terms, each endorsement is a separately signed attestation that
  targets the core record's `nodeId`: `attestation/endorses/v1` for an authority-bearing party, or
  `attestation/corroborates/v1` for any participant. A withdrawal is a further signed node; the
  endorsement it withdraws stays in place. No endorsement is built here; `package/build.mjs` builds only
  the publisher's own withdrawals.
- **Rules a verifier enforces.** The specification ratifies the v0.1 attestation sub-type table (§8.12.1),
  and check #12 recognizes `endorses` and `corroborates`. But nothing operationalizes it (§8.12.4): no
  check enforces a sub-type's authorization rule or its payload. The specification states the table in
  five places. At v0.1.9, the revision this example pins, two of them omitted `attestation/revises/v1`
  (hub#230), and verify-core 0.10.0 followed the shorter list (typedstandards#96). Specification v0.1.10
  lists it in all five, and verify-core 0.11.0 registers it (its `CHANGELOG.md`).
- **A hash check for each ref.** The paper's examples write a ref as `ref: <location + content-hash>` in
  some places and `ref: <content-hash>` in others, and its agent example pulls reference data "by its
  content hash, not by a URL". Every ref here gives both a location and a SHA-256. `raw-bytes/v1`
  fingerprints one file per record, so here only the signed files themselves are recomputed by a check.
  The 40 source digests they cite are signed assertions. A rule over a set of files is not specified (hub
  ADR-0029 §4).
- **A host's display rule.** What a host shows of the records it serves is its own choice here, written in
  `docs/host-policy.yaml` and not signed. verify-core 0.11.0 resolves no record type for such a rule
  (`KNOWN_TYPE_URIS`).
- **Maturity is the reader's call.** The paper leaves maturity to "competing algorithms" run by observers.
  The specification's preamble forbids platform-issued verdicts (§5.1), so the two agree that the record
  surfaces signals and the reader judges.

## Relations and the published schema

- **Edge types.** The paper's published examples show one edge type, `orbits`, from a satellite to a core.
  This map has none: no core record exists in this domain to be the object of one, and the paper says a
  core is never a satellite. Each edge names its relation in `x-typedstandards.relation` (`builds-on`,
  `complements`, `writes-recordable-output` or `adjacent`, defined in the map's header,
  `map/header-2.yaml`), because the published schema has no edge type for any of them.
  - A relation states only what the other project's pinned bytes show. `writes-recordable-output` says
    that a project's own documentation shows a program writing text files from its inputs, the kind of
    content the scripted-recomputation profile records. qsv's edge uses it, citing its README at tag 23.0.1.
  - The first header, `map/header.yaml`, also defined `could-emit`, for a project whose public text states
    an intent to produce Typed Standards records. Its one edge, qsv's, rested on an issue thread that is not
    pinned. Both records are withdrawn, and version 1's `map.yaml` keeps `could-emit` as it was signed.
  - Humane Intelligence's red-teaming app keeps reviewable evaluation records. Its public text states no
    intent to produce signed records, so the map asserts no evaluator relation for it.
- **Field names.** Outside `x-typedstandards`, the files use only field names the published examples show.
  The paper's schema v0.1 is not published (scios.tech/thoughts, read 2026-09-22).
- **`type` is omitted.** The paper treats surfacing a core record as declaring oneself a core, and this
  record's self-assessment is "satellite" (gate G1, D2).
- **The shape of `ref`.** The paper's examples write `ref: <location + content-hash>` in some places and
  `ref: <content-hash>` in others, without showing the shape inside. This example writes
  `ref: { location, sha256 }`: the two sub-keys are its own choice (gate G1, D4).
- **What counts as a ref.** A ref is one of four things: a file at a 40-character commit SHA, a dated W3C
  TR URL, an rfc-editor.org text URL, or a published npm release tarball. A landing page or a rendered
  view is not a ref, because it can change between fetches. The Mila and Mozilla initiative has only
  announcement pages, so its ref carries the location, `sha256: null` and the reason.

## Reproduction

Node 22 and npm. curl for re-fetching the sources.

    git clone https://github.com/npstorey/typedstandards-core-satellite-example
    cd typedstandards-core-satellite-example
    npm ci                  # the pinned packages, from the lockfile
    node verify.mjs         # offline; exits 0 when every check passes

Every line should match `docs/verify-output.txt`. Further checks:

1. **The file digests, with standard tools.** Run `shasum -a 256` on a file `docs/records.json` lists and
   compare with `contentHash.sha256` in its bundle in `docs/bundles/`.
2. **The writer.** Run `node corpus/pin.mjs`, then `git diff --exit-code core.md map.yaml map/`.
   - The manifest exists, so nothing is fetched. `core.md` and every file in `map/` come back byte for
     byte, both headers included.
   - `map.yaml` is version 1's file. The program never overwrites it, and says whether the current inputs
     still write it byte for byte from the first header and the edges that name no later header. They do
     while the manifest is version 1's: `map.yaml`'s header names the manifest's SHA-256, so a later source
     would change it.
3. **The envelopes.** Run `node package/build.mjs check`.
   - It rebuilds every record, unsigned, from the digests of the programs and inputs the build log recorded
     for it, and compares each with its bundle. It reports separately whether those files on disk still
     match.
   - It checks the served copies, each view, the registry and `docs/records.json`, and lists any record
     file that has no bundle yet.
4. **The sources.** In a scratch clone, run `node corpus/pin.mjs --force`, then
   `git diff corpus/manifest.json`.
   - This re-fetches all 40 sources. At immutable locations, only `fetchedAt` and `pinnedAt` should
     change.
   - `node corpus/pin.mjs --verify` re-hashes the local bytes in `data/` against the manifest.
5. **The tests.** `npm test`, with no network. A throwaway key made for the run signs a scratch copy; the
   publisher's key is never read.

## Layout

- **`core.md`, `map.yaml`, `map/`:** the published files. `core.md` and `map.yaml` are version 1's records;
  `map/header.yaml`, `map/header-2.yaml` and `map/edges/<key>.yaml` are one record each.
- **`corpus/`:**
  - `sources.json`: the curated sources, nodes, headers and edges. An edge that restates an earlier one
    names it in `replaces`, and names its header.
  - `core.template.md`: the prose of `core.md`.
  - `pin.mjs`: program 1, which fetches once and writes the published files.
  - `manifest.json`: written once by `pin.mjs`, and only ever appended to.
- **`package/`:**
  - `build.mjs`: program 2, which packages and signs, withdraws, and writes what the host serves. The key
    comes from `SIGNING_SEED_B64`.
  - `signer.json`: the identifier and public key.
  - `<name>.bundle.json`: one per record, each a commitment view with its package inline.
  - `build-log.json`: the build log.
- **`verify.mjs`:** the one-command check.
- **`site/generate.mjs`:** writes `docs/index.html` from the signed files `docs/records.json` lists,
  `README.md`, `docs/records.json` and `docs/host-policy.yaml`.
  - It refuses unless each signed file matches `contentHash.sha256` in its record's served bundle.
  - `npm run check:page` compares the committed page with a fresh generation, byte for byte.
  - Its one YAML parser, `yaml`, is a devDependency pinned exactly.
- **`test/`, `*.test.mjs`:** the tests, `npm test`.
- **`.github/workflows/check.yml`:** on every push and pull request, `npm ci`, then the writer rerun with
  `git diff --exit-code`, `node verify.mjs` compared with `docs/verify-output.txt`,
  `node package/build.mjs check`, `npm run check:page` and `npm test`.
- **`.env.sign.example`:** the `op://` reference to the signing key, for `op run`.
- **`docs/`:** what GitHub Pages serves at https://core-satellite.typedstandards.org/, byte for byte, with
  no Jekyll build (`CNAME`, `.nojekyll`).
  - `index.html`: the map and the records as a picture and tables. It is generated and committed, and
    it is a view of the signed files, not a record.
  - `bundles/`, `records.json`, `host-policy.yaml`, `.well-known/typed-publisher.json`: the served records,
    their list, the host's display rule and the registry.
  - The verify output, the pin record, the G1 rulings and the findings.

`data/` is git-ignored: the fetched third-party bytes are pinned by hash, never committed.

## Data, licences and citation

- **Code:** MIT (`LICENSE`).
- **Text:** CC BY 4.0 (`LICENSE-CC-BY-4.0.txt`).
- **Third-party documents:** each source keeps the licence it states, recorded per source in
  `corpus/manifest.json`. Two state none: okfn/mcp-server and the Mila and Mozilla announcement. No
  third-party document is committed.
- **The model:** SciOS, "The Core-Satellite Model", https://scios.tech/thoughts, dated 2026-06-30, read
  2026-09-22. It is quoted sparingly, with attribution.
