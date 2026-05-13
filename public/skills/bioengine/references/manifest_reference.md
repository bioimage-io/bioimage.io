# manifest.yaml Reference

## Required fields

```yaml
id: "unique-identifier"          # lowercase, hyphens allowed
id_emoji: "🔬"                   # required — single emoji character
name: "Application Name"
description: "Functional description"
type: ray-serve
authorized_users:
  - "*"                          # or list of email addresses
deployments:
  - "filename:ClassName"         # first entry = main entry point
```

## Optional fields

```yaml
version: "1.0.0"
documentation: "https://..."
tutorial: "tutorial.ipynb"
authorized_users:
  - "user@example.com"
  - "*"                          # allow all users
tags: ["segmentation", "gpu"]
license: "MIT"
```

## Deployment list ordering

The first deployment in the list becomes the main service entry point exposed through Hypha APIs. In multi-deployment apps, subsequent entries are helper/backend deployments referenced via `DeploymentHandle` parameters in the main class `__init__`.

## Full example (multi-deployment)

```yaml
id: "bioengine-model-runner"
id_emoji: "🔬"
name: "BioImage.IO Model Runner"
description: "Runs BioImage.IO models via Ray Serve"
type: ray-serve
authorized_users:
  - "*"
deployments:
  - "entry_deployment:EntryDeployment"
  - "runtime_deployment:RuntimeDeployment"
```

In `entry_deployment.py`, `EntryDeployment.__init__` receives `runtime_deployment: DeploymentHandle` as a parameter.

## Ray actor options reference

```python
@serve.deployment(
    ray_actor_options={
        "num_cpus": 2,           # CPU cores
        "num_gpus": 1,           # GPU count (omit for CPU-only)
        "memory": 8 * 1024**3,  # RAM in bytes
        "runtime_env": {
            # No need to list pydantic — BioEngine auto-injects it.
            # See "Pydantic compatibility" below.
            "pip": ["numpy", "torch"],
            "env_vars": {"MY_VAR": "value"},
        },
    },
    max_ongoing_requests=10,     # concurrent requests per replica
    autoscaling_config={
        "min_replicas": 1,
        "max_replicas": 3,
        "target_ongoing_requests": 0.8,
    },
)
```

## Pydantic compatibility (important)

BioEngine constructs Ray Serve deployment definitions on the driver
side (the BioEngine worker pod) and Ray Serve replicas reconstruct
them inside the `runtime_env` venv via `cloudpickle.loads`. The driver
and the venv must therefore agree on the `pydantic-core` version,
because cross-version unpickle fails with errors like:

```
AttributeError: 'FieldInfo' object has no attribute 'exclude_if'
```

**You do not need to pin pydantic in your app.** BioEngine's
`AppBuilder` calls `update_requirements(...)` against the driver's
worker extras and **auto-injects the driver's pydantic pin** into
your deployment's `runtime_env.pip` whenever the app does not already
list pydantic. The currently-shipped driver pins
`pydantic==2.11.0` (which pulls `pydantic-core==2.33.0`); BioEngine
silently adds that to every deployment's pip list.

**Only override the auto-injection if you really need a different
pydantic version.** In that case the override must still resolve to
the driver's `pydantic-core`, otherwise the pre-flight check refuses
to deploy. BioEngine runs `uv pip compile` against your merged pip
list on every `deploy_app` and raises with a clear message naming
both versions:

```
RuntimeError: pydantic-core version mismatch between BioEngine driver
(2.33.0) and the application's runtime_env (2.41.5). [...]
```

**To find the driver's current pydantic-core version:** run
`docker exec <worker-pod> python -c "import pydantic_core;
print(pydantic_core.__version__)"`, or (from BioEngine 0.9.1+) check
the `ray_version`/`bioengine_version` fields returned by
`get_status()` and cross-reference with the BioEngine release notes.

## Package manager: `pip` vs `uv`

BioEngine currently passes `runtime_env.pip` straight through to
Ray, which uses pip under the hood. Ray 2.43+ supports an alternative
top-level key, `runtime_env.uv`, that calls `uv pip install` instead
(faster cold-start, identical resolver). **Apps do not need to opt
in directly today** — keep using `"pip": [...]`. If/when BioEngine
migrates the builder to `runtime_env.uv`, app code stays unchanged
because BioEngine constructs the runtime_env dict for the deployment.
A future BioEngine release may also accept `"uv": [...]` in the
manifest as a passthrough.
