# The pinning run (C)

## The run

- **Command.** `node corpus/pin.mjs`, at `2026-09-22T19:20:25Z`–`19:20:31Z` with curl 8.7.1. No
  redirects were followed.
- **Result.**
  - 40 sources answered HTTP 200 with a non-empty body, and every byte count matched its
    `Content-Length`.
  - All 40 digests are distinct, and none is the empty-input digest.
  - One source has no immutable location: the Mila and Mozilla announcement. It is recorded under
    `unpinned` with a null digest and the reason.
- **Output.**
  - `corpus/manifest.json` (committed in `4fdab1c`).
  - The fetched bytes and header dumps in `data/`, which is git-ignored.
- **Cross-check.** Each digest equals the one the independent sourcing fetches recorded about 30 minutes
  earlier.

## The rerun

`node corpus/pin.mjs` with the manifest present fetched nothing ("corpus/manifest.json exists; not
fetching"). It rewrote `core.md` and `map.yaml` from the manifest, and
`git diff --exit-code core.md map.yaml corpus/manifest.json` exited 0.

## An accidental refetch

While testing the manifest's refusal to be overwritten, the program was run once with `--force` by
mistake, at `19:21:04Z`–`19:21:09Z`.

- **What it did.** It refetched every source and overwrote the working-tree manifest.
- **What it found.** Against the committed manifest, all 40 digests and byte counts were identical. Only
  the fetch times differed. It is a second measurement, 38 seconds after the pin, that the 40 locations
  serve fixed bytes.
- **How it was undone.** The committed manifest, `core.md` and `map.yaml` were restored with
  `git checkout`, and the restored manifest's SHA-256 equals the committed one. The byte-identical rerun
  above was made after the restore.
- **What remains.** The header dumps in `data/` are from the refetch. They are not committed and not
  signed.

## Environment notes

- **scios.tech.** `scios.tech` redirects to `www.scios.tech`, which is outside this session's sandbox
  allowlist. `scios.tech/thoughts` was read through WebFetch on 2026-09-22. The newest post is dated
  2026-07-02, and no core-satellite schema is published.
- **GitHub release assets.** They redirect to `release-assets.githubusercontent.com`, which is also
  outside the allowlist. RO-Crate is therefore pinned to the raw file at its 1.3.0 tag commit.
