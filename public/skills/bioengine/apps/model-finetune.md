# BioEngine Model Fine-Tune

**Service ID**: `bioimage-io/model-finetune` · **Server**: `https://hypha.aicell.io`

Fine-tune micro-SAM, Cellpose-SAM (`cpsam`) or Cellpose-DINO (`cpdino`, `cpdino-vitb`) on your own annotated image/label pairs, and serve the just-trained checkpoint — no local GPU. The same app also serves a resident SAM encoder for image-embedding export and an ONNX prompt decoder for in-browser box→mask annotation, so annotating and fine-tuning hit one service.

The reference implementation is [`apps/model-finetune`](https://github.com/aicell-lab/bioengine/tree/main/apps/model-finetune) in the BioEngine repo. Read it before writing a new one — everything below is implemented and measured there.

Newest published version at the time of writing: **0.29.0** (54 committed versions on the artifact). Check the live one before you pin anything — `get_app_status` reports what a given deployment actually runs, which is not necessarily the newest published.

## Use this skill when

- The user has annotated image/label pairs and wants a better segmentation model than an off-the-shelf one gives, without setting up training infrastructure.
- The pairs live in an **external object store** — a BioImage Archive study, an S3 bucket — and need validating and staging before a run. That is `preflight_training_dataset`; see below.
- Low-contrast fluorescence is defeating Cellpose-SAM and you want contrast-limited equalisation applied as the data is prepared, rather than editing images by hand.
- You need the trained result as a BioImage.IO package pushed into a draft artifact.

Not this skill: running inference with an existing Model Zoo model (see [model-runner](model-runner/model-runner.md)), or serving non-OME-Zarr images as OME-Zarr for a training loader (see [omezarr-view.md](omezarr-view.md)).

## The API surface

18 RPC methods at 0.29.0. The ones most callers need:

| Task | Method |
|---|---|
| Validate + stage an external dataset before a run | `preflight_training_dataset` |
| Start fine-tuning | `start_training` |
| Watch a run | `get_training_status`, `list_training_sessions` |
| Stop a run | `stop_training` |
| What the deployment can train | `get_training_capabilities` |
| Inference with the trained checkpoint | `infer` |
| Image embeddings / browser annotation | `compute_embedding`, `get_onnx_model` |
| Build + ship a BioImage.IO package | `export_model`, `get_export_status`, `push_export` |
| Upload your own files to the app | `get_upload_url` |

The rest — `aggregate`, `contribute`, `evaluate_community`, `get_pool_state`, `get_transport_stats` — belong to the federated model-pool workflow and are not needed for a plain fine-tune.

## `preflight_training_dataset` — validate and stage before committing to a run

A long training run that dies on the fourth image because one label mask is 3-D wastes the whole run. This method resolves every pair first, reports what is usable, and optionally re-stages the prepared arrays into the app's temp store so `start_training` consumes ordinary local arrays.

```python
report = await svc.preflight_training_dataset(
    train_images=[...],      # http(s) URLs, or get_upload_url paths — one per pair
    train_labels=[...],      # paired 1:1; .tif/.png/.npy, or a .geojson FeatureCollection
    val_images=[...],        # optional
    val_labels=[...],        # optional, both-or-neither with val_images
    enable_clahe=False,      # opt-in contrast-limited equalisation; forces staging on
    stage=True,              # stage the prepared arrays; False = validate in place and report only
)
```

What it checks per pair, and these are the conditions that make a pair `ok: false`: the image and label resolve and are readable; the label is 2-D after squeezing; label H×W equals image H×W; the label is an integer instance map with at least one foreground object.

**A bad pair is reported, not raised.** The per-pair report carries `ok`, `image_shape`, `label_shape`, `n_instances` and, on failure, `error` — and the other pairs are still validated. That is the contract worth relying on: point it at a messy directory listing and you get back which pairs are usable rather than an exception on the first miss. The top-level `ok` is false if any pair failed.

When staging is on, the returned `train_images` / `train_labels` (and the `val_*` pair) are URL lists ready to pass straight into `start_training`. **Staged URLs are short-lived — call `start_training` promptly** rather than staging now and training later.

Argument validation happens before any resolution: unequal `train_images`/`train_labels` lengths, unequal `val_*` lengths, or one of `val_images`/`val_labels` without the other all raise immediately.

### The CLAHE option

`enable_clahe=True` applies contrast-limited adaptive histogram equalisation while staging — it rescues low-contrast fluorescence that Cellpose-SAM otherwise cannot segment. Three properties to know:

- **It forces staging on.** Equalised pixels have to live somewhere, so `enable_clahe=True` with `stage=False` still stages; the response reports `staged: true`.
- **Colour collapses to one plane.** An RGB frame is reduced to grayscale by luma before equalising, so an image that reported `[914, 1225, 3]` comes back `[914, 1225]`.
- **It does not replace training's own normalisation.** The min-max rescale during training is unaffected.

It is a pure-NumPy reimplementation of `cv2.createCLAHE(clipLimit=3.0, tileGridSize=(16,16))`, deliberately rather than an OpenCV dependency: adding `opencv-python-headless` to the CPU entry pulls in a NumPy that crashes the entry deployment at startup on a dtype ABI mismatch against the pandas imported at init. If you are writing a similar app, do not assume you can add OpenCV to a CPU entry.

### A worked example you can run

[BioImage Archive S-BIAD634](https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD634) (Kromp et al., CC0) is a neuroblastoma nuclei dataset with paired ground truth, served over plain HTTPS:

```
https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/634/S-BIAD634/Files/dataset/rawimages/Ganglioneuroblastoma_<n>.tif
https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/634/S-BIAD634/Files/dataset/groundtruth/Ganglioneuroblastoma_<n>.tif
```

It is a good first target precisely because it is untidy: the Ganglioneuroblastoma series has ten images at indices 0–4 and 6–10, so **index 5 does not exist** — asking for 0–9 puts a real 404 inside a real batch and shows you the reported-not-raised behaviour. The images also mix RGB and grayscale at several sizes, which exercises the shape handling. `file_list_raw_images.json` and `file_list_annotations.json` in that Files directory list every path with its paired source image.

## Deploying it

`EntryApp` is CPU-only — 1 CPU, 4 GiB, exactly one replica — and routes to separate GPU runtime deployments. Each GPU runtime asks for `gpu_memory_mb=-1`, which reserves a **whole** GPU on whatever node it lands on.

```python
deployed = await worker.deploy_app(
    artifact_id="bioimage-io/model-finetune",
    application_id="model-finetune",      # stable id, or you get a random one
    version="0.29.0",                     # pass it explicitly
    hypha_token=TOKEN,                    # REQUIRED — see below
)
```

**`hypha_token` is not optional for this app.** `EntryApp.__init__` reads `HYPHA_TOKEN` and raises `RuntimeError: HYPHA_TOKEN environment variable is not set` when it is absent. Delivering it as a plain environment variable does not work — `hypha_token` overwrites that. Pass the parameter.

**Pass `version` explicitly.** On an `application_id` that is already running, omitting it yields `version_source: "inherited"` — a deploy that reports success while shipping the code already there.

Two deployment-time controls:

- **`disable_gpu=True`** forces every GPU reservation to zero, so the app runs CPU-only. Use it for anything that does not train — `preflight_training_dataset` is pure CPU work — and you will not take a GPU from a worker that is sharing it with production services.
- **`MODEL_FINETUNE_BACKENDS`**, a comma list over `microsam` and `cellpose`, chooses which runtimes get composed. Unset or empty means **both**; an unrecognised value raises and names the valid ones. A disabled backend's class is left as `None`, so the composition graph drops it entirely — it reserves no GPU and never builds its pip environment. `MODEL_FINETUNE_MAX_CONCURRENT_TRAINING` (default 1) serialises training so autoscaled replicas stay free for inference; raise it only when there is a distinct GPU per concurrent run.

## Scaling to zero is safe for exports and for run outcomes

The entry deployment can be scaled to zero, which means a replica is torn down routinely rather than only on a crash. Two pieces of bookkeeping are built for that:

- **Export records survive a teardown.** They live on the mounted `~/.bioengine` under `training.exports_root()` rather than in a dict on the replica, so `get_export_status` still answers for a finished export after the replica that built it is gone, and `push_export` can still find the built files.
- **A teardown is not recorded as a user stop.** The cancel handler consults `training.stop_requested` instead of unconditionally writing `terminated_by="user_stop"`. Without that, every scale-down during a healthy run would permanently record it as stopped-by-the-user, because `user_stop` outranks the runtime child's authoritative `COMPLETED`.

`get_export_status` returns the record with underscore-prefixed keys filtered out, so the worker's internal package path is never handed to a caller. If you are extending this app, keep that filter and test it by asserting on what the method **returns** — an assertion that rebuilds the filter inside the test cannot fail.

## Related

- [references/manifest_reference.md](../references/manifest_reference.md) — manifest fields
- [references/service_ids.md](../references/service_ids.md) — resolving the concrete per-replica service ID before calling
- [references/annotation_screening.md](../references/annotation_screening.md) — producing few-shot ground truth in the browser to fine-tune on
- [model-runner](model-runner/model-runner.md) — inference and model comparison
