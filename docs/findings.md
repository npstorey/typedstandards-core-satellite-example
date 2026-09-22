# Findings for the owner

This example consumes `@typedstandards/produce-core` 0.5.0 and `@typedstandards/verify-core` 0.10.0
unchanged. Neither package nor the specification was modified, and no issue was filed from this
repository.

| # | Finding | Measured | Status |
|---|---|---|---|
| 1 | produce-core 0.5.0 does not re-export `RAW_BYTES_CANONICALIZATION`. | The installed package's export list lacks it. `package/build.mjs` imports it from verify-core. | Filed before this example: typedstandards#91. |
| 2 | Spec check #6 (`signature.kid` = `metadata.signingKeyId`) is implemented nowhere. | `verifyRecord` returns no field for it. `verify.mjs` checks `kid`, `signingKeyId` and `signer.identifier` directly. | Filed before this example: typedstandards#88. |
| 3 | Check #12 reports `unknown_type` for `attestation/revises/v1`. | verify-core 0.10.0's `KNOWN_TYPE_URIS` lists 15 attestation sub-types. The specification at hub `cfdb210` states the table three times: 16 in the §6.2 glossary (line 205), 15 in the §7.4 Q36 paragraph (line 373), and 16 in the §8.12.1 table. | Found here at G1. Filed by the owner: typedstandards#96 and hub#230. |
