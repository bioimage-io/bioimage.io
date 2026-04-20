# BioEngine CLI Reference

Install: `pip install -e skills/bioengine/bioengine_cli/`  
Entry point: `bioengine <command>`

## Prerequisites

```bash
export HYPHA_TOKEN=<your-token>
export BIOENGINE_WORKER_SERVICE_ID=bioimage-io/bioengine-worker  # for apps + cluster
export BIOENGINE_SERVER_URL=https://hypha.aicell.io               # optional, this is the default
```

---

## `bioengine call` — call any service method

```
Usage: bioengine call [OPTIONS] SERVICE_ID [METHOD]

Call any method on any deployed BioEngine service.

Arguments:
  SERVICE_ID   Hypha service ID, e.g. 'bioimage-io/model-runner' or 'my-workspace/my-app'
  METHOD       Method to call (omit with --list-methods)

Options:
  --args JSON          Arguments as a JSON object: '{"key": "val", "n": 10}'
  --arg KEY=VALUE      Individual argument (auto-typed: int/float/bool/str). Repeat for multiple.
  --list-methods       List available methods without calling one
  --json               Output as JSON (auto-enabled when stdout is not a TTY)
  --token TOKEN        Auth token (or HYPHA_TOKEN env var)
```

**Examples:**
```bash
# Discover methods
bioengine call bioimage-io/model-runner --list-methods

# Call with no arguments
bioengine call bioimage-io/model-runner ping --json

# Call with JSON arguments (recommended for AI agents)
bioengine call bioimage-io/model-runner search --args '{"keywords": ["nucleus"], "limit": 5}' --json

# Call with individual --arg flags (auto-typed)
bioengine call bioimage-io/my-app process --arg text=hello --arg max_length=100 --json

# Mix --args base with --arg overrides
bioengine call bioimage-io/my-app run --args '{"mode": "fast"}' --arg debug=true --json
```

**Argument auto-typing with `--arg`:**
- `"true"` / `"false"` → `bool`
- Digits only → `int`
- Digits with decimal → `float`
- Else → `str`
- For lists/dicts use `--args '{"key": [1,2,3]}'` instead

---

## `bioengine apps` — deploy and manage applications

### `bioengine apps deploy`

```
Usage: bioengine apps deploy [OPTIONS] APP_DIR

Upload and immediately deploy a local BioEngine app directory.

Arguments:
  APP_DIR   Directory with manifest.yaml and deployment .py file(s)

Options:
  --app-id ID          Stable instance ID (pass same ID to update in-place; default: auto-generated)
  --no-gpu             Disable GPU even if worker has GPUs
  --env KEY=VALUE      Environment variable (repeat for multiple; prefix with _ for secrets)
  --hypha-token TOKEN  Token injected as HYPHA_TOKEN inside the Ray actor.
                       Required for apps that connect back to Hypha.
                       Defaults to --token / HYPHA_TOKEN env var.
                       Pass --hypha-token '' to deploy without a token.
  --worker SERVICE     Worker service ID (or BIOENGINE_WORKER_SERVICE_ID)
  --token TOKEN        Auth token (or HYPHA_TOKEN)
```

> **Important**: `--env HYPHA_TOKEN=...` is silently ignored — always use `--hypha-token` to inject the token.

```bash
bioengine apps deploy ./my-app/
bioengine apps deploy ./my-app/ --app-id my-app   # stable ID — enables in-place updates
bioengine apps deploy ./my-app/ --no-gpu --env _API_KEY=secret
bioengine apps deploy ./my-app/ --app-id my-app --hypha-token $HYPHA_TOKEN
```

### `bioengine apps upload`

```
Usage: bioengine apps upload [OPTIONS] APP_DIR

Upload app files to Hypha artifact storage (without deploying).
Prints the artifact ID on success — pass it to `bioengine apps run`.
```

### `bioengine apps run`

```
Usage: bioengine apps run [OPTIONS] ARTIFACT_ID

Deploy a BioEngine application from artifact storage.

Options:
  --app-id ID          Instance ID (pass same ID to update in-place)
  --version VER        Specific artifact version (default: latest)
  --no-gpu             Disable GPU
  --env KEY=VALUE      Environment variable (repeat for multiple)
  --hypha-token TOKEN  Token injected as HYPHA_TOKEN inside the Ray actor.
                       Required for apps that connect back to Hypha.
                       Defaults to --token / HYPHA_TOKEN env var.
                       Pass --hypha-token '' to deploy without a token.
```

> **Important**: `--env HYPHA_TOKEN=...` is silently ignored — always use `--hypha-token` to inject the token.

```bash
bioengine apps run bioimage-io/my-app
bioengine apps run bioimage-io/my-app --app-id production --version 1.2.0
bioengine apps run bioimage-io/my-app --hypha-token $HYPHA_TOKEN
```

### `bioengine apps list`

```
Usage: bioengine apps list [OPTIONS]
Options: --json
```

### `bioengine apps status`

```
Usage: bioengine apps status [OPTIONS] [APP_ID...]

Arguments:
  APP_ID...   One or more app IDs (default: all running apps)

Options:
  --logs N   Log lines per replica [default: 30]
  --json
```

### `bioengine apps logs`

```
Usage: bioengine apps logs [OPTIONS] APP_ID
Options: -n/--tail N [default: 100], --json
```

### `bioengine apps stop`

```
Usage: bioengine apps stop [OPTIONS] APP_ID
Options: -y/--yes (skip confirmation)
```

**Note:** `stop` removes the running deployment; does NOT delete the artifact from storage.

---

## `bioengine cluster` — inspect cluster resources

### `bioengine cluster status`

```
Usage: bioengine cluster status [OPTIONS]

Show GPU and CPU usage across the Ray cluster.

Options:
  --json     Output as JSON
  --worker   Worker service ID (or BIOENGINE_WORKER_SERVICE_ID)
  --token    Auth token
```

```bash
bioengine cluster status
bioengine cluster status --json
```

**JSON output fields:**
```json
{
  "cluster": {"total_cpu": 46, "used_cpu": 8, "total_gpu": 4, "used_gpu": 2},
  "nodes": {
    "<node-id>": {
      "node_ip": "10.42.23.40", "head": false,
      "total_cpu": 10, "used_cpu": 1,
      "total_gpu": 1, "used_gpu": 0.5,
      "total_gpu_memory": 17179869184, "used_gpu_memory": 964689920,
      "accelerator_type": "A40"
    }
  }
}
```

---

## Environment variables

| Variable | Description |
|---|---|
| `BIOENGINE_WORKER_SERVICE_ID` | Worker service ID (required for `apps` and `cluster` commands) |
| `HYPHA_TOKEN` or `BIOENGINE_TOKEN` | Auth token |
| `BIOENGINE_SERVER_URL` | Hypha server URL (default: `https://hypha.aicell.io`) |

---

## Secret environment variables

Prefix env var names with `_` to mark as secret (hidden from status output; the underscore is stripped inside the deployment):

```bash
bioengine apps deploy ./my-app/ --env _API_KEY=secret
# Inside deployment: os.environ["API_KEY"]
```

---

## File encoding

- Text files (`.py`, `.yaml`, `.md`): uploaded as UTF-8 text
- Binary files: uploaded as base64
- `__pycache__` directories are excluded automatically
