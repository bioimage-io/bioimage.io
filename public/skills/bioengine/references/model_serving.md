# BioEngine Model Serving — Advanced Patterns

## Contents
- [Model caching](#model-caching)
- [GPU allocation strategies](#gpu-allocation-strategies)
- [Auto-scaling for batch jobs](#auto-scaling-for-batch-jobs)
- [Integrating models from external sources](#integrating-models-from-external-sources)
- [Fine-tuning app pattern](#fine-tuning-app-pattern)

---

## Model caching

Route requests to different model variants within one deployment — avoids one-deployment-per-model overhead. Use for model zoos, A/B testing, fine-tuned variants.

```python
import bioengine
from pydantic import Field

@bioengine.app(
    num_cpus=4,
    num_gpus=1,
    memory_mb=8 * 1024,
    pip=["cellpose>=4.0"],
)
class CachedSegmentation:
    @bioengine.cached(max_models=4)
    async def _get_model(self, model_id: str):
        """Loader — called on cache miss. First non-self arg is the
        cache key; the LRU cache calls this to build a new entry when
        ``model_id`` is not already warm. On overflow the LRU entry is
        evicted first, with ``gc.collect()`` + ``torch.cuda.empty_cache()``
        run in the same critical section so pynvml reflects the freed
        VRAM immediately."""
        from cellpose import models
        return models.CellposeModel(model_type=model_id, gpu=True)

    @bioengine.method
    async def segment(
        self,
        image: list,
        model_id: str = Field("cyto3", description="Cellpose model variant"),
        diameter: float = Field(None, description="Cell diameter in pixels"),
    ) -> dict:
        import numpy as np
        model = await self._get_model(model_id)   # cache handled internally
        arr = np.array(image, dtype=np.float32)
        masks, _, _ = model.eval(arr, diameter=diameter, channels=[0, 0])
        return {"labels": masks.tolist(), "n_cells": int(masks.max())}

    @bioengine.method
    async def free_gpu(self) -> dict:
        """Drop every cached model right now — useful before running
        a foundation-model call that needs the full GPU. GPU memory
        is returned to the CUDA driver in the same critical section."""
        return {"evicted": await bioengine.cache.evict_all_models(self)}
```

**Cache size**: `max_models=` controls how many variants stay warm per replica. LRU eviction when the limit is reached — the evicted entry's `__del__` fires and `gc.collect()` + `torch.cuda.empty_cache()` run before the next entry is loaded. Set 2–4 for typical GPU memory.

**Multiple `@bioengine.cached` methods per class are allowed** — each gets its own independent cache under its method name. Use this when the deployment loads unrelated model families that shouldn't share a slot count.

**Manual cache control** via `bioengine.cache`:

| Helper | Purpose | Returns |
|---|---|---|
| `evict_lru_model(self)` | evict least-recently-used | `Optional[str]` — model_id or None |
| `evict_all_models(self)` | drain the cache | `int` count |
| `evict_model(self, id)` | evict specific | `bool` |
| `cached_model_ids(self)` | introspect, LRU→MRU | `list[str]` |

Each helper takes an optional `method_name=` kwarg to select among multiple `@bioengine.cached` methods on the same class; omit it when the class has only one cache. Every eviction path runs `gc.collect()` + `torch.cuda.empty_cache()` under the same asyncio lock — GPU memory is returned to the CUDA driver immediately, so `pynvml` and downstream memory probes see the drop right away.

> **Renamed in `bioengine 0.11.22`.** The old `@bioengine.multiplexed` decorator and `bioengine.multiplex` submodule were removed — no shim. Apps on earlier bioengine versions must migrate: rename the decorator and swap `bioengine.multiplex.*` for `bioengine.cache.*` (same signatures) before the worker upgrades.

---

## GPU allocation strategies

### Single large model — one full GPU per replica

```python
@serve.deployment(
    ray_actor_options={"num_gpus": 1, "num_cpus": 4, "memory": 16 * 1024**3},
    autoscaling_config={"min_replicas": 1, "max_replicas": 2},
)
```

Use when: Foundation models (SAM, CellSAM), any model that fills an entire GPU.

### Small models — fractional GPU (multi-replica per node)

```python
@serve.deployment(
    ray_actor_options={"num_gpus": 0.25, "num_cpus": 2, "memory": 4 * 1024**3},
    autoscaling_config={"min_replicas": 1, "max_replicas": 8},
)
```

Use when: Lightweight CNNs (MitoSegNet, StarDist) using < 2 GB VRAM each. Allows 4 replicas per GPU, 4× throughput. **Only safe if this app is the sole GPU user on the cluster — fractional allocation does not enforce VRAM limits.**

### CPU-only

```python
@serve.deployment(
    ray_actor_options={"num_gpus": 0, "num_cpus": 4, "memory": 8 * 1024**3},
    autoscaling_config={"min_replicas": 1, "max_replicas": 16},
)
```

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
@serve.deployment(
    ray_actor_options={"num_gpus": 1, "num_cpus": 8, "memory": 32 * 1024**3},
)
class FineTuningDeployment:
    def __init__(self): self._model = None; self._training = False

    async def async_init(self):
        from cellpose import models
        self._model = models.CellposeModel(model_type='cpsam', gpu=True)

    @schema_method
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

    @schema_method
    async def get_training_status(self, run_id: str) -> dict:
        """Poll training progress."""
        return self._jobs.get(run_id, {"status": "not_found"})

    async def _train(self, images, masks, n_epochs, run_id):
        self._training = True
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._blocking_train, images, masks, n_epochs, run_id)
        self._training = False
```
