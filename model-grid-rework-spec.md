# Spec: model grid sourced from the `test-reports` collection

## Goal
List the public model grid from **`bioimage-io/test-reports`** instead of the
`bioimage-io/bioimage.io` collection, so we get (a) a controllable ranking
`score`, (b) a natural "only tested models are public" gate, and (c) no reliance
on the vestigial `manifest.score` on model artifacts.

## Key facts (verified 2026-07-20)
- `test-reports` is a collection with **168 report artifacts**; ids are
  `test-report-<modelId>`.
- **All 155 published (committed, `type=model`) models already have a report** —
  **0 backfill needed**. Only the `score` field must be added to reports.
- Report artifact manifests today carry only `['name','description']` — **no
  `score` yet**. The producer (bioengine / model-runner CI) must add it.
- Hypha `order_by` supports **multiple keys** (verified:
  `order_by=manifest.score>,download_count>` works) → coarse scores can tie-break.

## Report manifest fields the grid card needs (producer side)
Current report manifest: `{name, description, id, id_emoji, score}`. The card
(`ArtifactCard`) also renders `covers`, `tags`, and optionally `badges` — so add:
- **`tags`** — card tag chips.
- **`covers`** — the cover *path* list (e.g. `["cover.png"]`), **not** a full URL
  (see "Cover / thumbnail resolution" below).
- **`metadata_completeness`** — the secondary sort key (high = better; producer
  side, from the model-runner app). Breaks the coarse-`score` ties deterministically
  so the grid isn't randomly arranged.
- Optional: `icon` (fallback thumbnail), `badges` (partner links), `authors`/`uploader`.

## Score / ordering contract (producer side — bioengine/model-runner)
- `manifest.score`: `0` failed, `0.5` valid-format, `1` passed. Formula may evolve;
  the frontend only sorts by it, so changes need **no frontend change**.
- `manifest.metadata_completeness`: numeric, high = better. Secondary sort key.
- Grid ordering: **`order_by=manifest.score>,manifest.metadata_completeness>`**
  (both descending). Verified Hypha honors multi-field `order_by`.
- Reports are (re)generated on the daily CI run or a manual "test" from the UI
  (skip-cache), which also refreshes the denormalized `name`/`tags`/`covers`.

## Cover / thumbnail resolution (decision: path in report, URL resolved by website)
- The report carries the cover **path** (`covers`), and **the website resolves the
  URL** via the existing shared helper `resolveCoverThumbnailUrl(coverPath, id)`
  (`ArtifactCard.tsx:164`), which points at the model's own file in the bioimage-io
  collection. The model-runner must **not** store a full thumbnail URL.
- Why: the same `(coverPath, id)` + same resolver is used in **browse** (path from
  report), **search** (path from `bioimage.io` manifest) and **detail** — so the
  image is **identical everywhere** and always loaded from `bioimage-io/bioimage.io`.
  A precomputed URL in the report could drift from search/detail resolution and show
  a different image (exactly what must be avoided).

## Card composition (no heavy denormalization)
For each report `test-report-<id>`:
- **nickname / id** = `<id>` (stable; it's the report id itself).
- **emoji** = report `id_emoji` (or derived from the id).
- **name / description / tags** = report manifest (refreshed on retest).
- **cover** = report `covers` path → `resolveCoverThumbnailUrl(path, id)` → file in
  the model collection (shared resolver — same image as search/detail).
- **score / test outcome badge** = report `manifest.score`.

## Two modes in `fetchResources`
1. **Browse (no search query):**
   - Source: `test-reports` children,
     `order_by=manifest.score>,manifest.metadata_completeness>` (score primary,
     metadata_completeness secondary), paginated server-side.
   - Native quality gate: only models with a report appear.
2. **Search (has query):**
   - Source: **`bioimage.io` collection** keyword search (rich index:
     name/tags/description) — the report manifest lacks these keywords, so search
     must stay on the model collection.
   - **Nickname/id search** solved client-side: substring-match the stripped query
     against the model id list (~258 short nicknames — cheap to fetch once).
   - Search **surfaces any published model** (including not-yet-tested ones) for
     findability — intentionally broader than browse.

## Status: no extra grid filter needed
- Invariant (CI policy): **a published-slot report exists only for published
  models** → "has a report" == "is published". So the browse grid needs **no**
  status filter for `in-review` / `in-revision` / `draft`.
- Known one-off exception: `self-disciplined-octopus` was mistakenly committed
  while still in review (by an earlier agent). It fails its test, so its `score`
  sorts it to the very bottom, and the maintainer (Fynn) will fix it. No code
  handling required — anomalies self-correct via low score.

## Supersedes
- The current **client-side status blocklist** (`hyphaStore.fetchResources`) is
  replaced: browse gating becomes native (report presence + status filter). Keep
  it only until the test-report source lands.

## Dependencies / sequencing
1. bioengine/CI: add `manifest.score` (+ optionally `status`) to report artifacts.
   Backfill scores onto the existing 168 reports (no *test* backfill needed).
2. Frontend: rework `fetchResources` for the two modes; card cover-from-collection;
   client-side nickname search; multi-key `order_by`.
3. Retire the vestigial `manifest.score`-on-model sort and the client-side blocklist.

## Not in scope
- Changing the review workflow or the `request_deletion` field (unchanged).
