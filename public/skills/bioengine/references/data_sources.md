# BioEngine — Streaming Datasets from Public Repositories

BioEngine apps can stream image data on-demand from any HTTPS-served Zarr (typically OME-Zarr) — no upfront download, no per-host staging. This guide shows how to discover datasets in a public repository, pick a representation, and stream it from inside a Ray Serve actor.

## Contents
- [Architecture: BioEngine streams, you discover](#architecture-bioengine-streams-you-discover)
- [Two ways to stream a Zarr: pick one](#two-ways-to-stream-a-zarr-pick-one)
- [Reading OME-Zarr, wherever it came from](#reading-ome-zarr-wherever-it-came-from)
- [Worked example: BioImage Archive](#worked-example-bioimage-archive)
- [Worked example: OMERO servers (incl. IDR)](#worked-example-omero-servers-incl-idr)
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

### Option B — `HttpZarrStore(base_url=uri)` (BioEngine-managed)

```python
# runtime_env.pip = ["zarr>=3.0.8"]   # no fsspec / aiohttp needed
import zarr
from bioengine.datasets.http_zarr_store import HttpZarrStore

store = HttpZarrStore(base_url=uri)
arr = zarr.open(store, mode="r")
```

Import from the submodule, not `from bioengine.datasets import ...` — the package's `__getattr__` delegates unknown names to the data-server singleton and will fail in an app that has no data server configured.

- **Pros**:
    - **One shared LRU chunk cache with a GB budget** across every store opened this way in the worker process. Multiple apps streaming the same image = one network fetch, N readers. To put remote URIs on the *data server's* cache budget instead of the process-wide default, pass `chunk_cache=bioengine.datasets.chunk_cache`.
    - **HTTP/2** on by default, plus an explicit `Semaphore(max_concurrent_requests)` cap (env-tunable via `BIOENGINE_DATASETS_ZARR_STORE_CONCURRENT_REQUESTS`).
    - **No new dependency** — `httpx` is already in the worker runtime env.
    - **Bearer-token auth** — an optional `token=` is sent as an `Authorization: Bearer` header on every chunk request. It cannot be a query param: zarr appends `/{key}` to `base_url`, so a query string would end up in the middle of the URL.
- **Cons**: slightly more BioEngine-specific code in the app.

Local BioEngine datasets return this same store type from `bioengine.datasets.get_file(...)` — see the next section.

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

## Reading OME-Zarr, wherever it came from

Once you hold a store, the source stops mattering: a zarr store from a public repository, from a BioEngine dataset, or from a local directory is consumed by exactly the same code.

### Navigate the multiscale metadata, don't hard-code the layout

An OME-Zarr root is a group whose attributes declare its own pyramid. Read the declaration rather than assuming `0` is the full-resolution array or that the axes are `[t, c, z, y, x]` — both vary between datasets and between NGFF versions.

```python
import zarr

group = zarr.open_group(store, mode="r")
multiscales = group.attrs["ome"]["multiscales"]   # NGFF v0.5; top-level "multiscales" in v0.4
level0 = group[multiscales[0]["datasets"][0]["path"]]
patch = level0[0, 0, 0, 512:1024, 512:1024]       # only these chunks transfer
```

The axis order for that slice comes from `multiscales[0]["axes"]`. HCS plates follow the same rule one level up: `group.attrs["ome"]["plate"]["wells"][i]["path"]` gives each well's group path.

For anything past reading pixels at a known level — physical scale (µm/px), picking a level by resolution, or **writing** OME-Zarr — add [`ngff-zarr`](https://pypi.org/project/ngff-zarr/) to `pip`. It takes any zarr store, handles NGFF v0.1–v0.6 uniformly, and hands back dask arrays:

```python
import ngff_zarr

multiscales = ngff_zarr.from_ngff_zarr(store)
image = multiscales.images[0]
print(image.dims, image.scale)          # ('t','c','z','y','x'), {'x': 0.325, ...}
patch = image.data[0, 0, 0].compute()   # dask → streams only the chunks it needs
```

### Local, access-controlled datasets

Data served by the worker's own data server is reached through `bioengine.datasets`, a process-local singleton — no constructor injection, nothing to wire up:

```python
import bioengine

store = await bioengine.datasets.get_file("blood-atlas", file_path="image.ome.zarr")
```

`get_file` returns an `HttpZarrStore` for any `.zarr` path (raw `bytes` for anything else), so the navigation code above is unchanged.

**Know which identity is being checked.** With no `token=`, the client sends the *app's* Hypha token as a Bearer header, and the data server authorizes that token against the dataset's `authorized_users`. The question answered is "may this app read it", not "may the caller read it". That is correct when your app owns the data it serves, and it is a confused deputy the moment a caller chooses `dataset_id` — any caller can then name any dataset the app can reach. In that case, either check the caller's own permissions first (a `context=True` method receives `context["user"]["scope"]["workspaces"]`, a map of workspace to permission letter) or have the caller supply their token and forward it: `get_file(dataset_id, file_path, token=...)`. An unauthorized token gets a 403; a missing or invalid one, a 401.

`bioengine.datasets.list_datasets()` and `list_files(dataset_id, dir_path=..., recursive=...)` cover discovery when you don't already know the path.

### Plain (non-OME) Zarr hierarchies need listing

OME-Zarr declares every child path in its metadata, so reading one never enumerates the store. A plain zarr group declares nothing — the only way to learn what is in it is to list it, and that requires a store that can enumerate keys:

```python
store = await bioengine.datasets.get_file("blood-atlas", file_path="unknown.zarr")
group = zarr.open_group(store, mode="r")

print(sorted(group.array_keys()))   # ['alpha', 'beta']
print(sorted(group.group_keys()))   # ['nested']
```

Listing is backed by the data server's file-catalog route, so it works only for stores obtained from `get_file` (bioengine ≥ 0.16.0). A store built directly on an external HTTPS root reports `supports_listing = False` and raises on the listing methods — plain HTTP has no `readdir`. If you need to explore a remote root, reach it through Option A with `fsspec`/`s3fs`, which can list because the underlying protocol can.

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
import bioengine
import httpx
import zarr
from pydantic import Field

@bioengine.app(
    num_cpus=2,
    gpu_memory_mb=8192,
    pip=["cellpose>=4.0", "httpx>=0.28", "zarr>=3.0.8"],
)
class CellposeOnBIA:
    @bioengine.method
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
        from bioengine.datasets.http_zarr_store import HttpZarrStore
        store = HttpZarrStore(base_url=first["uri"])
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
        """Read the full-resolution array's first 2D slice via standard zarr API."""
        group = zarr.open_group(store, mode="r")
        ms = group.attrs.get("ome", group.attrs)["multiscales"]
        level0 = group[ms[0]["datasets"][0]["path"]]
        # BIA axes are typically [t, c, z, y, x]; confirm via ms[0]["axes"].
        return level0[0, 0, 0, :, :]
```

### Mapping a BIA image URI to the right Zarr depth

BIA OME-Zarrs use the bioformats2raw v0.4 layout, where the URI returned by the search endpoint (`…/image.ome.zarr/0`) points at *series 0* of the layout — itself a multiscale group containing scale levels `0/`, `1/`, `2/`, …. The array `.zarray` lives at `…/image.ome.zarr/0/0/.zarray`.

For most workflows, `zarr.open(store, mode="r")` on the search-result URI gives you the multiscale group; navigate to scale `0` with `root[0]` (Zarr v3 API) or `root["0"]` to get the array.

If you need the raw resolution-0 array directly:

```python
zarr_root = uri.rstrip("/") + "/0"
# Either path:
store = HttpZarrStore(base_url=zarr_root)            # Option B: BioEngine-managed
# or:
arr = zarr.open(zarr_root, mode="r")                 # Option A: fsspec-managed
```

---

## Worked example: OMERO servers (incl. IDR)

[OMERO](https://www.openmicroscopy.org/omero/) is the image-server framework that many imaging facilities run. The [Image Data Resource (IDR)](https://idr.openmicroscopy.org/) is the largest public OMERO instance. Public OMERO deployments increasingly expose their images as OME-Zarr alongside the native OMERO API, which means the same streaming primitives used for BIA also work here. No ICE C++ client needed.

### Three access paths, in recommended order

| Path | When to use | What it needs |
|---|---|---|
| **OME-Zarr export over HTTPS** (recommended) | Primary pixel access for inference, viz, analysis | Just the Zarr root URL. Same `zarr.open(uri)` / `HttpZarrStore(base_url=uri)` you already use. |
| **OMERO web JSON API** (`/api/v0/m/...`) | Metadata discovery: project / dataset / image listings, channels, ROIs, map-annotations | HTTPS + optional `X-OMERO-Session-Key` for private servers. Public projects on IDR need no auth. |
| **`omero-py` / BlitzGateway** | Last resort, only when neither of the above covers what you need | OS-level dependencies on the Ice C++ library; see the caveat below. |

The first two cover ~all bioimage workflows on IDR and on any modern OMERO deployment that runs the [omero-ms-zarr](https://github.com/glencoesoftware/omero-ms-zarr) microservice or has otherwise published OME-Zarr exports. Reach for the third path only when you genuinely need primary-pixel access to a non-zarr-exported OMERO server.

### IDR discovery: the OME-NGFF samples catalogue

IDR curates a public CSV of every image that has been re-exported as OME-Zarr. It is the single most reliable way to discover IDR Zarr URLs:

| Endpoint | Returns |
|---|---|
| `GET https://raw.githubusercontent.com/IDR/ome-ngff-samples/main/_data/table.csv` | One row per OME-Zarr export. Columns: `OME-NGFF version`, `File Path` (the absolute HTTPS Zarr root URL), `SizeX/Y/Z/C/T`, `Axes`, `License`, `Study`, `Representative Image ID`, `Thumbnail`. |
| Human-readable browser view | https://idr.github.io/ome-ngff-samples/ |

Most rows now live at `https://livingobjects.ebi.ac.uk/idr/zarr/v<ver>/idr<study>A/<image>.zarr`; older entries used `https://uk1s3.embassy.ebi.ac.uk/idr/zarr/...`. Both hosts serve byte-range-able Zarr.

### IDR JSON API for metadata (no auth on public projects)

Independent of the Zarr catalogue, the OMERO JSON API on `https://idr.openmicroscopy.org/api/v0/` lets you walk the project/dataset/image hierarchy programmatically. Useful when you have an image name or study accession and want to map it to an image id, or when you want channel / ROI metadata.

| Endpoint | Returns |
|---|---|
| `GET /api/v0/m/projects/?limit=N&offset=M` | Studies (paginated). `data[].@id` is the project id; `data[].Name` looks like `idr0018-...` mapping back to the IDR accession. |
| `GET /api/v0/m/projects/<id>/datasets/?limit=N` | Datasets in a study. |
| `GET /api/v0/m/datasets/<id>/images/?limit=N` | Images in a dataset. `data[].@id` is the OMERO image id. |
| `GET /api/v0/m/images/<id>/` | Pixel metadata, channel info, links to ROIs. Does **not** carry the OME-Zarr URL directly. |

If you need the Zarr URL for an arbitrary IDR image id, the canonical path is to filter `_data/table.csv` by `Representative Image ID` (or by `Study`).

### Search + stream from an app deployment

```python
import bioengine
import csv, io, httpx, zarr
from pydantic import Field

@bioengine.app(
    num_cpus=2,
    gpu_memory_mb=8192,
    pip=[
        "cellpose>=4.0",
        "httpx>=0.28",
        "zarr>=3.0.8",
        "numpy==1.26.4",  # match the worker's numpy ABI to avoid Zarr import-time crashes
    ],
)
class CellposeOnIDR:
    @bioengine.method
    async def segment_idr_image(
        self,
        study: str = Field("idr0062", description="IDR study accession, e.g. 'idr0062'"),
        ngff_version: str = Field("0.4", description="OME-NGFF version row to filter to"),
    ) -> dict:
        # 1. Pull the IDR OME-NGFF samples catalogue (CSV; ~16 KB) and filter.
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                "https://raw.githubusercontent.com/IDR/ome-ngff-samples/main/_data/table.csv"
            )
            r.raise_for_status()
            rows = list(csv.DictReader(io.StringIO(r.text)))
        matches = [
            row for row in rows
            if row["Study"] == study and row["OME-NGFF version"] == ngff_version
        ]
        if not matches:
            return {"status": "no_match", "study": study, "ngff_version": ngff_version}

        # 2. Take the first matching Zarr URL.
        first = matches[0]
        uri = first["File Path"]

        # 3. Stream the OME-Zarr. Option B (BioEngine-managed, shared cache):
        from bioengine.datasets.http_zarr_store import HttpZarrStore
        store = HttpZarrStore(base_url=uri)
        # Option A (vanilla zarr+fsspec): replace the line above with `store = uri`
        # and add "fsspec", "aiohttp" to runtime_env.pip. See "Two ways to stream a Zarr".

        # Move blocking zarr.open + slicing off the event loop.
        import asyncio
        img = await asyncio.to_thread(self._fetch_2d, store)

        # 4. Run inference (Cellpose example; import in-method to keep cold start clean).
        from cellpose import models
        model = models.Cellpose(model_type="cyto")
        masks, *_ = model.eval(img, channels=[0, 0])
        return {
            "study": study,
            "image_id": first["Representative Image ID"],
            "uri": uri,
            "n_objects": int(masks.max()),
            "image_shape": list(img.shape),
        }

    def _fetch_2d(self, store):
        """Open the multiscale group and read a 2D slab from scale 0."""
        root = zarr.open(store, mode="r")
        # IDR OME-NGFF v0.4 axes are typically (c, z, y, x) or (t, c, z, y, x);
        # navigate to scale-0 by name and pick the first 2D plane.
        arr = root["0"]
        if arr.ndim == 5:
            return arr[0, 0, 0, :, :]
        if arr.ndim == 4:
            return arr[0, 0, :, :]
        return arr[:]
```

The same code path with most other accessions in the catalogue (`idr0047`, `idr0054`, `idr0101`, `idr0138`, ...) Just Works. The URI is opaque to the inference logic.

### Mapping an IDR Zarr URI to scale 0

IDR OME-Zarr exports follow the same multiscale layout as BIA: the URL in the `File Path` column points at the multiscale **group**, with scale arrays at `0/`, `1/`, `2/` underneath. Either of these gets you the scale-0 array:

```python
root = zarr.open(uri, mode="r")
arr  = root["0"]                          # navigate by name (works for v0.4 and v0.5)

# Or, equivalently, open the array directly:
arr  = zarr.open(uri.rstrip("/") + "/0", mode="r")
```

For HCS plate layouts (v0.4 entries with `Wells` populated), the layout is well/field-of-view nested; consult the [OME-NGFF HCS spec](https://ngff.openmicroscopy.org/0.4/#hcs-layout) for the path under the plate root.

### IDR Zarr gotchas worth knowing about

A handful of catalogue entries fail to open with current `zarr>=3.0.8`. None of these are bugs in your code; they are quirks of the upstream export:

1. **Big-endian dtypes (`>u1`, `>u2`) in older v0.4 exports.** Zarr v3 raises `ValueError: No Zarr data type found that matches {'name': '>u1', ...}`. Observed on `idr0073A` and similar early conversions. Pick a different study or pin to `zarr>=3.1,<3.2` only if the upstream fix lands.
2. **Bioformats2raw nested layout.** A few older entries (e.g. `idr0001A/2551.zarr`, `idr0013A/3451.zarr`, `idr0056B/7361.zarr`) put the multiscale group one level deeper, so `root["0"]` raises `KeyError: '0'`. Open `uri + "/0"` instead. Same gotcha already noted for the BioImage Archive layout above.
3. **Plate / collection roots.** Some entries (`idr0079A/idr0079_images.zarr`, `idr0048A/9846151.zarr/`) resolve to a Group of sub-images rather than a multiscale image. `root.ndim` raises `AttributeError`. Walk `root.group_keys()` to pick a child image, then take its `["0"]`.

If your discovery code needs to be robust to all 100+ catalogue entries, wrap `root["0"]` in a try/except for the first two cases, and fall back to `list(root.group_keys())` for the third.

### OMERO authentication

Public IDR endpoints (everything under `https://idr.openmicroscopy.org/api/v0/m/...` and the Zarr URLs in the catalogue) need no authentication. Calls from inside a Ray actor go straight through.

**Private OMERO servers** (institutional or lab instances) speak the same JSON API behind a session login:

```python
import httpx

async def omero_session(host: str, username: str, password: str) -> tuple[httpx.AsyncClient, str]:
    """Log into a private OMERO server and return a client primed with the session token."""
    client = httpx.AsyncClient(base_url=host, timeout=30, follow_redirects=True)
    # 1. Fetch CSRF token (issued as a cookie).
    await (await client.get("/api/v0/token/")).raise_for_status()
    csrf = client.cookies["csrftoken"]
    # 2. Login. Server returns sessionid in cookies plus an "eventContext" object.
    r = await client.post(
        "/api/v0/login/",
        data={"username": username, "password": password, "server": "1"},
        headers={"X-CSRFToken": csrf, "Referer": host},
    )
    r.raise_for_status()
    session_key = r.json()["eventContext"]["sessionUuid"]
    # 3. All subsequent calls include the session key explicitly.
    client.headers["X-OMERO-Session-Key"] = session_key
    return client, session_key
```

`X-OMERO-Session-Key` then authorises both subsequent JSON-API calls and, if the deployment runs `omero-ms-zarr`, the Zarr chunk URLs. The session key behaves like a bearer token for the lifetime of the OMERO session, but it travels in its own `X-OMERO-Session-Key` header, and `HttpZarrStore(token=...)` only ever sends `Authorization: Bearer`. So Option B carries it only for a microservice that also accepts the standard Bearer header. For header-named or cookie-based Zarr microservices, use Option A with a custom `httpx`/`fsspec` client; open a feedback report if you hit one.

### Caveat: `omero-py` and the Ice C++ dependency

`omero-py` (the official Python client, including `omero.gateway.BlitzGateway`) does not ship a pure-Python wheel. It depends on the [ZeroC Ice](https://zeroc.com/ice) C++ runtime via the `zeroc-ice` Python bindings, which is notoriously brittle across glibc versions and Linux distributions. Wheels are not available on PyPI for every Python/glibc combination, and source-building Ice inside a Ray actor's `runtime_env.pip` will fail on most worker images.

Symptoms when this goes wrong: `pip install omero-py` hangs for minutes during Ice compilation, then dies with a C++ error mentioning `Ice.h` or `slice2py`; or the install succeeds but `import omero` raises `ImportError: libIce.so.X.Y: cannot open shared object file`.

If you genuinely need primary-pixel access to a non-zarr OMERO instance, do it outside the BioEngine app: fetch the data once on a host that already has Ice installed, re-publish as OME-Zarr on any HTTPS-reachable bucket, then stream from BioEngine the normal way. Treat `omero-py` inside a deployment's `runtime_env` as a last resort and expect to pin the worker's base image to match the Ice wheel.

---

## Adapting to other repositories

The pattern is identical for any HTTPS-served Zarr:

| Repository | Search / discovery API | OME-Zarr URI field |
|---|---|---|
| BioImage Archive (beta) | `beta.bioimagearchive.org/search/v1/search/fts/image` | `_source.representation[].file_uri[0]` |
| IDR (Image Data Resource) | OME-NGFF samples CSV at `raw.githubusercontent.com/IDR/ome-ngff-samples/main/_data/table.csv` + JSON API at `idr.openmicroscopy.org/api/v0/m/...`. See [Worked example: OMERO servers](#worked-example-omero-servers-incl-idr). | `File Path` column in the catalogue |
| Other OMERO servers | omero-ms-zarr export URL + `/api/v0/m/...` JSON API (optionally with `X-OMERO-Session-Key`). See [Worked example: OMERO servers](#worked-example-omero-servers-incl-idr). | per-image direct URL |
| Allen Brain Observatory | dataset manifest CSV + S3 OME-Zarr | per-experiment S3 path |
| Generic OME-Zarr S3 bucket | bucket listing, then choose a `.ome.zarr/` prefix | the prefix itself |

In every case the recipe is: agent code calls the repository's API, extracts the OME-Zarr URI, and passes it to either `HttpZarrStore(base_url=uri)` (Option B, shared cache) or directly to `zarr.open(uri, mode="r")` (Option A, vanilla fsspec). The URI is the same; pick the streaming layer per the trade-off table above.

---

## Caveats

- **Repository APIs change** — especially beta ones. If a search query stops returning results, check the upstream API docs (the BIA beta path may change before GA). Don't try to "fix" `bioengine.datasets`; the integration point is intentionally outside.
- **Only OME-Zarr (and other HTTPS Zarrs) stream chunk-wise.** Other formats listed in `representation[]` (`.tiff`, `.czi`) require downloading the whole file. If you need them, use `httpx` to download and decode locally — but that breaks the streaming model.
- **Both options are read-only.** Neither `HttpZarrStore` nor `zarr.open(uri)` writes back to remote URIs. Outputs (masks, embeddings, derived images) must be saved through other channels — the local data server's `save_file` for shared artefacts, or your own object storage.
- **Auth scope is narrow.** `HttpZarrStore` accepts an optional `token` and sends it as `Authorization: Bearer` on every chunk request — nothing else. Repositories that want a differently-named header, a cookie, or signed URLs need a custom fsspec filesystem (Option A) — open an issue if you hit one.
- **No URL validation.** Both paths assume a well-formed HTTPS Zarr root. A typo or wrong path surfaces as a 404 on the first chunk read, not at `open_*` call time.
