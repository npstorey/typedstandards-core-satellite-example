# typedstandards-core-satellite-example

This repository applies the "core and satellite" model from SciOS's paper *The Core-Satellite Model*
(scios.tech/thoughts, dated 2026-06-30) to the domain [Typed Standards](https://typedstandards.org) works
in. Its two published files are signed as Typed Standards records that verify offline.

- **`core.md`** puts Typed Standards in the core-record front-matter shape the paper's examples use,
  filled from public sources. It assesses the project as a satellite, omits `type: core`, and marks
  each core responsibility the project does not hold NOT DONE.
- **`map.yaml`** gives Typed Standards' technical relations to 34 public projects in three rings. It has
  no `orbits` edge (see [Relations and the published schema](#relations-and-the-published-schema)).
- **The two records.** Each file is the inline output of one record under `raw-bytes/v1`, so
  `shasum -a 256 core.md` prints the record's `contentHash.sha256`. After `npm ci`, one command checks
  both with no network access: `node verify.mjs`.

The example follows `typedstandards-eval-run-example` (hub ADR-0028). It pins the published releases
`@typedstandards/produce-core` 0.5.0 and `@typedstandards/verify-core` 0.10.0 exactly. Those are the
releases that carry `raw-bytes/v1` (hub ADR-0029) and the self-certifying `did:key` signer (hub ADR-0030).

## How Typed Standards was used here

**What was produced.** Two signed records: `package/core.bundle.json` for `core.md`, and
`package/map.bundle.json` for `map.yaml`. Each record carries:

- the file's exact bytes and their SHA-256, a 64-character fingerprint that changes if any byte changes;
- the sources the fetch program used, each with its location, SHA-256, size, HTTP status, fetch time and
  licence: 34 in the map record and 11 in the core record, 5 of them in both, out of the 40 recorded in
  `corpus/manifest.json`;
- the two programs that made the file, each named by the SHA-256 of its code;
- two labels. The profile says a script wrote the file and can write it again. The capture method says
  the packaging program read the finished file rather than watching the writer run. Nothing verifies
  that label (`docs/verify-output.txt`, line 15);
- the signer: a key that names itself, with no registry, account or person behind it.

**How it was made.**

1. `corpus/pin.mjs` fetched each source once and pinned it: it recorded the SHA-256 of what the location
   served. Then it wrote `core.md` and `map.yaml` from the list in `corpus/sources.json` and those pins.
2. `package/build.mjs` read the two finished files, then packaged and signed each one.

The key was generated for this example, outside the repository. It is now held in the publisher's
1Password vault, and signing runs only in the publisher's own terminal.

**What you can check.** After cloning the repository, in a terminal:

- Both records verify offline: `npm ci && node verify.mjs`. The output should match
  `docs/verify-output.txt`, whose line 46 reads `network: global fetch calls 0; injected fetch calls 0`.
- Each file is byte for byte what was signed: `shasum -a 256 core.md map.yaml` prints the SHA-256 that
  each record states for its file, as `contentHash.sha256`.
- Any pinned source can be fetched again and compared: `node corpus/pin.mjs --force` in a scratch clone,
  then `git diff corpus/manifest.json`.
- Both files can be written again from the pins, offline: `node corpus/pin.mjs`, then
  `git diff --exit-code core.md map.yaml`.
- The web page, `docs/index.html`, comes only from signed bytes: `npm run check:page` regenerates it and
  compares, and the generator refuses a signed file whose SHA-256 differs from its record.

**What it does not establish.** The table below marks five things as not covered: who holds the key, when
the records existed, inclusion in a public transparency log, revocation of the key, and whether any
statement in either file is correct. It marks four more as asserted: signed, but resting on the signer's
word.

**Why it was useful.**

- The checks run offline on your own copy. They show that the files are what this key signed, whichever
  server delivered them, but not who holds the key.
- The source pins and the labels are inside the signed bytes, so changing any of them breaks check #1,
  which recomputes the hash of the whole signed record.
- A signed git commit also fixes bytes. A record is also self-contained, verifies offline against the
  specification's numbered checks, and carries its source pins and labels inside its signed bytes.
- Building this example ran into three gaps in the specification and its reference packages, all filed
  (`docs/findings.md`): two filed before (typedstandards#91, #88) and one found here (typedstandards#96,
  hub#230).

**Terms used below.**

- **ref:** a location, with the SHA-256 of what that location served.
- **front matter:** the YAML block between the two `---` lines at the top of `core.md`.
- **inline output:** the file's bytes, carried inside the record. `raw-bytes/v1` is the rule that they are
  carried exactly as they are.
- **envelope:** the whole signed record. The key signs its hash.
- **did:key:** an identifier made from the public key itself, so no registry is needed.
- **Ed25519ph:** the signature algorithm.

## What the records prove / what they do not

This section describes the offline output of verify-core as `node verify.mjs` prints it
(`docs/verify-output.txt`).

**Attested:** checkable by anyone from the bundles in `package/`. The row names the check that
establishes it.
**Asserted:** stated inside the signed bytes, but resting on the signer's word. No check establishes it.
**Not covered:** nothing in this repository addresses it.

| Property | Status | Why |
|---|---|---|
| The bytes of `core.md` and `map.yaml` | Attested (#3, #4, #1) | Each record carries its file's exact UTF-8 bytes inline, under `raw-bytes/v1` (#3 `ok`). #4 recomputes `contentHash.sha256` from those bytes (`ok`), and #1 recomputes the envelope hash (`verified`). The digest is the file's ordinary SHA-256, so `shasum -a 256` checks it without any Typed Standards code, and `verify.mjs` compares each file on disk with its signed output byte for byte. |
| The signature over each record | Attested (#2) | Ed25519ph over the envelope-hash hex string. Valid for both records. |
| One key signed both records | Attested (#14, #2) | #14 reports `key_derived_match` for each record: the `did:key` identifier is derived from the public key in that record's signature. `verify.mjs` then confirms that both signatures carry the same key and identifier. |
| The key names itself consistently | Attested (#6, checked by `verify.mjs`) | `signature.kid`, `metadata.signingKeyId` and `signer.identifier` are one string. No verifier implements spec check #6 (typedstandards#88), so `verify.mjs` checks it directly. |
| Who holds the key | Not covered | #5 reports `self_certified` with `verified: false`: no trust registry and no domain vouch for the key. `displayName` names the example, not a person. |
| Capture method and producer profile | Asserted | #15 reports `ok`: `script-run` is a value the `scripted-recomputation` profile allows. No check establishes that one program wrote the files and a second one packaged them. The label is signed, so it cannot be changed without breaking #1. |
| The source digests | Asserted | `corpus/manifest.json` pins 40 sources. The map record lists the 34 it uses and the core record the 11 it uses, 5 of them in both, in `queries[].arguments`: location, SHA-256, bytes, HTTP status, fetch time and stated licence. These are signed assertions that no check recomputes. Every location is immutable, so anyone can re-fetch it and compare. An accidental second fetch, 38 seconds after the pin, got identical digests for all 40 (`docs/pin-record.md`). |
| `core.md` and `map.yaml` follow from the manifest | Asserted | `node corpus/pin.mjs` rewrites both files from `corpus/sources.json` and `corpus/manifest.json` without the network, and `git diff --exit-code` shows the same bytes. That reproduces the writer, but it is not a §9.2 check. |
| The relations, the bases and the self-assessment | Asserted | They are the signer's reading of each project's own public text. No check evaluates them, and the published schema has no edge type for any of these relations. |
| When the records existed | Not covered | Check #7 reads n/a because no RFC 3161 token was requested. External proofs are left out of this version (gate G1, D7), and `metadata.createdAt` is the signer's own claim. |
| Inclusion in a public transparency log | Not covered | Check #8 reads n/a because no Rekor entry was submitted. A Rekor entry is public and permanent, and a record re-signed after a gate would leave an abandoned hash in the log under this key. |
| Revocation of the key | Not covered | A `did:key` has no rotation and no revocation (hub ADR-0030 §7). |
| That any statement in either file is correct | Not covered | A signature shows the bytes are unchanged since signing, not that they are true (spec §5.3). |

## What the key proves

Both records verify under one key, and its identifier is derived from that key. Anything else signed
under this identifier was signed by the same key. The key says nothing about who holds it. No registry
lists it, and `displayName` ("typedstandards-core-satellite-example (self-certifying example key)")
names this example, not a person.

The publisher keeps the signing key, so that a later revision of these records can be signed by the same
key. A `did:key` cannot be rotated or revoked (hub ADR-0030 §7), so keeping the key is the only way to
continue under this identifier. If the key were compromised, it could only be abandoned in favour of a new
identifier with no link to this one, and nothing in a record already signed under it would say so. The key
was generated for this example only. It is held in the publisher's 1Password vault, outside the repository,
and has never been printed.

Signing runs only in the publisher's own terminal:

    cp .env.sign.example .env.sign
    op run --env-file=.env.sign -- node package/build.mjs sign

- **How the key reaches the program.** `op run` passes the key to that one process as `SIGNING_SEED_B64`.
  No session that builds or checks this repository can read it.
- **What `.env.sign.example` holds.** An `op://` reference, never a value. The vault name contains spaces,
  so a shell command that uses the reference directly must quote it.
- **What `sign` does now.** The records are already signed, so it writes nothing. It re-signs each committed
  envelope hash with the supplied key and confirms that the result equals the committed signature.
  Ed25519 signatures are deterministic, so only the signing key reproduces them.

## What the SciOS schema would still need from the standard

- **Endorsements.** The paper lets any participant endorse a core or withdraw an endorsement, "append-only
  and attributable". In Typed Standards terms, each endorsement is a separately signed attestation that
  targets the core record's `nodeId`: `attestation/endorses/v1` for an authority-bearing party, or
  `attestation/corroborates/v1` for any participant. A withdrawal is a further signed node; the
  endorsement it withdraws stays in place. None is built here.
- **Rules a verifier enforces.** The specification ratifies the v0.1 attestation sub-type table (§8.12.1),
  and check #12 recognizes `endorses` and `corroborates`. But nothing operationalizes it (§8.12.4): no
  check enforces a sub-type's authorization rule or its payload. The specification also states the
  ratified table twice, and the two statements disagree on `attestation/revises/v1` (hub#230). verify-core
  follows the shorter list (typedstandards#96).
- **A hash check for every link.** The paper wants every link to carry a location and a content hash.
  `raw-bytes/v1` fingerprints one file per record, so here only `core.md` and `map.yaml` themselves are
  recomputed by a check. The 40 links they cite are signed assertions. A rule over a set of files is not
  specified (hub ADR-0029 §4).
- **Maturity is the reader's call.** The paper leaves maturity to "competing algorithms" run by observers.
  The specification's preamble forbids platform-issued verdicts (§5.1), so the two agree that the record
  surfaces signals and the reader judges.

## Relations and the published schema

- **Edge types.** The paper's published examples show one edge type, `orbits`, from a satellite to a core.
  This map has none: no core record exists in this domain to be the object of one, and the paper says a
  core is never a satellite. Each edge names its relation in `x-typedstandards.relation` (`builds-on`,
  `complements`, `could-emit` or `adjacent`, defined in the map's header), because the published schema
  has no edge type for any of them.
  - A `could-emit` relation is asserted only where the project's own public text states the intent. qsv
    (dathere/qsv#4448) is the one such case, with its sources cited by URL and date.
  - Humane Intelligence's red-teaming app keeps reviewable evaluation records. Its public text states no
    intent to produce signed records, so the map asserts no evaluator relation for it.
- **Field names.** Outside `x-typedstandards`, both files use only field names the published examples show.
  The paper's schema v0.1 is not published (scios.tech/thoughts, read 2026-09-22).
- **`type` is omitted.** The paper treats surfacing a core record as declaring oneself a core, and this
  record's self-assessment is "satellite" (gate G1, D2).
- **The shape of `ref`.** The paper's examples write `ref: <location + content-hash>` without showing the
  shape inside. This example writes `ref: { location, sha256 }`: the two sub-keys are its own choice
  (gate G1, D4).
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

1. **The file digests, with standard tools.** Run `shasum -a 256 core.md map.yaml` and compare with
   `contentHash.sha256` in `package/core.bundle.json` and `package/map.bundle.json`.
2. **The writer.** Run `node corpus/pin.mjs`, then `git diff --exit-code core.md map.yaml`.
   - The manifest exists, so nothing is fetched, and both files come back byte for byte.
3. **The envelopes.** Run `node package/build.mjs check`.
   - It rebuilds both envelopes, unsigned, from the build log and the files on disk, then compares
     them with the signed bundles.
   - The records name `package/build.mjs` by the digest the build log recorded at signing. The check
     uses that digest and says whether the file on disk has changed since.
4. **The sources.** In a scratch clone, run `node corpus/pin.mjs --force`, then
   `git diff corpus/manifest.json`.
   - This re-fetches all 40 sources. At immutable locations, only `fetchedAt` and `pinnedAt` should
     change.
   - `node corpus/pin.mjs --verify` re-hashes the local bytes in `data/` against the manifest.

## Layout

- **`core.md`, `map.yaml`:** the two published files, each signed as one record.
- **`corpus/`:**
  - `sources.json`: the curated sources, nodes and edges.
  - `core.template.md`: the prose of `core.md`.
  - `pin.mjs`: program 1, which fetches once and writes both files.
  - `manifest.json`: written once by `pin.mjs`.
- **`package/`:**
  - `build.mjs`: program 2, which packages and signs. The key comes from `SIGNING_SEED_B64`.
  - `signer.json`: the identifier and public key.
  - `core.bundle.json`, `map.bundle.json`: the two records, each a commitment view with its package
    inline.
  - `build-log.json`: the build log.
- **`verify.mjs`:** the one-command check.
- **`site/generate.mjs`:** writes `docs/index.html` from `map.yaml`, `core.md` and `README.md`.
  - It refuses unless `map.yaml` and `core.md` each match `contentHash.sha256` in their records.
  - `npm run check:page` compares the committed page with a fresh generation, byte for byte.
  - `npm run test:page` runs its tests. Its one YAML parser, `yaml`, is a devDependency pinned exactly.
- **`.github/workflows/check.yml`:** on every push and pull request, `npm ci`, then `node verify.mjs`
  compared with `docs/verify-output.txt`, `npm run check:page` and `npm run test:page`.
- **`.env.sign.example`:** the `op://` reference to the signing key, for `op run`.
- **`docs/`:**
  - `index.html`: the map and the records as a picture and tables. It is generated and committed, and
    it is a view of the signed files, not a record.
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
