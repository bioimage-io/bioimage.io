# manifest.yaml Reference (format_version 0.6.0)

> The pre-0.6.0 `deployments:` list schema is no longer supported. 0.6.0
> manifests use a single top-level `entry:` field. Multi-deployment
> composition is wired via Python type hints on `__init__`, not a manifest
> list — see [app_templates.md](app_templates.md#composition-app-template).

## Required fields

```yaml
name: "Application Name"
id: "unique-identifier"          # lowercase, hyphens allowed
id_emoji: "🔬"                   # required — single emoji character
description: "Functional description"
type: ray-serve
format_version: 0.6.0
entry: my_deployment:MyDeployment   # python_filename_without_py:ClassName — single entry point
authorized_users:
  - "*"                          # or list of email addresses
```

## Optional fields

```yaml
version: "1.0.0"
authors:
  - {name: "Your Name", affiliation: "Your Org"}
license: MIT
tags: [bioengine]
documentation: "https://..."
tutorial: "tutorial.ipynb"
frontend_entry: "frontend/index.html"   # only if you ship a frontend/ dir
```

`validate_manifest` checks the required fields, the `format_version`, and the
`entry:` pattern — it does not reject extra keys, so `documentation:`,
`tutorial:` and any other descriptive metadata ride along on the artifact
manifest harmlessly.

- **`version`** — not required by schema, but every validated template sets
  it, and it is enforced at upload time: as of bioengine 0.11.7, `upload_app`
  rejects any artifact whose manifest `version` is not strictly greater than
  every existing version of that artifact (PEP 440 ordering). Bump it on
  every change.
- **`frontend_entry`** — additive to `entry:`, not a replacement. Causes
  BioEngine to populate `static_site_url` and the dashboard's "Open UI"
  button. The artifact's `view_config` (`root_directory: "frontend"`,
  `index: "index.html"`) is configured automatically by `upload_app`. See
  [app_templates.md § Frontend UI template](app_templates.md#frontend-ui-template).

## The `entry:` field

`entry:` names exactly one deployment class — `<module_without_.py>:<ClassName>`.
There is no `deployments:` list in 0.6.0. For an app with multiple
deployments (one entry orchestrating several runtimes), only the entry
deployment goes in `entry:`; the entry's `__init__` imports each runtime
class directly and type-hints the matching parameter with that class —
that import + type hint *is* the wiring:

```python
from runtime_a import RuntimeA

class EntryDeployment:
    def __init__(self, runtime_a: RuntimeA) -> None:
        ...
```

Full working single- and multi-deployment templates:
[app_templates.md](app_templates.md).

## Full example (validated)

```yaml
name: My Simple App
id: my-simple-app
id_emoji: "⚙️"
description: "A simple BioEngine application"
type: ray-serve
format_version: 0.6.0
version: 1.0.0
authors:
  - {name: "Your Name", affiliation: "Your Org"}
license: MIT
tags: [bioengine]
entry: my_deployment:MyDeployment
authorized_users:
  - "*"
```

## `@bioengine.app` decorator reference

Deployment resource and scaling knobs are no longer set as a raw
`@serve.deployment(ray_actor_options={...})` dict — authoring with the raw
Ray Serve decorator is deprecated and will fail introspection. Use
`@bioengine.app(...)`, which BioEngine wraps into the underlying
`@serve.deployment` for you:

```python
import bioengine

@bioengine.app(
    num_cpus=1,
    gpu_memory_mb=8192,          # VRAM in MB; -1 for a whole GPU; OMIT for CPU-only
    memory_mb=4096,               # RAM in MB
    pip=["numpy==1.26.4"],       # pin exact versions — any change = full rebuild
    max_ongoing_requests=10,     # concurrent requests per replica
)
class MyDeployment:
    ...
```

`gpu_memory_mb` replaced `num_gpus` in bioengine 0.15.0 and is the only GPU
knob the decorator accepts. It takes **megabytes of VRAM**, or `-1` for a whole
device. There is no zero: `gpu_memory_mb=0` is rejected outright, and a CPU-only
app simply leaves the kwarg out.

Entry/orchestrator deployments in composition apps use `num_cpus=0` and no
`gpu_memory_mb` — they route calls to the runtimes and hold no compute of their
own (see the composition template's `EntryDeployment`).

**Per-replica scaling (`num_replicas` / `autoscaling_config`) is not a
manifest or decorator field.** It's set at deploy time via
`worker.deploy_app(scaling={class_name: {...}})`, keyed by class name — see
SKILL.md § 3 "Per-deployment scaling". Classes not named in `scaling` run at
one fixed replica.

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
your deployment's `runtime_env.pip` (fed from your `@bioengine.app(pip=[...])`
list) whenever the app does not already list pydantic. The
currently-shipped driver pins `pydantic==2.11.0` (which pulls
`pydantic-core==2.33.0`); BioEngine silently adds that to every
deployment's pip list.

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

The `pip=[...]` list you pass to `@bioengine.app(...)` is passed straight
through to Ray as `runtime_env.pip`, which uses pip under the hood. Ray
2.43+ supports an alternative top-level key, `runtime_env.uv`, that calls
`uv pip install` instead (faster cold-start, identical resolver). **Apps do
not need to opt in directly today** — keep using `pip=[...]`. If/when
BioEngine migrates the builder to `runtime_env.uv`, app code stays
unchanged because BioEngine constructs the runtime_env dict for the
deployment from your decorator's `pip` argument.
