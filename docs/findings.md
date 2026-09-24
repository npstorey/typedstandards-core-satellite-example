# Findings for the owner

This example consumes `@typedstandards/produce-core` 0.5.0 and `@typedstandards/verify-core` 0.10.0
unchanged. Neither package nor the specification was modified, and no issue was filed from this
repository.

| # | Finding | Measured | Status |
|---|---|---|---|
| 1 | produce-core 0.5.0 does not re-export `RAW_BYTES_CANONICALIZATION`. | The installed package's export list lacks it. `package/build.mjs` imports it from verify-core. | Filed before this example: typedstandards#91. |
| 2 | Spec check #6 (`signature.kid` = `metadata.signingKeyId`) is implemented nowhere. | `verifyRecord` returns no field for it. `verify.mjs` checks `kid`, `signingKeyId` and `signer.identifier` directly. | Filed before this example: typedstandards#88. |
| 3 | Check #12 reports `unknown_type` for `attestation/revises/v1`. | verify-core 0.10.0's `KNOWN_TYPE_URIS` lists 15 attestation sub-types. The specification at hub `cfdb210` (v0.1.9) states the table in five places: the §6.2 glossary (line 205), the §8.12 opening (line 1412) and the §8.12.1 table name 16; the §7.4 `attestation/*` bullet (line 367) and the Q36 paragraph (line 373) omit `revises`. (Corrected 2026-09-23: this row said three places.) | Found here at G1. Filed by the owner: typedstandards#96 and hub#230. Both closed. |

## Since: the phase 3 pins

The example now pins produce-core 0.6.0 and verify-core 0.11.0 exactly. The two version-1 records were
built with 0.5.0 and 0.10.0 (`package/build-log.json`), and verify under both.

- Finding 1: produce-core 0.6.0 re-exports `RAW_BYTES_CANONICALIZATION`, and `package/build.mjs` imports it
  from there.
- Finding 2: verify-core 0.11.0 implements check #6 as `signingKeyIdConsistency`, and `verify.mjs` reads it.
  #6 does not compare `signer.identifier`, so `verify.mjs` keeps that comparison as a line of its own.
- Finding 3: verify-core 0.11.0 registers `attestation/revises/v1` in check #12, citing specification
  v0.1.10. hub#230 was closed on 2026-09-23: specification v0.1.10, at hub `533fc6d`, lists the sub-type in
  all five places it states the table.

## Version 3: the edges read again against their pinned bytes

Read 2026-09-23. Each edge's basis was split into its claims, and each claim was looked up in the bytes
`corpus/manifest.json` pins (`data/`, re-hashed with `node corpus/pin.mjs --verify`) and in the
specification those edges cite (v0.1.9). Of 34 edges, 19 are supported, 13 say more than their bytes show,
one is not supported (proof-of-control: its pinned file is the frontispiece, which shows neither the token
format nor the SLSA and in-toto pointer its basis names), and one has no pinned bytes (the Mila and Mozilla
initiative).

- The 14 that say more, or are not supported, are withdrawn and restated in version 3 under
  `map/header-2.yaml`. Each restatement's `curation.reason` says what changed, and each withdrawal gives
  its reason.
- Three bases cite a section that does not itself hold one of their claims, although the claim holds:
  in-toto (`contentHash`'s shape is in §8.1.1, not §5.5), C2PA ("neither depends on the other" is not in
  §5.5) and W3C VC 2.0 (§5.5 does not say the model leaves out how an artifact was produced). They are not
  restated.
- In the specification, not in an edge: v0.1.9 cites RFC 8032 §5.1.2 for Ed25519ph (lines 594, 1580 and
  1680). In RFC 8032, §5.1.2 is "Encoding"; Ed25519ph is defined in §5.1.
