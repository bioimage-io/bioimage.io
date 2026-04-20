# BioEngine Cell Morphology Search Engine

**Service ID**: `bioimage-io/cell-image-search` · **Server**: `https://hypha.aicell.io`

Search 58 million+ single-cell images from the JUMP Cell Painting dataset by morphological
similarity — powered by DINOv2 ViT-B/14 embeddings and FAISS vector search.

## What this skill does

| Task | API method |
|---|---|
| Check service status and index stats | `ping()` |
| Search by image similarity | `search(image_b64, top_k=20)` |
| Get index statistics | `get_index_stats()` |
| List indexed datasets | `list_datasets()` |
| Add JUMP Cell Painting plates | `add_jump_cp_dataset(n_plates=10)` |
| Add Zarr/EM dataset | `add_dataset(name, zarr_url, ...)` |
| Monitor ingestion progress | `get_ingestion_status(session_id)` |
| Stop an ingestion | `stop_ingestion(session_id)` |
| Get all running sessions | `get_active_sessions()` |
| UMAP projection of indexed cells | `get_umap_preview(n_samples=10000)` |
| Project query image onto UMAP | `project_query_onto_umap(image_b64)` |
| Enrich metadata with compound IDs | `enrich_metadata_with_compounds()` |

## Quick start

**Default server**: `https://hypha.aicell.io`
**Service ID**: `bioimage-io/cell-image-search`
**Frontend**: `https://hypha.aicell.io/bioimage-io/view/cell-image-search/?ws_service_id=bioimage-io/cell-image-search`

```python
import base64, asyncio
from pathlib import Path
from hypha_rpc import connect_to_server

server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": "<HYPHA_TOKEN>"})
svc = await server.get_service("bioimage-io/cell-image-search")

# Check status
ping = await svc.ping()
print(ping)  # {status, model, n_cells_indexed, index_type, active_sessions, ...}

# Search by image
image_b64 = base64.b64encode(Path("my_cell.png").read_bytes()).decode()
results = await svc.search(image_b64=image_b64, top_k=20)
for hit in results["results"]:
    print(f"rank={hit['rank']} score={hit['score']:.3f} plate={hit['plate']} compound={hit['compound']}")
```

## Ingestion workflow

Start indexing JUMP Cell Painting data (~5,000 cells per plate):

```python
# Start ingestion (returns immediately with session_id)
result = await svc.add_jump_cp_dataset(
    name="JUMP-CP demo",
    n_plates=10,  # ~50K cells, ~2 hours on 1 A40 GPU
)
session_id = result["session_id"]

# Poll until complete
import asyncio
while True:
    status = await svc.get_ingestion_status(session_id=session_id)
    print(f"{status['n_embedded']:,}/{status['n_total']:,} cells"
          f" · {status['throughput_per_sec']:.1f} cells/s"
          f" · ETA {status['eta_seconds']/60:.0f} min")
    if status["status"] in ("completed", "failed"):
        break
    await asyncio.sleep(30)
```

After ingestion, enrich metadata with JCP2022 compound IDs and control names (DMSO, AMG900, etc.):

```python
result = await svc.enrich_metadata_with_compounds()
print(result)  # {n_enriched, n_unique_compounds, enriched_pct, ...}
```

## Search API details

```python
results = await svc.search(
    image_b64: str,     # base64-encoded PNG/JPG/TIFF (any size, any channels)
    top_k: int = 20,    # 1–100 results
    plow: float = 1.0,  # percentile for contrast stretch (low end)
    phigh: float = 99.0 # percentile for contrast stretch (high end)
)
# Returns:
# {
#   results: [{rank, score, faiss_idx, plate, well, site, source, compound, moa_class,
#              thumbnail_b64, crop_idx, idx}],
#   query_thumbnail_b64: str,   # 224×224 normalized query thumbnail
#   elapsed_ms: float,
#   n_cells_searched: int,
#   top_k: int
# }
```

## UMAP visualization

```python
# Compute/retrieve UMAP projection of indexed cells
umap = await svc.get_umap_preview(
    n_samples=10000,          # max points to plot
    color_by="moa_class",     # "moa_class" or "compound"
    force_recompute=False     # use cached result if available
)
# Returns: {x, y, labels, colors, n_total}
# Use Plotly or matplotlib to scatter-plot x/y colored by labels

# Project a query image onto the UMAP space
pos = await svc.project_query_onto_umap(image_b64=image_b64)
# Returns: {umap_x, umap_y, nearest_score, nearest_compound, nearest_moa}
```

## Metadata schema

Each search result includes:

| Field | Description |
|---|---|
| `rank` | Similarity rank (1 = most similar) |
| `score` | Cosine similarity (0–1) |
| `plate` | JUMP-CP plate measurement ID (e.g. `UL001641__2022-10-04...`) |
| `well` | Well position in row-col format (e.g. `r01c23`) |
| `site` | Field-of-view index within well |
| `source` | JUMP source (e.g. `source_1`) |
| `compound` | JCP2022 compound ID or common name (e.g. `DMSO`, `JCP2022_040345`) |
| `moa_class` | Mechanism of action class (currently `unknown` — requires annotation) |
| `thumbnail_b64` | Base64-encoded 224×224 RGB crop thumbnail |

## Known limitations and gotchas

- **Compound names**: Control compounds (DMSO, dexamethasone, AMG900, etc.) have human-readable names. Non-control compounds show JCP2022 IDs (e.g. `JCP2022_040345`). MOA class is always `unknown` — requires additional annotation not available in public JUMP metadata.
- **Index persistence**: The FAISS index and metadata are stored at `/home/bioengine/apps/cell-image-search/cell_search_data/` on the cluster. Index survives service restarts.
- **Ingestion time**: ~18–20 cells/s on one A40 GPU. 10 plates (~130K cells) ≈ 2 hours. S3 download is the bottleneck, not DINOv2 inference.
- **UMAP cache**: `get_umap_preview()` caches the result at `umap_cache.npz`. Call with `force_recompute=True` to regenerate after new ingestion. `enrich_metadata_with_compounds()` invalidates the cache automatically.
- **Index type thresholds**: <100K cells → `FlatIP` (exact). 100K–5M cells → `IVFFlat`. >5M cells → `IVFPQ`. The threshold check uses the actual embedded count, not the estimated target.
- **Multiple ingestion sessions**: Starting a second ingestion session while one is running will share GPU resources and slow both down. Use `get_active_sessions()` to check before starting.

## Example: phenotypic similarity for drug discovery

```python
# Upload a cell image treated with an unknown compound
import base64
from PIL import Image
import numpy as np

# Load your microscopy image (can be multi-channel TIFF)
img_b64 = base64.b64encode(open("treated_cell.tif", "rb").read()).decode()

results = await svc.search(image_b64=img_b64, top_k=20)

# Analyze compound distribution in top hits
from collections import Counter
compounds = Counter(r["compound"] for r in results["results"] if r["compound"] != "unknown")
print("Top similar compounds:", compounds.most_common(5))
# If hits cluster around one compound, the unknown drug may share its mechanism.
```
