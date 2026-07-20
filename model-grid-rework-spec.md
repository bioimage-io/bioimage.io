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

## Score contract (producer side — bioengine/CI)
- Each report artifact's `manifest.score`: `0` failed, `0.5` valid-format, `1`
  passed. Formula may evolve; the frontend only sorts by it, so changes need **no
  frontend change**.
- Reports are (re)generated on the daily CI run or a manual "test" from the UI
  (skip-cache), which also refreshes the denormalized `name`.

## Card composition (no heavy denormalization)
For each report `test-report-<id>`:
- **nickname / id** = `<id>` (stable; it's the report id itself).
- **emoji** = derived from the id (animal in the nickname) — no storage.
- **name** = report `manifest.name` (refreshed on retest; eventually consistent).
- **cover** = loaded from the **model** collection by id
  (`/bioimage-io/artifacts/<id>/files/<cover>`) — covers are files, not manifest,
  so no denormalization.
- **score / test outcome badge** = report `manifest.score`.

## Two modes in `fetchResources`
1. **Browse (no search query):**
   - Source: `test-reports` children, `order_by=manifest.score>,download_count>`
     (score primary, downloads/`created_at` tie-break), paginated server-side.
   - Native quality gate: only models with a report appear.
2. **Search (has query):**
   - Source: **`bioimage.io` collection** keyword search (rich index:
     name/tags/description) — the report manifest lacks these keywords, so search
     must stay on the model collection.
   - **Nickname/id search** solved client-side: substring-match the stripped query
     against the model id list (~258 short nicknames — cheap to fetch once).
   - Search **surfaces any published model** (including not-yet-tested ones) for
     findability — intentionally broader than browse.

## Status reconciliation (the one open nuance the data exposed)
- Reports exist for some **non-published** models too: e.g. `self-disciplined-octopus`
  is committed but `in-review`, and has a (failing) published-slot report. So
  "has a report" ≠ "is published".
- Therefore the browse grid must **still exclude `in-review` / `in-revision` /
  `draft`** models, or they leak in.
- Options (decide with CI/status coordination):
  a. **CI only maintains published-slot reports for `published` models** — then
     "has published report" ≈ published; cleanest, no per-item status lookup.
  b. **Denormalize `status` into the report manifest** (refreshed on retest) and
     filter on it in the grid query (`filters` can `$in` the allowed statuses).
  c. Frontend cross-checks status per item (extra lookups — avoid).
- Recommended: (a) + (b) as belt-and-suspenders (report carries `status`, CI keeps
  it fresh, grid filters `status $in [published]` and treats missing as published).

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
