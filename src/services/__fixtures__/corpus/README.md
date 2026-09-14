# Campaign wire-format corpus

## The numbers in this corpus are invented

Read this before quoting any figure from these files. "Generated" below means
emitted from a TypeScript source by a script. It does **not** mean derived from
real data. No campaign described here has run. Every quantity is a shape
chosen to exercise the wire format, and is not a count of anything that
happened:

- 33 contributions, split 17 included / 12 assessed and not included / 4
  pending;
- 9 contributors and 9 active sites;
- 9 published soup versions and 3 empty merges;
- every `transport` byte count, every timestamp, every metric value;
- the merge cadence, which lands on a fixed spacing because a loop in the
  generator put it there.

None of these belongs in a paper, a slide, a proposal, or a count of platform
activity. A consumer that vendors these files is pinning the **format**. The
values are placeholders and pinning them as evidence is a misread.

The campaigns page carries this same warning as a banner on every route it
serves from these fixtures. A direct fetch of the JSON does not, because a
`CampaignRecord` has no field to put it in. That is the gap this section
covers, and the reason it is written here rather than left to the reader to
infer.

## How it is produced

Generated. Do not edit by hand. Every file here is emitted from
`src/services/__fixtures__/campaigns.ts` by
`scripts/export-campaign-fixtures.js`. This README is hand-written and is
preserved across regeneration (see `PRESERVE` in that script), so it is not
covered by any digest in `MANIFEST.json`.

```
node scripts/export-campaign-fixtures.js           # regenerate
node scripts/export-campaign-fixtures.js --check   # verify, writes nothing, non-zero on drift
```

## What it is

The website owns the campaign **wire format**, the backend owns the
**semantics**. `src/types/campaign.ts` is the canonical definition of the
format. This directory is the canonical set of examples: the exact payloads the
campaigns page is built and tested against.

| File | Shape | Service call |
|---|---|---|
| `index.json` | `CampaignListResponse` | `list_campaigns` |
| `cellpose-sam-community.json` | `CampaignRecord` (asynchronous) | `get_campaign` |
| `unet-consortium.json` | `CampaignRecord` (synchronous) | `get_campaign` |
| `MANIFEST.json` | schema version + sha256 of the above | n/a |

Both modes are present on purpose. `CampaignProgressRecord` is a discriminated
union on `mode`, and a consumer that only ever sees the async arm will read the
optional-looking fields of the sync arm wrong.

## For consumers outside this repo

Vendor a copy of the JSON files and compare their sha256 against
`MANIFEST.json.files`. The digests are taken over the sorted-key serialisation
that the generator writes, so reordering a field in the TypeScript source does
not fire the alarm while adding, removing, or changing a value does.

A mismatch is not a failure, it is the signal to read the diff: the format
moved and the semantics may need to move with it. `schema_version` in the
manifest, on the index envelope, and on each record tells you which way.

## What the async record is chosen to exercise

`cellpose-sam-community.json` is not a happy path. It carries, deliberately:

- contributions in all three dispositions, including **assessed and not
  included**, which is a normal outcome of a greedy gate and never a failure or
  a ranking;
- **empty merges** (`progress.empty_merges`), merges that ran and published no
  version. One assessed nothing because nothing had arrived; two weighed a real
  pool and kept none of it. Total merges is
  `soups.length + empty_merges.length`;
- per-merge `transport` on both published and empty merges, because a declined
  candidate still crossed the network;
- a **witness** metric distinct from the gate metric, so a consumer cannot
  quietly plot the score the gate selects on.

Which specific contributions are excluded is decided by a hash in the
generator, not by anything meaningful. The hash salt was chosen for coverage:
exclusions land on every contributor, none more than twice, and two merges
decline a non-empty pool.
