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
            "pip": ["numpy", "torch"],
            "env_vars": {"MY_VAR": "value"}
        }
    },
    max_ongoing_requests=10,     # concurrent requests per replica
    autoscaling_config={
        "min_replicas": 1,
        "max_replicas": 3,
        "target_ongoing_requests": 0.8,
    }
)
```
