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
- **`covers`** — the cover *path* list (e.g. `["cover.png"]`); the card builds the
  image URL from `bioimage-io/artifacts/<id>/files/<cover>` (file stays in the
  model collection, but the report must carry the path).
- **A numeric tiebreaker** (model `download_count` or `created_at`) — the coarse
  `0/0.5/1` score ties every passed model at `1.0`; the report artifact's own
  `download_count` is ~0, so denormalize the model's for popularity/recency
  tie-break (`order_by=manifest.score>,manifest.download_count>`).
- Optional: `badges` (partner links), `authors`/`uploader`.

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
