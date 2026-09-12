# Campaign wire-format corpus

Generated. Do not edit by hand. Every file here is emitted from
`src/services/__fixtures__/campaigns.ts` by
`scripts/export-campaign-fixtures.js`.

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
