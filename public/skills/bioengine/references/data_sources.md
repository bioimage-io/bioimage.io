# BioEngine — Streaming Datasets from Public Repositories

BioEngine apps can stream image data on-demand from any HTTPS-served Zarr (typically OME-Zarr) — no upfront download, no per-host staging. This guide shows how to discover datasets in a public repository, pick a representation, and stream it from inside a Ray Serve actor.

## Contents
- [Architecture: BioEngine streams, you discover](#architecture-bioengine-streams-you-discover)
- [Two ways to stream a Zarr: pick one](#two-ways-to-stream-a-zarr-pick-one)
- [Worked example: BioImage Archive](#worked-example-bioimage-archive)
- [Adapting to other repositories](#adapting-to-other-repositories)
- [Caveats](#caveats)

---

## Architecture: BioEngine streams, you discover

BioEngine intentionally does **not** wrap repository search APIs. The reason: dataset repositories (BioImage Archive, IDR, EMPIAR, Allen Brain Atlas, OME-Zarr Web, …) each evolve their own schemas, and a wrapper in BioEngine would couple every release to upstream API churn.

Instead, the split is:

| Responsibility | Owner |
|---|---|
| Search / metadata / catalogue queries | **App code** — call the repository's API directly with `httpx` |
| HTTPS-streaming OME-Zarr with byte-range and chunk caching | **Your choice** — see the next section |

Every modern bioimage repository serves OME-Zarr (or plain Zarr) over HTTPS. So one streaming primitive covers all of them. The app just needs the chunk-level URI — which the repository's search response always exposes.

---

## Two ways to stream a Zarr: pick one

You have a choice for the actual streaming layer. Either works on the same URIs.

### Option A — `zarr.open(uri)` via fsspec (vanilla, no BioEngine integration)

```python
# runtime_env.pip = ["zarr>=3.0.8", "fsspec", "aiohttp"]
import zarr
arr = zarr.open(uri, mode="r")
```

- **Pros**: minimal, fully standard Zarr/fsspec stack, no BioEngine-specific knowledge needed.
- **Cons**: each opened store has its own cache (fsspec default is per-filesystem-instance). If multiple apps on the same worker read overlapping chunks, each one re-fetches.

### Option B — `BioEngineDatasets.open_remote_zarr(uri)` (BioEngine-managed)

```python
# runtime_env.pip = ["zarr>=3.0.8"]   # no fsspec / aiohttp needed
import zarr
store = datasets.open_remote_zarr(uri)     # datasets is the injected BioEngineDatasets
arr = zarr.open(store, mode="r")
```

- **Pros**:
    - **One shared LRU chunk cache with a GB budget** across every store opened in the worker process (local datasets + every remote URI). Multiple apps streaming the same image = one network fetch, N readers.
    - **HTTP/2** on by default, plus an explicit `Semaphore(max_concurrent_requests)` cap (env-tunable via `BIOENGINE_DATASETS_ZARR_STORE_CONCURRENT_REQUESTS`).
    - **No new dependency** — `httpx` is already in the worker runtime env.
    - **Token query-param injection** (`?token=...`) for sources that use it, including the BioEngine local data server.
- **Cons**: slightly more BioEngine-specific code in the app.

### When does each pay off?

| Workload | Recommended |
|---|---|
| One-shot read in a script or notebook | **A** — simplest |
| App that reads each chunk exactly once across all callers | **A** — cache doesn't help |
| Multiple deployments on the same worker reading **the same image** (inference + viz, two models on one slide, repeated passes during fine-tuning) | **B** — shared cache eliminates re-fetches |
| Streaming the **local data server's** datasets in the same code path as remote ones | **B** — one client, one cache, one API |
| App where you'd rather not add `fsspec` + `aiohttp` to `runtime_env.pip` | **B** — `httpx` already in worker env |
| App where minimising BioEngine coupling matters more than caching | **A** |

You don't have to pick once and forever — different methods in the same deployment can use different paths. They share nothing except the URI.

---

## Worked example: BioImage Archive

The [BioImage Archive (BIA)](https://www.ebi.ac.uk/bioimage-archive/) exposes a public beta search API for AI-ready datasets and images.

### Endpoints

| Endpoint | Returns |
|---|---|
| `GET https://beta.bioimagearchive.org/search/v1/search/fts?q=<query>&page=<n>&pageSize=<n>` | Study-level hits (full-text search over titles, descriptions, authors, keywords) |
| `GET https://beta.bioimagearchive.org/search/v1/search/fts/image?q=<query>&page=<n>&pageSize=<n>` | Image-level hits with `representation[]` carrying direct `file_uri` links per format (`.ome.zarr`, `.tiff`, `.czi`) |

Both endpoints return Elasticsearch-style JSON. The shape that matters for streaming is on the image-level endpoint:

```json
{
  "hits": {
    "hits": [
      {
        "_source": {
          "accession_id": "S-BIAD3245",
          "size_x": 1037, "size_y": 1037, "size_z": 1, "size_c": 1, "size_t": 1,
          "voxel_physical_size_x": 0.13,
          "voxel_physical_size_y": 0.13,
          "representation": [
            {
              "image_format": ".ome.zarr",
              "file_uri": ["https://livingobjects.ebi.ac.uk/.../image.ome.zarr/0"],
              "total_size_in_bytes": 45528
            },
            { "image_format": ".tiff", "file_uri": ["https://.../image.tiff"] }
          ],
          "image_thumbnail_uri": "https://.../thumb-256.jpg"
        }
      }
    ]
  }
}
```

### Search + stream from an app deployment

```python
import httpx
import zarr
from ray import serve
from hypha_rpc.utils.schema import schema_method
from pydantic import Field

@serve.deployment(
    ray_actor_options={
        "num_cpus": 2,
        "num_gpus": 1,
        "runtime_env": {"pip": ["cellpose>=4.0", "httpx>=0.28", "zarr>=3.0.8"]},
    },
)
class CellposeOnBIA:
    def __init__(self, datasets):
        # 'datasets' is a BioEngineDatasets instance injected by BioEngine.
        self.datasets = datasets

    @schema_method
    async def segment_bia_image(
        self,
        query: str = Field(..., description="BIA search query, e.g. 'HeLa nuclei'"),
        max_results: int = Field(5, description="Maximum images to consider"),
    ) -> dict:
        # 1. Search BIA directly — no BioEngine wrapper involved.
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                "https://beta.bioimagearchive.org/search/v1/search/fts/image",
                params={"q": query, "page": 1, "pageSize": max_results},
            )
            r.raise_for_status()
            hits = r.json()["hits"]["hits"]

        # 2. Filter to images that have an OME-Zarr representation.
        candidates = []
        for h in hits:
            src = h["_source"]
            for rep in src.get("representation", []):
                if rep.get("image_format") == ".ome.zarr" and rep.get("file_uri"):
                    candidates.append({
                        "accession": src["accession_id"],
                        "uri": rep["file_uri"][0],
                        "size": (src.get("size_y"), src.get("size_x")),
                    })
                    break
        if not candidates:
            return {"status": "no_zarr_results", "query": query}

        # 3. Stream the first OME-Zarr — chunks fetch on demand.
        first = candidates[0]
        # ── Option B (BioEngine-managed, shared chunk cache) ──
        store = self.datasets.open_remote_zarr(first["uri"])
        # ── Option A (vanilla zarr+fsspec) — drop-in swap; add "fsspec",
        # "aiohttp" to runtime_env.pip and replace the line above with:
        #    store = first["uri"]
        # zarr.open() will then use fsspec's HTTP filesystem directly.
        # See "Two ways to stream a Zarr" above for the trade-off.

        # Move blocking zarr.open + array slicing into a thread; the Ray actor
        # is async and we want to keep the event loop free.
        import asyncio
        img = await asyncio.to_thread(self._fetch_2d, store)

        # 4. Run inference (Cellpose example — import in-method to keep cold start clean).
        from cellpose import models
        model = models.Cellpose(model_type="cyto")
        masks, *_ = model.eval(img, channels=[0, 0])
        return {
            "accession": first["accession"],
            "uri": first["uri"],
            "n_objects": int(masks.max()),
            "image_shape": list(img.shape),
        }

    def _fetch_2d(self, store):
        """Read the resolution-0 array's first 2D slice via standard zarr API."""
        root = zarr.open(store, mode="r")
        # OME-Zarr v0.4 multiscale axes are typically [t, c, z, y, x].
        return root[0, 0, 0, :, :]
```

### Mapping a BIA image URI to the right Zarr depth

BIA OME-Zarrs use the bioformats2raw v0.4 layout, where the URI returned by the search endpoint (`…/image.ome.zarr/0`) points at *series 0* of the layout — itself a multiscale group containing scale levels `0/`, `1/`, `2/`, …. The array `.zarray` lives at `…/image.ome.zarr/0/0/.zarray`.

For most workflows, `zarr.open(store, mode="r")` on the search-result URI gives you the multiscale group; navigate to scale `0` with `root[0]` (Zarr v3 API) or `root["0"]` to get the array.

If you need the raw resolution-0 array directly:

```python
zarr_root = uri.rstrip("/") + "/0"
# Either path:
store = datasets.open_remote_zarr(zarr_root)         # Option B: BioEngine-managed
# or:
arr = zarr.open(zarr_root, mode="r")                 # Option A: fsspec-managed
```

---

## Adapting to other repositories

The pattern is identical for any HTTPS-served Zarr:

| Repository | Search API | OME-Zarr URI field |
|---|---|---|
| BioImage Archive (beta) | `beta.bioimagearchive.org/search/v1/search/fts/image` | `_source.representation[].file_uri[0]` |
| IDR (Image Data Resource) | OMERO JSON API + direct OME-Zarr at `idr.openmicroscopy.org/zarr/...` | per-image direct URL |
| Allen Brain Observatory | dataset manifest CSV + S3 OME-Zarr | per-experiment S3 path |
| Generic OME-Zarr S3 bucket | bucket listing → choose a `.ome.zarr/` prefix | the prefix itself |

In every case the recipe is: agent code calls the repository's API → extracts the OME-Zarr URI → passes it to either `datasets.open_remote_zarr(uri)` (Option B, shared cache) or directly to `zarr.open(uri, mode="r")` (Option A, vanilla fsspec). The URI is the same; pick the streaming layer per the trade-off table above.

---

## Caveats

- **Repository APIs change** — especially beta ones. If a search query stops returning results, check the upstream API docs (the BIA beta path may change before GA). Don't try to "fix" `bioengine.datasets`; the integration point is intentionally outside.
- **Only OME-Zarr (and other HTTPS Zarrs) stream chunk-wise.** Other formats listed in `representation[]` (`.tiff`, `.czi`) require downloading the whole file. If you need them, use `httpx` to download and decode locally — but that breaks the streaming model.
- **Both options are read-only.** Neither `HttpZarrStore` nor `zarr.open(uri)` writes back to remote URIs. Outputs (masks, embeddings, derived images) must be saved through other channels — the local data server's `save_file` for shared artefacts, or your own object storage.
- **Auth scope is narrow.** `open_remote_zarr` accepts an optional `token` appended as `?token=` to chunk URLs (matches the BioEngine local data server pattern). For Bearer-auth or signed-URL repositories you'd need a custom fsspec filesystem (Option A) or a small extension to `HttpZarrStore` (Option B) — open an issue if you hit one.
- **No URL validation.** Both paths assume a well-formed HTTPS Zarr root. A typo or wrong path surfaces as a 404 on the first chunk read, not at `open_*` call time.
