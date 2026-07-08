# Hypha setup: tokens, workspaces, and scoped credentials

Read-once plumbing for getting an authenticated Hypha client before you set up a worker or deploy an app. The main `SKILL.md` points here from "Server, install, and conventions." Everything on this page is workspace/token setup that most task runs only need once.

## If you don't have a Hypha token yet

When the user hasn't provided a `HYPHA_TOKEN` and you need one, walk them through the browser login flow rather than guessing. `hypha_rpc.login()` connects to the `public/hypha-login` service, prints a one-time URL, and blocks until the user finishes the OAuth flow in their browser:

```python
from hypha_rpc import login

token = await login({
    "server_url": "https://hypha.aicell.io",
    # Optional but recommended for long-lived agents:
    # "expires_in": 3600 * 24 * 30,   # 30 days
    # "login_timeout": 300,           # how long to wait for the user
})
# Save it: the user pastes this into their .env as HYPHA_TOKEN
```

If you're running headless (CLI, notebook, bot, agent shell), pass a `login_callback` to display the URL however you prefer — the default just `print()`s it:

```python
async def show_login(context):
    # context = {"login_url": "...", "key": "...", "report_url": "..."}
    print(f"\n🔐 Open this link to sign in to Hypha:\n   {context['login_url']}\n")

token = await login({
    "server_url": "https://hypha.aicell.io",
    "login_callback": show_login,
    "login_timeout": 300,
})
```

The token returned is scoped to the **user's personal workspace** (`ws-user-<provider>|<uid>`, e.g. `ws-user-github|49943582`) with admin permission. That's enough to set up workers, create new workspaces, and mint scoped tokens for apps. Save it in `~/.env` as `HYPHA_TOKEN` so subsequent sessions don't re-trigger login.

> **Interactive setup wizard** — the page at `https://bioimage.io/#/bioengine` ("Launch Your Own BioEngine Instance") wraps this same flow with a friendlier UI and auto-generates a 30-day admin token after Hypha login. For humans who'd rather click than type, send them there; agents working purely in code use `login()` directly.

## Create a new workspace

Personal workspaces work for prototyping. For lab- or facility-scale deployments, create a dedicated workspace so collaborators can share artifacts, workers, and apps cleanly. Workspaces that store artifacts (which all app deployments do) **must be persistent**:

```python
from hypha_rpc import connect_to_server

async with connect_to_server({"server_url": "https://hypha.aicell.io", "token": admin_token}) as server:
    ws = await server.create_workspace({
        "id": "my-lab",                       # required: lowercase, hyphens only, globally unique
        "name": "My Lab",                     # optional display name
        "description": "Workers + apps for the lab",
        "persistent": True,                   # required for artifact storage
        # "owners": ["nils.mech@gmail.com"],  # optional — defaults to caller; add co-owners here
    })
    print("created:", ws["id"])
```

The caller becomes an owner by default. Once created, the workspace shows up in `await server.list_workspaces()`, and you can mint scoped tokens for it (next section).

## Generate scoped tokens (worker + apps)

Once you have an admin token for a workspace, mint shorter-lived scoped tokens via `server.generate_token(...)`. The BioEngine worker itself does this internally — replicating the same scheme in your own bootstrap means tokens look uniform across the cluster.

**Worker bootstrap token** — admin permission, 30-day default. This is what you pass to the worker process as `HYPHA_TOKEN` env var:

```python
worker_token = await server.generate_token({
    "workspace": "my-lab",
    "permission": "admin",                    # worker needs admin to mint tokens for app replicas
    "expires_in": 3600 * 24 * 30,             # 30 days
    "client_id": "bioengine-worker-<facility>",   # optional but recommended for stable identity
})
```

(The worker, once running, also auto-mints itself a **3-hour rolling internal admin token** which it renews every cycle — that's an internal detail; you only need to provide the 30-day bootstrap token.)

**App / startup-applications token** — `read_write` permission, 30-day default. This is exactly what `AppsManager` and `AppBuilder` mint internally for every app deployment and proxy service:

```python
app_token = await server.generate_token({
    "workspace": "my-lab",
    "permission": "read_write",
    "expires_in": 3600 * 24 * 30,             # 30 days — the BioEngine default
})
```

Use this when you need to hand an app process an authenticated client for the workspace (e.g. when supplying `--hypha-token` to `bioengine apps run` for an app that registers its own Hypha services back, like `model-runner` or `cellpose-finetuning`).

**Permission ladder** (use the least-privileged level that works):

| `permission` | Can do |
|---|---|
| `read` | Call services, read artifacts. No registration. |
| `read_write` | + register services, create/edit artifacts. Default for apps. |
| `admin` | + manage workspace, mint new tokens. Required for the worker itself. |

`expires_in` is in seconds. Don't issue admin tokens with `expires_in > 30 days` for a hosted worker — short renewal cycles bound the blast radius if the token is leaked. The BioEngine worker's internal 3-hour rolling token is the upper bound for "compromise window" once the worker is running.
