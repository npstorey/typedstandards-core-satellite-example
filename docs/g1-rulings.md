# Gate G1: rulings

G1 came after `core.md` and `map.yaml` were drafted, at commit `42c0e33`. Nothing had been fetched for
pinning, packaged or signed. The owner ruled on 2026-09-22. All seven rulings follow the recommendation.

| Card | Ruling |
|---|---|
| D1 Domain | `analysis-provenance`, horizontal. |
| D2 `type: core` | Omitted. The first `x-typedstandards` key is `selfAssessment: satellite`, followed by `typeDeclared: false`. |
| D3 Capture method | `script-run`, with two programs: `corpus/pin.mjs`, then `package/build.mjs`. |
| D4 Ref shape | `ref: { location, sha256 }`, stated in the README. |
| D5 Entries | The 34 edges as drafted: 28 kept, 3 added (RFC 8032, Verikan, MIRA schema), 3 moved to ring 2 (DCAT, RO-Crate, WRROC), DSSE dropped. |
| D6 Proof of Insight | `adjacent`, with the basis stating that it specifies the same kind of record. |
| D7 External proofs | None in this version: no RFC 3161 token and no Rekor entry. |

## Changes the seat asked for

1. **`attestation/revises/v1`.** The specification states the ratified attestation sub-type table twice,
   and the two statements disagree on `attestation/revises/v1`. verify-core follows the shorter list. Both
   gaps are filed: hub#230 for the specification and typedstandards#96 for verify-core, cross-referenced.
   The README cites them wherever it mentions the attestation vocabulary. Neither is changed here.
2. **The DSSE drop reason.** The reason gains a clause: the specification names in-toto / DSSE in its
   adjacent-standards table (§5.5) and lists DSSE as a candidate envelope-serialization profile.
   - The seat placed that listing in Appendix G.
   - Measured in the specification at hub `cfdb210`, line 1816, it is in **Appendix C** (the
     adjacent-standards comparison table). Appendix G is the revision history.
   - The drop reason cites Appendix C.
