# BioEngine Model Serving — Advanced Patterns

## Contents
- [Model caching](#model-caching)
- [GPU allocation strategies](#gpu-allocation-strategies)
- [Auto-scaling for batch jobs](#auto-scaling-for-batch-jobs)
- [Integrating models from external sources](#integrating-models-from-external-sources)
- [Fine-tuning app pattern](#fine-tuning-app-pattern)

---

## Model caching

Serve several model variants from one deployment (model zoos, A/B testing, fine-tuned variants) — avoids one-deployment-per-model overhead. There is **no framework cache**; keep loaded variants in a plain instance dict and load on miss, guarding GPU work with a lock.

> **Removed in `bioengine 0.11.24` — no shim.** The `@bioengine.cached` decorator and the `bioengine.cache` module (`evict_all_models`, `evict_lru_model`, `evict_model`, `cached_model_ids`) are gone. They baked a torch-only cleanup (`torch.cuda.empty_cache()`) into the framework, which cannot reclaim TensorFlow's whole-GPU allocation or onnxruntime's CUDA arena, and BioEngine apps don't require torch. Apps that used `@bioengine.cached` must switch to the manual pattern below before their worker upgrades to 0.11.24+.

```python
import asyncio
import bioengine
from pydantic import Field

@bioengine.app(
    num_cpus=4,
    gpu_memory_mb=-1,            # a whole GPU: this deployment keeps 4 variants warm
    memory_mb=8 * 1024,
    pip=["cellpose>=4.0"],
)
class CachedSegmentation:
    def __init__(self):
        self._models: dict = {}       # your own warm cache
        self._lock = asyncio.Lock()   # serialise GPU work + eviction

    async def _get_model(self, model_id: str):
        async with self._lock:
            if model_id not in self._models:
                if len(self._models) >= 4:               # your own capacity policy
                    self._models.pop(next(iter(self._models)))
                    import gc; gc.collect()
                    import torch; torch.cuda.empty_cache()   # frees torch only — see caveat
                from cellpose import models
                self._models[model_id] = models.CellposeModel(model_type=model_id, gpu=True)
            return self._models[model_id]

    @bioengine.method
    async def segment(
        self,
        image: list,
        model_id: str = Field("cyto3", description="Cellpose model variant"),
        diameter: float = Field(None, description="Cell diameter in pixels"),
    ) -> dict:
        import numpy as np
        model = await self._get_model(model_id)
        arr = np.array(image, dtype=np.float32)
        masks, _, _ = model.eval(arr, diameter=diameter, channels=[0, 0])
        return {"labels": masks.tolist(), "n_cells": int(masks.max())}
```

**Capacity is yours to define** — the example evicts the oldest entry once four variants are warm. Tune to your GPU; a plain `dict` preserves insertion order, so `next(iter(...))` is a simple FIFO (swap in your own LRU if you track access order).

**VRAM cleanup caveat.** Dropping a model from `self._models` + `torch.cuda.empty_cache()` frees **torch** memory only. TensorFlow claims the whole GPU and does not release it within a process; onnxruntime holds its CUDA arena. If your deployment mixes frameworks, or you need a guaranteed "no VRAM left over" between calls, run each inference in a **subprocess** and let the OS reclaim the entire CUDA context on exit (this is what the built-in `model-runner` app does) rather than caching models in-process.

---

## GPU allocation strategies

GPU is requested as **VRAM in megabytes** on the `@bioengine.app` decorator. The raw
`@serve.deployment(ray_actor_options={"num_gpus": ...})` form these examples used to show is
deprecated on two counts — the decorator will fail introspection, and `num_gpus` was removed
from the decorator surface in bioengine 0.15.0. Scaling is not a decorator field either; pass
it at deploy time via `deploy_app(scaling={...})`.

> **`gpu_memory_mb` reserves, it does not cap.** The number is consumed by the scheduler when
> it places the replica and by nothing afterwards. A replica declaring `gpu_memory_mb=8192` was
> observed allocating **12 GiB** and continuing to run normally. Two things follow. Your own
> app is not protected from OOM by the number you declared, so size it against the largest
> input you will actually accept. And a device that looks half-free by reservation can be full
> in fact, which is why the numbers in `bioengine cluster status` are capacity planning rather
> than truth — read `nvidia-smi` on the node when it matters.
>
> **Over-requesting VRAM hangs instead of failing.** CPU and RAM over-requests reach
> `DEPLOY_FAILED` in about 9 seconds. A VRAM over-request is unschedulable rather than
> invalid, so the replica sits in `DEPLOYING` with no timeout (measured at 10.8 minutes).
> Put a wall-clock deadline on every GPU deploy wait.

### Sizing the number

There is no way to look this up, and guessing runs high: an app that guessed `8192` peaked at
**1180 MB**, 7× over. On a 24 GB card that guess costs six co-tenants their slot. Measure it:

1. Deploy once with `gpu_memory_mb=-1`. A whole-device request always schedules on an idle GPU,
   so this step cannot hit the hang above.
2. Run your real workload at the largest input you intend to support, and read the peak from
   torch rather than from any BioEngine or NVML field:
   ```python
   import torch
   torch.cuda.reset_peak_memory_stats()
   ...                                      # the real call
   peak_mb = round(torch.cuda.max_memory_allocated() / 2**20)
   ```
3. Redeploy with the peak plus generous headroom (30% is cheap, being short is an OOM
   mid-request).

`torch.cuda.max_memory_allocated()` reports what **torch** allocated, which excludes the CUDA
context itself (a few hundred MB) and anything TensorFlow or onnxruntime is holding. That is
part of what the headroom is for.

**Warm up in `async_init`.** Loading weights onto the device is not the whole cold start. With
the model already resident, the first call still cost **2.19×** the tenth — CUDA context
creation, kernel autotuning and cuDNN algorithm selection all fire on the first tensor that
reaches the device. One throwaway forward pass at a realistic input shape moves that cost into
startup. A warm-up at the wrong shape re-triggers autotuning when the real one arrives.

**Confirm the work landed on the GPU by asserting on tensors**, not on
`torch.cuda.is_available()` (a fact about the host, true throughout a silent CPU fallback) and
not on utilisation (NVML averages over ~1 s, so a short call reads 0%):
```python
assert next(model.parameters()).is_cuda
assert out.device.type == "cuda"
```

### Single large model — one full GPU per replica

```python
@bioengine.app(num_cpus=4, gpu_memory_mb=-1, memory_mb=16 * 1024)
```

Use when: Foundation models (SAM, CellSAM), any model that fills an entire GPU. `-1` is the
only way to say "the whole device" — there is no maximum you can name that means the same thing
on every card.

### Small models — several replicas per GPU

```python
@bioengine.app(num_cpus=2, gpu_memory_mb=2048, memory_mb=4 * 1024)
```

Use when: Lightweight CNNs (MitoSegNet, StarDist) using < 2 GB VRAM each. On a 24 GB card this
packs many replicas onto one device, and unlike the old fractional `num_gpus=0.25` it is
**accounted in the units that actually run out**. Ask for what the model needs plus headroom
for the largest input you expect, not for a share of the device.

### CPU-only

```python
@bioengine.app(num_cpus=4, memory_mb=8 * 1024)
```

Omit `gpu_memory_mb` entirely. `gpu_memory_mb=0` is hard-rejected, so translating an old
`num_gpus=0` literally will not deploy.

### Releasing VRAM between calls

Because the reservation is not a cap, a long-lived replica that creeps upward will eventually
OOM itself or a co-tenant, and `torch.cuda.empty_cache()` only reaches torch's own allocator.
If your deployment mixes frameworks, or you need "no VRAM left over" to be a guarantee rather
than a hope, run each inference in a **subprocess** and let the OS reclaim the whole CUDA
context on exit. This is what the built-in `model-runner` app does. The pattern is written up
under [Model caching](#model-caching) because that is where it
first came up, but it is not specific to caching or to TensorFlow — it is the general answer
whenever process-lifetime VRAM ownership is the thing you cannot tolerate.

---

## Auto-scaling for batch jobs

Critical parameters for scaling to thousands of fields of view (FOV):

```python
autoscaling_config={
    "min_replicas": 1,           # Keep ≥1 warm — no cold start
    "max_replicas": 32,          # Scale up to 32 GPUs for a 9216-FOV HCS plate
    "target_num_ongoing_requests_per_replica": 2,
    "upscale_delay_s": 5,
    "downscale_delay_s": 120,    # Stay warm 2 min after load drops
    "initial_replicas": 1,
}
```

**Throughput estimate**: model at ~0.5 s/FOV:
- 1 replica → 90 FOV/min
- 32 replicas → ~1,900 FOV/min (9,216-FOV plate in ~5 min)

---

## Integrating models from external sources

### HuggingFace

```python
async def async_init(self) -> None:
    from huggingface_hub import hf_hub_download
    weights_path = hf_hub_download(
        repo_id="mouseland/cellpose-sam",
        filename="cellpose_sam.pt",
        cache_dir="/tmp/hf_cache",
    )
    from cellpose import models
    self._model = models.CellposeModel(pretrained_model=weights_path)
```

### Zenodo

```python
async def async_init(self) -> None:
    import urllib.request, os
    ZENODO_URL = "https://zenodo.org/record/3539340/files/MitoSegNet_model.hdf5"
    weights_path = "/tmp/mitosegnet_weights.hdf5"
    if not os.path.exists(weights_path):
        urllib.request.urlretrieve(ZENODO_URL, weights_path)
    import tensorflow as tf
    self._model = tf.keras.models.load_model(weights_path)
```

### BioImage.IO model zoo

```python
async def async_init(self) -> None:
    import bioimageio.core
    self._model = bioimageio.core.load_resource_description("fearless-crab")
    self._predictor = bioimageio.core.create_prediction_pipeline(self._model)
```

### pip / GitHub

```python
# In runtime_env.pip:
#   - git+https://github.com/instanseg/instanseg.git@main
#   - cellpose>=4.0

async def async_init(self) -> None:
    from instanseg import InstanSeg
    self._model = InstanSeg("fluorescence_nuclei_and_cells")
```

---

## Fine-tuning app pattern

For apps that run both inference and online fine-tuning:

```python
@bioengine.app(num_cpus=8, gpu_memory_mb=-1, memory_mb=32 * 1024)
class FineTuningDeployment:
    def __init__(self): self._model = None; self._training = False

    @bioengine.async_init
    async def load(self):
        from cellpose import models
        self._model = models.CellposeModel(model_type='cpsam', gpu=True)

    @bioengine.method
    async def start_finetuning(
        self,
        images: list,
        masks: list,
        n_epochs: int = Field(10, description="Training epochs"),
        run_id: str = Field(..., description="Unique run ID"),
    ) -> dict:
        """Start fine-tuning in background — returns immediately."""
        if self._training:
            return {"status": "busy", "message": "Training already in progress"}
        asyncio.create_task(self._train(images, masks, n_epochs, run_id))
        return {"status": "started", "run_id": run_id}

    @bioengine.method
    async def get_training_status(self, run_id: str) -> dict:
        """Poll training progress."""
        return self._jobs.get(run_id, {"status": "not_found"})

    async def _train(self, images, masks, n_epochs, run_id):
        self._training = True
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._blocking_train, images, masks, n_epochs, run_id)
        self._training = False
```
