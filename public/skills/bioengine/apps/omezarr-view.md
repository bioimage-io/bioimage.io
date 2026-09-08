# BioEngine OME-Zarr View

**Service ID**: `bioimage-io/omezarr-view` · **Server**: `https://hypha.aicell.io`
**HTTP base**: `https://hypha.aicell.io/bioimage-io/apps/omezarr-view:omezarr-view`

Serve existing image files — OME-TIFF, CZI, and anything else BioIO reads — as lazy OME-Zarr views, **without converting them**. Storage format and access format are separate problems: an archive can stay CZI and OME-TIFF while the access layer speaks OME-Zarr, because a **view** answers Zarr requests by reading the original file on demand.

The reference implementation is [`apps/omezarr-view`](https://github.com/aicell-lab/bioengine/tree/main/apps/omezarr-view) in the BioEngine repo. Read it before writing a new one — everything below is already implemented and measured there, including the failure modes, and most tasks are a config change rather than new code.

## Use this skill when

- The user wants their existing images "AI-ready" or web-viewable and does **not** want to migrate the archive to OME-Zarr.
- You need an OME-Zarr URL to hand to Vizarr, Neuroglancer, `ome-zarr-py`, a training loader, or an annotation UI, and all you have is an OME-TIFF or a CZI.
- You need a **derived view** — rescaled to a target physical spacing, channel-selected, dtype-normalised — shaped to what a model wants to be fed.
- You are writing or reviewing a claim about what a view preserves from the source. §§ *The claim boundary* and *Falsify your own generated report* are the load-bearing parts of this page.

Not this skill: running inference (see [model-runner](model-runner/model-runner.md)), or fetching public OME-Zarr datasets that already exist as OME-Zarr (see [references/data_sources.md](../references/data_sources.md)).

## This app is ASGI, not RPC

Viewers fetch Zarr chunks and image tiles over plain `GET`, so the app registers with Hypha as an **ASGI service** rather than a set of RPC methods. Hypha fronts it at a normal URL that a browser, Vizarr, Neuroglancer or a Python client uses unchanged:

```
https://hypha.aicell.io/bioimage-io/apps/omezarr-view:omezarr-view
```

The only RPC method is `get_service_url()`, for clients that have an RPC handle and want the HTTP base:

```python
from hypha_rpc import connect_to_server

server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": "<HYPHA_TOKEN>"})
svc = await server.get_service("bioimage-io/omezarr-view")
info = await svc.get_service_url()
# {'service_url': 'https://hypha.aicell.io/bioimage-io/apps/omezarr-view:omezarr-view', ...}
```

Everything else is HTTP, and the public datasets need no token:

```bash
BASE=https://hypha.aicell.io/bioimage-io/apps/omezarr-view:omezarr-view
curl -sSL "$BASE/api/datasets"                    # catalog
curl -sSL "$BASE/api/datasets/idr0106"            # one dataset; builds the view if needed
curl -sSL "$BASE/zarr/idr0106/.zattrs"            # the OME-Zarr store
```

The client id is pinned (`OMEZARR_VIEW_CLIENT_ID`, default `omezarr-view`) precisely so this URL survives a redeploy — a random per-replica id would change it every time.

## Endpoints

| route | purpose |
|---|---|
| `GET /` | catalog page |
| `GET /annotate` | worked annotation UI (OpenLayers tiles + draw tools) |
| `GET /api/datasets` | catalog as JSON (protected entries redacted) |
| `GET /api/datasets/{id}` | one dataset; builds the view if needed |
| `GET /api/datasets/{id}/reference.json` | byte-offset index, where the recipe has one |
| `GET /api/datasets/{id}/thumbnail.png` | RGB composite of a coarse level |
| `GET /api/datasets/{id}/tilegrid.json` | tile size, `resolutions[]`, non-spatial axes, channels |
| `GET /tiles/{id}/{zoom}/{x}/{y}.png?z=&t=&channels=0,2` | rendered RGB tiles for map libraries |
| `GET /api/datasets/{id}/annotations` · `PUT …` | GeoJSON `FeatureCollection` beside the catalog |
| `GET /zarr/{id}/{key}` | the OME-Zarr store |
| `GET /t/{token}/zarr/{id}/{key}` | same, with the token in the path |
| `GET /health` | status and chunk-cache stats |

## Decide the recipe first

| source | recipe | why |
|---|---|---|
| tiled TIFF / OME-TIFF, local **or remote** | **reference index** | each Zarr chunk maps to a byte range; nothing is decoded to build it, and a client can read the original directly |
| CZI, LIF, ND2, LSM, … (**local only**) | **BioIO reader** | no addressable chunk layout exists, so every read goes through the reader |
| anything, but reshaped for a consumer | **derived view** on top of either | computed per request: rescale, channel-select, normalise |

`open_view(id, source, recipe="auto")` tries the reference index first and falls back to BioIO. Views are built on **first request, not at startup** — indexing a deep pyramid means walking its whole IFD chain, which a catalog of many files must not do eagerly.

## Point it at your own data

Deploy the artifact with your own `datasets.yaml`, or run the server standalone. The app needs `hypha_token` on deploy: the replica registers its own ASGI service, and `__init__` raises without it.

```python
app_id = await worker.deploy_app(
    artifact_id="bioimage-io/omezarr-view",
    application_id="omezarr-view",
    version="0.2.4",
    hypha_token="<HYPHA_TOKEN>",
)
```

```yaml
sources:
  - type: local_dir            # every readable image under a folder
    path: /mnt/archive/imaging

  - type: remote_files         # explicit URLs (buckets often deny listing)
    files:
      - url: https://example.org/scan.ome.tif

  - type: remote_prefix        # listed, where the bucket allows it
    url: s3://my-bucket/imaging/
    anonymous: true

  - type: files                # access-controlled entries
    token_env: MY_TOKEN        # fails closed if the variable is unset
    files:
      - path: ./private/study.czi

  - type: derived              # computed, not re-addressed
    views:
      - id: my-training-view
        from: my-raw-dataset       # any dataset id above
        target_spacing_um: 10.0    # or target_scale: 0.5
        channels: [DAPI, GFP]      # names or indices; omit to keep all
        dtype: uint8               # uint8 | uint16 | float32
        normalise: percentile      # percentile | none
```

**Access control.** Give a dataset a `token` (or `token_env`) and every route refuses without it — metadata, chunks, thumbnail, and the catalog entry, which is reduced to a stub. **The dataset id is public even when the dataset is not**: every route needs it, and `local_dir` / `remote_prefix` derive ids from filenames, so `patient_042_HER2_biopsy.czi` becomes the public id `patient-042-her2-biopsy`. Set an explicit `id:` for anything sensitive.

## The claim boundary — get this right or the work is worthless

- **"No conversion" holds for everything here.** The original file is never migrated, rewritten, or copied.
- **"Zero-copy" holds only for the reference index consumed directly** — the client takes `/api/datasets/{id}/reference.json` and range-reads the original itself, with no server in the data path. That path needs `imagecodecs` client-side, because the chunks are still in the source's codec.
- **The served HTTP endpoint is not zero-copy.** It transcodes each chunk, because no browser Zarr implementation has an LZW codec. Bytes pass through.
- **A derived view is never zero-copy.** Its pixels are computed. Label it `computed_product` and state its transform chain.

## Falsify your own generated report against the source

The report is quoted verbatim in publications, so an unchecked claim in it is a falsehood rather than a rough edge. Before publishing any view's mapping, open the source metadata yourself and try to prove the report wrong. A fresh-agent exam of this material found **three separate false "not declared in the source" lines** that had survived review, plus two fields dropped with no line at all.

Two rules, and make the code enforce them rather than trusting care:

1. **"Not declared" is only sayable if you looked.** Track which fields the extractor actually inspected. Anything it never examined is "not read by this recipe, so its presence is unknown" — a different and honest claim.
2. **Every dropped field appears in one list or the other.** An undisclosed loss is worse than a disclosed one, because the reader has no way to know to ask. Keep an explicit roster of droppable fields and assert each is accounted for.

Concrete traps, all of which shipped here at least once:

- **Colour read on neither path.** OME `Channel Color` is a signed 32-bit RGBA int; CZI uses `#AARRGGBB`. Normalise in ONE place — converting in both the extractor and the builder made the second pass reject its own output and 43 declared colours came out as "not declared".
- **A field populated on one recipe and not the other.** `acquisition_date` was read by the reference path and never by the BioIO path, so the BioIO report carried a guaranteed false claim on any dated source.
- **The time axis.** Iterating `("x", "y", "z")` for physical sizes drops a declared `TimeIncrement` silently, and the view then serves `t` with scale 1.0 and no unit. It also makes Neuroglancer open on a t–z cross-section.
- **Bit depth versus container width.** A 14-bit camera in a uint16 container published `window.max = 65535`, four times the real full scale. Read `SignificantBits` / `ComponentBitCount`, and say so when you cannot.
- **A late override that re-asserts absence.** A display-window helper that rewrote its own not-mapped line kept saying "not declared" after the extractor had learned to read the declaration.
- **Scenes and series.** A multi-scene CZI or multi-series OME-TIFF is served as its first, silently, unless the report names scenes present versus served. Announce it only when there is a real choice; "scene X of 1" on every file is noise that buries the case that matters.

## Metadata: generate the report, never write it by hand — then falsify it

Each view emits `metadata_mapping.mapped` / `.not_mapped` and a prose `caption` on `GET /api/datasets/{id}`. Quote those verbatim; do not paraphrase into a sentence, because a paraphrase drifts from what the code did. When this was first written as prose it immediately exposed a false claim (see gotcha 6).

Usually mapped: dimensions and axis order, physical pixel sizes with units, channel names, dtype, pyramid levels with true scale factors, acquisition date. Usually **not** mapped: channel colours, display windows, objective/instrument, stage position, plate/well context, ROIs.

**Quoting it verbatim is necessary and not sufficient.** The report is generated, so it is faithful to what the code did — but it is not evidence about what the *file* declared, and those come apart. Before you stand behind a view, open the source's own metadata and check **every `not_mapped` line that claims "not declared in the source"** against it. Two runs against real files found four such lines, all false:

| view said | file actually declared |
|---|---|
| channel colours: not declared | `Color` on all 43 OME `<Channel>`s; 34/43 then rendered in a palette colour the acquisition did not choose |
| channel colours: not declared | `DisplaySetting/Channels/Channel/Color` per channel in a CZI |
| acquisition date: not declared | `Information/Image/AcquisitionDateAndTime` in a CZI |
| display windows: not declared | `DisplaySetting/Channels/Channel/High`, normalised against `BitCountRange` |

The mechanism is always the same and is easy to reproduce: an extractor reads a subset of the fields, and `build_ngff_attrs` emits the disclaimer unconditionally without asking whether the extractor even looked. On the BioIO path `_source_metadata()` never populates `acquisition_date` at all, so that line **cannot** be true for any file that has one.

Two consequences for how you write the report and the code:

- **`"not mapped by this recipe"` is the phrasing that survives an unseen file. `"not declared in the source"` is a claim about someone else's data and needs evidence you usually do not have.** The same module already gets this right for objective, stage position, plate/well and ROIs — and wrong for exactly the fields where it guessed. Prefer the recipe-scoped wording unless you have parsed the source and can point at the absence.
- **A field the mapping mentions in neither list is worse than a wrong disclaimer.** A CZI declaring `Information/Image/Dimensions/T/Positions/Interval/Increment = 2.526` was served with `t` scale `1.0` and no unit, and nothing in `mapped` or `not_mapped` said so, because the size loop iterates only `("x","y","z")`. Silent loss reads as completeness. It also has downstream teeth: it is what makes Neuroglancer render that view as a grey rectangle (see § Neuroglancer). Same for `ComponentBitCount 14` under a `uint16` container, where the view publishes `window.max 65535` — four times the real full scale.

Read the source metadata directly for this; do not ask the view. For OME-TIFF that is `tifffile.TiffFile(...).ome_metadata`; for CZI, `BioImage(...).metadata` is the acquisition's own XML tree.

## Consumers — all verified against this implementation

### Vizarr (viewing)

`https://hms-dbmi.github.io/vizarr/?source=<zarr_url>`. Works with no special-casing. Reads the `omero` block, so channel names and contrast come out right.

### Vizarr fork with annotation (oeway/vizarr)

<https://github.com/oeway/vizarr>, hosted at <https://oeway.github.io/vizarr/>, API documented in that repo's `api.md`. Use it when you want annotation inside Vizarr itself rather than a separate UI. Two access modes:

- **Hypha Core in an iframe** — `const vizarr = await api.getService("vizarr")`, then `vizarr.addImage({source})`, `vizarr.add_shapes(shapes, opts)`.
- **Standalone** — `window.annotationController` exposes the layers directly.

Annotation surface: `add_shapes(shapes, {name, shape_type, label, edge_color, face_color, edge_width})` where `shape_type` is `polygon | path | rectangle`; `get_layers()`, `get_layer(id)`, `remove_layer(id)`; and per layer `get_features()` / `set_features(features)` in **GeoJSON**. Persist those features to your own store — see § Annotation storage.

### Neuroglancer (viewing, second independent client)

`https://neuroglancer-demo.appspot.com/#!<url-encoded state JSON>` with `{"layers":[{"type":"image","source":"zarr://<zarr_url>"}],"layout":"xy"}`. Supports zarr v2, NGFF 0.4 multiscale, and the `blosc | gzip | zlib | zstd | raw` compressors. It reads the NGFF axes and scales — the physical pixel sizes show up in its UI, which makes it good evidence the mapping is standard.

**It does not read the OME `omero` block**, so 16-bit data opens near black. Pass the measured window explicitly: `layer.shaderControls = {normalized: {range: [start, end]}}`. Do not set `crossSectionScale` unless you know the right value — the default framing fits, and a wrong value renders uniform background grey.

**For any view with a `t` axis, also pin `dimensions` with the spatial axes first.** Neuroglancer takes the **first three non-channel dimensions of the coordinate space** as its display dimensions. NGFF's canonical order is `t,c,z,y,x`, so left to itself it picks **t, z, y** and opens on a t–z cross-section. On a 3×5×256×256 CZI view that is a hugely magnified 3×5 grid: a flat grey rectangle, **with every chunk fetched and returned 200**, no error in the console and nothing wrong on the server. A `CYX` view never shows this, so it will not appear until the first file with a time axis.

```json
{"dimensions": {"x": [1e-7, "m"], "y": [1e-7, "m"], "z": [1e-6, "m"],
                "t": [2.526, "s"], "c^": [1, ""]},
 "position": [128, 128, 2.5, 1.5, 0.5],
 "layers": [{"type": "image", "name": "view", "source": "zarr://<zarr_url>",
             "opacity": 1.0,
             "shaderControls": {"normalized": {"range": [1208.0, 16383.0]}}}],
 "layout": "xy"}
```

Order the `dimensions` keys `x, y, z` before `t`; suffix the channel dimension `c^`. Nothing else needs overriding — `displayDimensions` at the top level had no effect in the deployed viewer, and giving `t` a seconds unit while leaving it first did not help either. It is the **ordering** that decides.

**The override is required even when the view's own `t` axis is correct.** An earlier version of this section guessed the opposite — that a `t` axis published with scale `1.0` and no unit was what made Neuroglancer treat it as a display axis, so fixing the mapping would make the override unnecessary. That guess has since been tested and is **wrong**. Against a view publishing `t` as scale `2.526`, unit `second`, the minimal state still fetched five chunks with status 200 and painted the same flat grey frame (`central_distinct_levels` 8); the same view with `x, y, z` ordered ahead of `t` fetched one chunk and rendered (256 levels). Neuroglancer picks by **position in the coordinate space, not by unit**, so a correct mapping does not rescue it. Pass the override on every view with a `t` axis, and treat a metadata fix and this override as two separate obligations.

### OpenLayers / Leaflet and custom annotation UIs (tiles)

Map libraries want RGB image tiles, not Zarr chunks. `omezarr_view/tiles.py` renders them on demand from the same lazy view:

- `GET /api/datasets/{id}/tilegrid.json` — width, height, tile size, `resolutions[]` (coarsest first), the non-spatial axes and their sizes, and the channel list with colours and windows.
- `GET /tiles/{id}/{zoom}/{x}/{y}.png?z=&t=&channels=0,2`

Build an `ol.tilegrid.TileGrid` from `resolutions` and use a pixel projection with `extent = [0, -height, width, 0]`; then a click at image `(x, y)` is map `(x, -y)`, so annotations are stored in image pixel coordinates.

### Customising the viewer app (controls, annotation)

`frontend/annotate.html` is the worked example and the thing to copy — it is live at `{BASE}/annotate`. It shows how to add:

- **draw tools** — `ol.interaction.Draw` for polygon, box (`Draw.createBox()`), and point, with a Pan mode that removes the interaction.
- **plane controls** — one slider per non-spatial axis, built from `tilegrid.index_axes` / `index_sizes`; changing one calls `source.refresh()` so tiles re-render for the new z or t.
- **channel controls** — pass `channels=` to the tile route; the tile grid hands you labels, colours and windows to build the UI from.
- **a feature list** with per-feature removal, wired to the vector source's `addfeature` / `removefeature` / `changefeature` events.

**Stamp the plane onto every shape before saving.** A polygon without its `z` is meaningless in a volume, and nothing else will record it for you.

### Annotation storage

Annotations never go into the image — the untouched original is the whole claim. Store them beside the catalog:

- `GET /api/datasets/{id}/annotations` → GeoJSON `FeatureCollection`
- `PUT /api/datasets/{id}/annotations` → validates `type == FeatureCollection`, writes `<annotations_dir>/<id>.geojson`

### Python

`zarr.open_group(zarr.storage.FSStore(zarr_url))` or `ome_zarr.io.parse_url(zarr_url)` + `ome_zarr.reader.Reader`. Both work unmodified. For the true zero-copy path, fetch `reference.json` and open it with fsspec's reference filesystem — that needs `imagecodecs` client-side, because the chunks are still in the source codec. Zarr v2 only (`zarr>=2.18,<3`), which is what the tifffile reference format and current NGFF 0.4 consumers use.

### Training loaders

Read crops straight from the view with zarr. Expect it to be slow per sample when cold and put a prefetcher in front (a bounded queue plus a small thread pool). Measure it; see § Honest measurement.

## Gotchas, all of which cost real debugging time here

1. **NGFF 0.4 wants `/` between chunk indices; tifffile's index uses `.`.** Serve only one spelling and the other client silently reads `fill_value` instead of pixels and reports success. Accept both, and declare `dimension_separator` in `.zarray`.
2. **A `?token=` query cannot serve a viewer.** Zarr clients append the chunk key to the store root, so the query lands before the key and every chunk 404s. Use a path-scoped token: `/t/{token}/zarr/{id}/{key}`.
3. **No browser Zarr implementation has an LZW codec.** Transcode on the way out (zlib is the safe universal choice) and say the served tier is not zero-copy.
4. **Gating chunks is not gating the dataset.** Dimensions, pixel sizes and channel names are themselves sensitive; redact the catalog entry too.
5. **A capability-URL/auth proxy may eat the `Authorization` header**, so bearer auth 401s through the public URL while working against the app. Support all three credential forms and record which endpoint a result came from.
6. **OME-XML `AcquisitionDate` is a child element, not an attribute.** Reading it with `.get()` silently yields `None` and the view then claims the source declared no date.
7. **Display windows must be measured or a viewer opens on black.** 16-bit microscopy uses a few percent of the dtype range. Sample percentiles from a coarse level and report that the window is computed, not declared.
8. **Cache the source *chunk*, not the requested region.** No two output tiles ask for the same rectangle, so a region-keyed cache measures 0 hits. Keying on the chunk took cold latency from 5627 ms to 2473 ms at ~50% hit rate.
9. **A large single-scale derived view is unusable in a viewer** — with nothing coarser to draw it must fetch the entire grid first (353 requests, blank canvas). Give derived views their own pyramid; level 0 stays the requested target.
10. **Do not close a shared `httpx.Client` to recover from a dropped connection.** A sibling thread mid-request gets "Cannot send a request, as the client has been closed". Swap the reference and let it be collected.
11. **Prefer pooled HTTP/1.1 over HTTP/2 to object storage under concurrency.** HTTP/2 multiplexes every range read onto one connection, so one reset takes out all of them.
12. **Benchmark conditions leak through shared working sets.** Disjoint samples are not enough if they share an underlying unit — crops on different (y, x) but the same z plane hit the same source chunks, so whichever condition ran second measured the first one's cache. This turned a real 2.7x prefetch speedup into a reported 19x. Make the working sets disjoint at the level the cache is keyed on, and write that rule into the record so the wrong number cannot resurface from the artefact.
13. **A percentile over a spatially biased subsample is WRONG, not approximate, and adding pixels does not fix it.** Sampling a few windows to estimate a display range looks like a bounded-cost win and is a correctness bug: intensity in a tissue section is structured in space, so the estimate stays biased however many pixels it draws from inside the bias. Measured on a 43-channel slide, a 2-chunk diagonal sample (131,072 px) was **33x less accurate** than striding across every chunk (82,628 px) — fewer pixels, more coverage, better answer — and put 28 of 43 channels outside 5%, worst case publishing [0, 4] where the truth was [0, 244]. Read a level in FULL when that is affordable (a pyramid's coarsest level nearly always is), and when it is not, say the window is unmeasured rather than publish one that is quietly wrong. A screenshot will not catch this: the default-active channels can be the accurate ones, so the first render looks right and the damage is wherever the user goes next.
14. **A uniform canvas passes a naive spread check too.** A lit-pixel count cannot tell an image from a black canvas — and whole-frame standard deviation is no better: a flat grey Neuroglancer frame with two panel dividers scored 24.45, because the DIVIDERS carried the variance. Measure spread over the middle half of the frame, where only pixels can be — that reads 8 distinct levels on a broken render and 256 on a working one.
15. **Neuroglancer needs an explicit `dimensions` block for any view with a t axis.** Without one it picks its own axis pair, opens a 5-D view on a t–z cross-section, and renders flat grey. It looks exactly like a data failure and is a framing one. **Mapping the time increment correctly does NOT remove the need for it** — Neuroglancer chooses display dimensions by POSITION in the coordinate space, not by unit — so publishing a real t scale and supplying the override are two separate obligations. (Verified against a view publishing t as scale 2.526 unit second: minimal state still broken, x/y/z-first renders.)
16. **A token in the request line lands in access logs.** Both credential forms that survive a proxy — `?token=` and the `/t/<token>/` path prefix — put the secret in the URL, so it is logged by every hop. The path form is still the only one a viewer can use; treat such URLs as secrets, scope them narrowly, and say so rather than presenting them as equivalent to a header.
17. **Playwright's headless Chromium has no WebGL at all.** Vizarr and Neuroglancer render nothing. Run under `xvfb-run` with `headless=False` and swiftshader.
18. **`bioio-czi` cannot read remote URLs.** It rejects any non-local filesystem outright. Remote CZI needs a FUSE mount or a download.
19. **Bucket listing is frequently denied even where reads are allowed.** Use `remote_files` with explicit URLs there.

## Honest measurement

- Split point-to-first-tile into parts. The IFD-chain read dominates a deep pyramid and must not stand for the whole; it is also a one-time cost, since reopening from a saved index is fast. The per-dataset `build_timings_s` block on `GET /api/datasets/{id}` already decomposes it.
- No warm number without a real cache, and say which cache. Identify hits from the server (`X-View-Cache`) rather than assuming from request order.
- Cold latency is mostly the round trip to object storage, not the view. Decode measured ~1.6% of it here. Decompose before attributing.
- Give each measured condition **disjoint working sets**, including disjoint z planes. Sharing a plane shares source chunks, and the second condition then measures the first one's cache — this inflated a prefetch speedup from 2.7x to a bogus 19x until it was fixed.
- A screenshot is not evidence on its own. Record the viewer's requests and their statuses, and count lit pixels **and** pixel spread — a uniform grey canvas passes a lit-pixel check. **Measure the spread over the middle of the frame, not the whole frame:** the broken Neuroglancer render described above scored a whole-frame stdev of 24.4 and passed, because panel dividers and scale bars carry all the variance a whole-frame stdev needs. Cropping to the central half, where only pixels can be, separated it cleanly — 8 distinct grey levels on the grey rectangle against 256 on the working render. All-200 chunk statuses do not rescue this: that render fetched every chunk successfully.
- Report what a local copy costs to materialise beside its throughput. It is fast per sample only after paying the same read up front.

## Licences

Verify from the source repository's API, not a landing page, and grade the evidence. A Zenodo record exposes `metadata.license.id`; IDR and HuBMAP have only site-wide policies with no per-dataset field, which is weaker. Say which kind you have, and exclude anything unverifiable from publication.
