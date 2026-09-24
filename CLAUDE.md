# typedstandards-core-satellite-example: repository instructions

One worked example: the SciOS "core and satellite" model applied to the domain Typed Standards works
in, with the example's published content files signed as Typed Standards records that verify offline,
one record per edge of the map, served by a host that displays them by a stated policy. The working
contract is the owner's IMPL CORE-SATELLITE-EXAMPLE brief and its gate rulings (G1, G2), for the web page
the IMPL CORE-SAT-PAGES brief and its rulings (G1, G1b, G2), for the per-edge records, the host and the
registry the IMPL CORE-SAT-HOST brief, the owner's memo rulings D1-D8 and the G0 rulings, and for the page's
presentation the IMPL CORE-SAT-FRAME brief and its rulings D1-D7 (2026-09-24). They win over anything here.

## Fixed

- Packages: `@typedstandards/produce-core` 0.6.0 and `@typedstandards/verify-core` 0.11.0, pinned
  exactly (the two version-1 records were built with 0.5.0 and 0.10.0). Never modify them. A gap in
  either is a finding for the owner, not a patch.
- Records: one per published file, each carrying its file's exact UTF-8 bytes inline as `output` under
  `raw-bytes/v1`. Version 1 is `core.md` and `map.yaml`; both stay active, and their signed packages,
  `packageHash` and signatures never change. Version 2 is `map/header.yaml` and one record per edge,
  `map/edges/<key>.yaml`. Version 3 is `map/header-2.yaml` and 14 edges that restate withdrawn ones; the
  first header and those 14 edges are withdrawn. A later header is an entry of `headers` in
  `corpus/sources.json` with its own full block, and an edge that belongs to it names it in `header`.
  The page and README say "N current records and version 1", never "superseded".
  A record is named by its file's path without the extension; its bundle is `package/<name>.bundle.json`.
- A signed file is never rewritten or removed. A correction is a withdrawal plus a new record: the edge
  gets a new key in `corpus/sources.json`, names the key it restates in `replaces`, and the withdrawn
  edge's entry and file stay.
- Withdrawal: `attestation/withdraws/v1`, signed by the same key (`package/build.mjs withdraw <name>
  --reason <text>`, owner's terminal), carried in the record's view. No other attestation, and no
  record of a reserved type, is built here.
- Labels: `producerProfile: scripted-recomputation/<subtype>`, `captureMethod: script-run`,
  `metadata.contentProfile` absent. `RAW_BYTES_CANONICALIZATION` is imported from produce-core, which
  re-exports it since 0.6.0 (typedstandards#91); the URI is never written by hand.
- Signer: a `did:key` derived from a fresh Ed25519 seed, `bindingTier: pseudonymous`. The one
  identifier string is `signingKeyId`, the envelope `kid` and `signer.identifier`. `displayName` names the
  example, not a person.
- Registry: `docs/.well-known/typed-publisher.json`, written by `package/build.mjs host` when absent: the
  one key from `package/signer.json`, active, `activatedAt` the build log's earliest `createdAt`. Every
  view names it as `trustRegistryUrl` and carries it as `trustRegistry`; both are unsigned view fields.
  The page and README call it the example publisher's own statement, never an endorsement by the
  specification or typedstandards.org. Offline, #5 stays `self_certified`.
- No external proofs in this version: no RFC 3161 token, no Rekor entry.
- The signing key lives in the owner's 1Password vault. No session can read it; never try.
  - Signing runs only in the owner's own terminal:
    `op run --env-file=.env.sign -- node package/build.mjs sign`.
  - `op run` supplies the key to that process as `SIGNING_SEED_B64`.
  - `.env.sign` is an ignored copy of `.env.sign.example`, which holds only the `op://` reference.
  - The vault name contains spaces, so a shell command that uses the reference directly quotes it.
  - A transitional on-disk copy may remain at `~/.config/typedstandards-core-satellite-example/`.
    Removing it is the owner's step.
- `sign` never re-signs a record. It first requires the supplied key to reproduce every committed
  signature and every signed file to equal its record, then signs every record file with no bundle as one
  step. With none, it writes nothing. It refuses, and writes nothing, while a file that restates a record
  (`replaces`) would be signed before that record is withdrawn.
- Each new record lands with its bundle, `docs/records.json` and the rebuilt page in one signed commit
  (D6). Phase 3's first batch was the one exception: its files were committed at G1, its bundles at G2.

## Two programs

1. `corpus/pin.mjs` fetches every source once into `data/` (git-ignored), writes
   `corpus/manifest.json` once (it refuses to overwrite without `--force`), then writes `core.md`,
   every header (`map/header.yaml` from `map`, each later one from its entry in `headers`) and
   `map/edges/<key>.yaml` as a pure function of `corpus/sources.json`, the template and the manifest. A
   rerun is byte-identical: `git diff --exit-code core.md map.yaml map/`.
   - `map.yaml` is version 1's file: never overwritten, only compared, against what `map` and the edges
     that name no later header write. The rerun reproduces it while the manifest is version 1's (map.yaml's
     header names the manifest's digest).
   - The manifest is append-only: an addition appends its sources and changes no entry and not
     `pinnedAt`, which dates `core.md` and the header. An edge's `createdAt` is its other end's fetch
     date, so an addition leaves every existing file byte-identical.
2. `package/build.mjs`, run afterwards, reads those files from disk and packages them. That is what makes
   the capture method `script-run` (hub ADR-0029 §2). The build log records, per record, the digests of the
   programs and inputs that built it (version 1's in the shared top-level block); `check` rebuilds every
   record from them and reports separately whether the files on disk still match.

## The host

- GitHub Pages serves `docs/`: each bundle at `docs/bundles/<name>.bundle.json`, byte for byte the
  `package/` copy; `docs/records.json`, derived by `package/build.mjs` (status from verify-core's
  `verifyLifecycleChain`, never typed by hand); `docs/host-policy.yaml`, the host's display rule. Neither
  JSON nor policy is signed. `node package/build.mjs check` fails on any drift among them.
- No served path has a `/records/` or `/evidence/` segment or a 64-hex `.json` filename, or
  typedstandards.org's verifier resolves something else. Links read
  `https://typedstandards.org/verify?url=<served bundle URL>`, unencoded.

## The web page

- `site/generate.mjs` writes `docs/index.html` from the signed files `docs/records.json` lists,
  `README.md`, `docs/records.json` and `docs/host-policy.yaml`, and applies the policy. It refuses unless
  each signed file matches `contentHash.sha256` in its served bundle; the bundles gate the run and never
  reach the page. The page is committed, is a view of the signed files, and is never a record.
- The page never says "confirmed by", "vouched for by typedstandards.org", "verified live" or
  "superseded"; the generator refuses a page that would.
- `README.md`, `docs/records.json` and `docs/host-policy.yaml` are inputs. Every edit to one is followed
  by `node site/generate.mjs`; otherwise `npm run check:page`, and CI with it, fails.
- Every honest-absence item stays visible on the page, never inside a `<details>`, and `npm test`
  checks it. The proof table folds only behind a visible summary that names every row, "Not covered" rows
  included. Tests sign only with a throwaway key made in memory, on scratch copies.
- The records table stays open: one row per record, anchored `#record-` plus its name with each `/` as `-`
  (`#record-map-edges-qsv-2`), with its verifier link.
- Signed timestamps are shown in US Eastern time with UTC beside them, by `eastern()`'s arithmetic under a
  fixed zone rule, never the machine's zone; the generator names no `Date` or `Intl` (C1).
- The typefaces are Space Grotesk and Noto Sans, subset under `docs/fonts/` beside their OFL licences. The
  page loads nothing from any other host (`font-src 'self'`).
- `docs/host-policy.yaml` also declares the ring captions and the ring-3 fill. The generator refuses a
  caption a drawn edge breaks, and a fill whose cited ref is not the node's signed ref. A filled node's quoted
  lines are verbatim from its pinned file, which `npm test` checks where `data/` is present.
- The identity bar carries affiliation only: "A worked example from the Typed Standards project." Where the
  page first points to typedstandards.org's verifier (the offline-check box), and in the footer, it says the
  records carry this example's own key, whose registry host that site's host directory does not list, so
  its verifier reads "Unknown publisher" and checks every signature anyway.
- GitHub Pages serves `docs/` from `main` at https://core-satellite.typedstandards.org/ (`docs/CNAME`,
  `docs/.nojekyll`). Pages settings are the owner's.

## Refs

A ref is a file at a 40-character commit SHA, a dated W3C TR URL, an rfc-editor.org text URL, or a
published release archive. A landing page, a rendered view or a homepage is not a ref. Where a project
offers no immutable location, the edge carries the location, `sha256: null` and the reason. A fetch
must answer HTTP 200 with a non-empty body, and no two sources may share a digest.

## Runtimes

- Node 22 via fnm: `eval "$(fnm env --shell zsh)" && fnm use 22`. Network I/O is curl, so the
  sandbox proxy applies and each response keeps a header dump.
- CI (`.github/workflows/check.yml`) pins Node 22.23.1 exactly, because the first line `verify.mjs`
  prints names the Node version and must equal `docs/verify-output.txt`. Changing the pin means
  regenerating that file on the new version.

## Working rules

- Public sources only; every fact carries its source and fetch date.
- Relations are described technically. No partnership, adoption, conversation, meeting, event or
  outreach wording in any file, commit message or issue.
- A relation states only what the other project's pinned bytes show, never its plans. `could-emit` is
  defined only by version 1's map and the withdrawn first header; no current edge uses it.
- Do not change the typedstandards or hub repositories.
- Code is MIT (`LICENSE`). Text is CC BY 4.0 (`LICENSE-CC-BY-4.0.txt`). Third-party bytes keep the
  licence their source states, or "not stated", and are never committed.
- Commit to `main`, signed. Push only on the owner's word. The global pre-push guard is never
  bypassed by a session. When it blocks, list and classify every match for the owner and stop.
