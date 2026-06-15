# BioEngine App Templates

## Contents
- [Simple app template](#simple-app-template)
- [Composition app template](#composition-app-template)
- [Frontend UI template](#frontend-ui-template)

---

## Simple app template

### `manifest.yaml`

```yaml
name: My Simple App
id: my-simple-app
id_emoji: "⚙️"
description: "A simple BioEngine application"
type: ray-serve
format_version: 0.5.0
version: 1.0.0
authors:
  - {name: "Your Name", affiliation: "Your Org"}
license: MIT
tags: [bioengine]
deployments:
  - my_deployment:MyDeployment
authorized_users:
  - "*"
frontend_entry: "frontend/index.html"
```

### `my_deployment.py`

```python
"""Single-deployment BioEngine app."""
import asyncio
import logging
import os
import time
from datetime import datetime
from typing import Dict, Union

from hypha_rpc.utils.schema import schema_method
from pydantic import Field
from ray import serve

logger = logging.getLogger("ray.serve")


@serve.deployment(
    ray_actor_options={
        "num_cpus": 1,
        "num_gpus": 0,
        "memory": 1 * 1024**3,
        "runtime_env": {
            "pip": [
                # Freeze all versions here BEFORE writing business logic.
                # Changing these later requires a full environment rebuild (5-15 min).
                "numpy==1.26.4",
            ],
        },
    },
    max_ongoing_requests=10,
)
class MyDeployment:
    def __init__(self, greeting: str = "Hello") -> None:
        self.greeting = greeting
        self.start_time = time.time()

    async def async_init(self) -> None:
        logger.info("MyDeployment async_init complete")

    async def test_deployment(self) -> None:
        import numpy as np
        arr = np.zeros((3, 3))
        assert arr.shape == (3, 3)
        result = await self.ping()
        assert result["status"] == "ok"

    async def check_health(self) -> None:
        pass

    @schema_method
    async def ping(self) -> Dict[str, Union[str, float]]:
        """Ping the service."""
        return {
            "status": "ok",
            "message": f"{self.greeting} from MyDeployment!",
            "timestamp": datetime.now().isoformat(),
            "uptime": time.time() - self.start_time,
        }

    @schema_method
    async def process(
        self,
        values: list = Field(..., description="List of numbers to sum"),
    ) -> dict:
        """Sum a list of numbers using numpy."""
        import numpy as np
        arr = np.array(values, dtype=float)
        return {"result": float(np.sum(arr)), "count": len(values)}
```

---

## Composition app template

One entry deployment that orchestrates multiple runtime deployments. The entry has no CPUs/GPUs — it routes calls to the runtimes.

**Architecture:**
```
Client → EntryDeployment (CPU=0) → RuntimeA (CPU=1, text)
                                 → RuntimeB (CPU=1, data)
                                 → RuntimeC (CPU=1, images)
```

**Critical naming rule**: The filename part of each `deployments` entry must exactly match the parameter name in `EntryDeployment.__init__` that holds the `DeploymentHandle`:

```yaml
# manifest.yaml
deployments:
  - entry_deployment:EntryDeployment   # entry — always first
  - runtime_a:RuntimeA                 # "runtime_a" must match __init__ param name
  - runtime_b:RuntimeB
  - runtime_c:RuntimeC
```

```python
# entry_deployment.py
class EntryDeployment:
    def __init__(
        self,
        runtime_a: DeploymentHandle,   # matches "runtime_a" in manifest
        runtime_b: DeploymentHandle,
        runtime_c: DeploymentHandle,
    ) -> None:
```

### `manifest.yaml`

```yaml
name: My Composition App
id: my-composition-app
id_emoji: "🔬"
description: "Multi-deployment composition app"
type: ray-serve
format_version: 0.5.0
version: 1.0.0
authors:
  - {name: "Your Name", affiliation: "Your Org"}
license: MIT
deployments:
  - entry_deployment:EntryDeployment
  - runtime_a:RuntimeA
  - runtime_b:RuntimeB
  - runtime_c:RuntimeC
authorized_users:
  - "*"
frontend_entry: "frontend/index.html"
```

### `entry_deployment.py`

```python
"""Entry deployment — orchestrates RuntimeA, RuntimeB, RuntimeC."""
import asyncio
import logging
import time
from datetime import datetime
from typing import Dict, List, Union

from hypha_rpc.utils.schema import schema_method
from pydantic import Field
from ray import serve
from ray.serve.handle import DeploymentHandle

logger = logging.getLogger("ray.serve")


@serve.deployment(
    ray_actor_options={
        "num_cpus": 0,
        "num_gpus": 0,
        "memory": 256 * 1024**2,
        "runtime_env": {"pip": []},
    },
    max_ongoing_requests=20,
)
class EntryDeployment:
    def __init__(
        self,
        runtime_a: DeploymentHandle,
        runtime_b: DeploymentHandle,
        runtime_c: DeploymentHandle,
    ) -> None:
        self.runtime_a = runtime_a
        self.runtime_b = runtime_b
        self.runtime_c = runtime_c
        self.start_time = time.time()

    async def test_deployment(self) -> None:
        ping_a = await self.runtime_a.ping.remote()
        ping_b = await self.runtime_b.ping.remote()
        ping_c = await self.runtime_c.ping.remote()
        assert ping_a == "pong"
        assert ping_b == "pong"
        assert ping_c == "pong"

    @schema_method
    async def status(self) -> dict:
        """Get status from all runtimes."""
        a, b, c = await asyncio.gather(
            self.runtime_a.get_status.remote(),
            self.runtime_b.get_status.remote(),
            self.runtime_c.get_status.remote(),
        )
        return {"entry_uptime": time.time() - self.start_time, "runtime_a": a, "runtime_b": b, "runtime_c": c}

    @schema_method
    async def process_text(self, text: str = Field(..., description="Text to process")) -> dict:
        """Process text through RuntimeA."""
        return await self.runtime_a.process_text.remote(text)

    @schema_method
    async def analyze_data(self, values: list = Field(..., description="List of numbers")) -> dict:
        """Run statistical analysis through RuntimeB."""
        return await self.runtime_b.analyze.remote(values)

    @schema_method
    async def pipeline(
        self,
        text: str = Field(..., description="Text input"),
        values: list = Field(..., description="Numeric values"),
    ) -> dict:
        """Run runtimes A and B in parallel."""
        text_result, data_result = await asyncio.gather(
            self.runtime_a.process_text.remote(text),
            self.runtime_b.analyze.remote(values),
        )
        return {"text": text_result, "data": data_result}
```

### `runtime_a.py`

```python
"""RuntimeA — text processing."""
import logging
from ray import serve

logger = logging.getLogger("ray.serve")


@serve.deployment(
    ray_actor_options={
        "num_cpus": 1, "num_gpus": 0, "memory": 512 * 1024**2,
        "runtime_env": {"pip": []},
    },
    max_ongoing_requests=5,
)
class RuntimeA:
    async def async_init(self) -> None:
        logger.info("RuntimeA ready")

    async def test_deployment(self) -> None:
        result = await self.process_text("hello world")
        assert "word_count" in result

    async def ping(self) -> str:
        return "pong"

    async def get_status(self) -> dict:
        return {"name": "runtime_a", "status": "ok"}

    async def process_text(self, text: str) -> dict:
        words = text.split()
        return {"word_count": len(words), "char_count": len(text), "words": words}
```

### `runtime_b.py`

```python
"""RuntimeB — data analysis."""
import logging
from ray import serve

logger = logging.getLogger("ray.serve")


@serve.deployment(
    ray_actor_options={
        "num_cpus": 1, "num_gpus": 0, "memory": 512 * 1024**2,
        "runtime_env": {"pip": ["numpy==1.26.4", "scipy==1.13.0"]},
    },
    max_ongoing_requests=5,
)
class RuntimeB:
    async def async_init(self) -> None:
        import numpy as np
        logger.info(f"RuntimeB ready (numpy {np.__version__})")

    async def ping(self) -> str:
        return "pong"

    async def get_status(self) -> dict:
        return {"name": "runtime_b", "status": "ok"}

    async def analyze(self, values: list) -> dict:
        import numpy as np
        arr = np.array(values, dtype=float)
        return {"mean": float(np.mean(arr)), "std": float(np.std(arr)),
                "min": float(np.min(arr)), "max": float(np.max(arr)), "count": len(arr)}
```

### `runtime_c.py`

```python
"""RuntimeC — image processing."""
import logging
from ray import serve

logger = logging.getLogger("ray.serve")


@serve.deployment(
    ray_actor_options={
        "num_cpus": 1, "num_gpus": 0, "memory": 1 * 1024**3,
        "runtime_env": {"pip": ["numpy==1.26.4", "pillow==10.4.0"]},
    },
    max_ongoing_requests=5,
)
class RuntimeC:
    async def async_init(self) -> None:
        from PIL import Image
        logger.info("RuntimeC ready")

    async def ping(self) -> str:
        return "pong"

    async def get_status(self) -> dict:
        return {"name": "runtime_c", "status": "ok"}

    async def process_image(self, width: int = 64, height: int = 64) -> dict:
        import numpy as np
        from PIL import Image
        arr = np.zeros((height, width, 3), dtype=np.uint8)
        arr[:, :, 0] = np.linspace(0, 255, width)
        arr[:, :, 1] = np.linspace(0, 255, height).reshape(-1, 1)
        pixel_arr = np.array(Image.fromarray(arr))
        return {"width": width, "height": height, "mean_pixel": float(pixel_arr.mean())}
```

---

## Frontend UI template

This template matches the bioimage.io front-end convention: a fixed
**top-right Login / profile widget** instead of an inline "Connect"
button, a localStorage-cached token so reloads keep the session, and a
defensive CSS guard so the Login button actually disappears once the
user is signed in. Drop the `<style>` block, `<div id="topbar">`, and
the `<script>` body into any BioEngine app frontend and fill in the
service-specific cards (image picker, instruction input, result panel,
etc.) between them.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>My BioEngine App</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    /* The user-agent rule `[hidden] { display: none }` loses to any class
       that sets `display: inline-flex` (e.g. .topbar-btn). Force-override
       so JS `el.hidden = true` actually hides those elements. */
    [hidden] { display: none !important; }
    body { font-family: system-ui, -apple-system, sans-serif;
           background: #0f172a; color: #e2e8f0; min-height: 100vh;
           display: flex; flex-direction: column; align-items: center;
           padding: 2rem 1rem; }

    /* Top-right login / profile widget. */
    #topbar { position: fixed; top: 1rem; right: 1rem; z-index: 50;
              display: flex; align-items: center; gap: 0.5rem; }
    .topbar-btn { display: inline-flex; align-items: center; gap: 0.4rem;
                  background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
                  border-radius: 0.5rem; padding: 0.45rem 0.9rem;
                  font: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
    .topbar-btn:hover { background: #334155; }
    .topbar-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .topbar-btn svg { width: 1.1rem; height: 1.1rem; flex-shrink: 0; }
    .topbar-iconbtn { background: #1e293b; border: 1px solid #334155; border-radius: 999px;
                      width: 2.25rem; height: 2.25rem; display: inline-flex;
                      align-items: center; justify-content: center; cursor: pointer; padding: 0; }
    .topbar-iconbtn:hover { background: #334155; }
    .topbar-iconbtn svg { width: 1.4rem; height: 1.4rem; color: #cbd5e1; }
    #userMenu { position: absolute; top: 2.6rem; right: 0; min-width: 16rem;
                background: #1e293b; border: 1px solid #334155; border-radius: 0.5rem;
                padding: 0.4rem 0; box-shadow: 0 12px 30px rgba(0,0,0,.45); }
    #userMenu .item { display: block; padding: 0.5rem 0.9rem; color: #e2e8f0;
                      font-size: 0.85rem; background: none; border: 0; width: 100%;
                      text-align: left; cursor: pointer; }
    #userMenu .item:hover { background: #0f172a; }
    #userMenu .info { padding: 0.45rem 0.9rem; border-bottom: 1px solid #334155;
                      font-size: 0.78rem; color: #94a3b8; word-break: break-all; }
    #userMenu .info strong { color: #e2e8f0; font-weight: 600; }

    .card { background: #1e293b; border: 1px solid #334155; border-radius: .75rem;
            padding: 1.5rem; width: 100%; max-width: 640px; margin-bottom: 1rem; }
  </style>
</head>
<body>

<!-- Top-right login / profile widget. Both children start hidden in HTML;
     the boot script reveals exactly one (or neither, during auto-connect)
     so the Login button never flashes when a cached token is still valid. -->
<div id="topbar">
  <!-- Logged-out: Login button -->
  <button id="loginBtn" class="topbar-btn" type="button" aria-label="Sign in to Hypha" hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
      <polyline points="10 17 15 12 10 7"/>
      <line x1="15" y1="12" x2="3" y2="12"/>
    </svg>
    <span>Login</span>
  </button>

  <!-- Logged-in: user-circle icon + dropdown -->
  <div id="userWrap" style="position: relative;" hidden>
    <button id="userBtn" class="topbar-iconbtn" type="button" aria-label="Account menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="10" r="3.4"/>
        <path d="M5.5 19a7 7 0 0 1 13 0"/>
      </svg>
    </button>
    <div id="userMenu" hidden>
      <div class="info">
        <div><strong id="userEmail">…</strong></div>
        <div>workspace <strong id="userWs">…</strong></div>
      </div>
      <button class="item" id="logoutBtn" type="button">Sign out</button>
    </div>
  </div>
</div>

<!-- App-specific UI goes here, e.g. <div class="card">…</div>. The qcSvc
     handle is wired in connectWithToken() below; gate any RPC-driven UI
     on `!!svc` (or your equivalent) to keep it disabled until login. -->
<div class="card">
  <h2 style="margin-bottom:.75rem">My BioEngine App</h2>
  <p id="appStatus">Sign in (top right) to start calling the service.</p>
</div>

<script type="module">
import { login, connectToServer }
  from "https://cdn.jsdelivr.net/npm/hypha-rpc@0.20.54/dist/hypha-rpc-websocket.mjs";

// URL params:
//   ?server=<hypha-server>              — Hypha base URL (default aicell.io)
//   ?ws_service_id=<full-service-id>    — pinned target service id
//   ?token=<hypha-token>                — TESTING-ONLY auto-connect bypass.
//                                          Tokens land in browser history;
//                                          do not paste production tokens.
const params     = new URLSearchParams(window.location.search);
const SERVER_URL = params.get("server")        || "https://hypha.aicell.io";
const SERVICE_ID = params.get("ws_service_id") || "";
const URL_TOKEN  = params.get("token")          || "";

// Token cache (mirrors bioimage.io's LoginButton: 3 h TTL).
const TOKEN_KEY    = "my-app:token";           // ← change per-app
const TOKEN_EXPIRY = "my-app:tokenExpiry";
const TOKEN_TTL_MS = 3 * 60 * 60 * 1000;

let server = null, svc = null, userWorkspace = null, userEmail = null;
const $ = id => document.getElementById(id);

function loadSavedToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    const e = localStorage.getItem(TOKEN_EXPIRY);
    if (t && e && new Date(e) > new Date()) return t;
  } catch (_) {}
  return null;
}
function saveToken(t) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(TOKEN_EXPIRY, new Date(Date.now() + TOKEN_TTL_MS).toISOString());
  } catch (_) {}
}
function clearSavedToken() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_EXPIRY); } catch (_) {}
}

function setLoggedOutUI() {
  $("loginBtn").hidden = false;
  $("loginBtn").disabled = false;
  $("userWrap").hidden = true;
  $("userMenu").hidden = true;
}
function setLoggingInUI()  { $("loginBtn").disabled = true; }
function setLoggedInUI() {
  $("loginBtn").hidden = true;
  $("userWrap").hidden = false;
  $("userEmail").textContent = userEmail || "(unknown)";
  $("userWs").textContent    = userWorkspace || "—";
}

$("userBtn").addEventListener("click", () => {
  $("userMenu").hidden = !$("userMenu").hidden;
});
document.addEventListener("mousedown", (e) => {
  if (!$("userMenu").hidden && !$("userMenu").contains(e.target)
      && !$("userBtn").contains(e.target)) {
    $("userMenu").hidden = true;
  }
});

async function connectWithToken(token) {
  setLoggingInUI();
  server = await connectToServer({ server_url: SERVER_URL, token });
  userWorkspace = server.config.workspace;
  userEmail = (server.config.user && server.config.user.email) || userWorkspace;
  setLoggedInUI();
  // Replace this block with your app's service resolution + UI enable.
  if (SERVICE_ID) svc = await server.getService(SERVICE_ID, { _rkwargs: true });
}

$("loginBtn").addEventListener("click", async () => {
  setLoggingInUI();
  try {
    const token = await login({
      server_url: SERVER_URL,
      // Open the Hypha login URL in a new tab. window.open is OK here
      // because we're inside a real user-gesture (the click handler).
      login_callback: (ctx) => { window.open(ctx.login_url); },
    });
    saveToken(token);
    await connectWithToken(token);
  } catch (err) {
    console.error(err);
    setLoggedOutUI();
  }
});

$("logoutBtn").addEventListener("click", async () => {
  clearSavedToken();
  svc = null; userWorkspace = null; userEmail = null;
  try { if (server?.disconnect) await server.disconnect(); } catch (_) {}
  server = null;
  setLoggedOutUI();
});

// Boot: prefer URL token (testing), else cached token, else stay logged out.
// When a token is available, leave BOTH topbar buttons hidden until the
// WebSocket connect resolves — that way the Login button never flashes
// during the cached-token auto-reconnect.
(async () => {
  const cached = URL_TOKEN || loadSavedToken();
  if (!cached) { setLoggedOutUI(); return; }
  try {
    await connectWithToken(cached);
  } catch (err) {
    if (!URL_TOKEN) clearSavedToken();
    setLoggedOutUI();
  }
})();
</script>
</body>
</html>
```

**Why each piece is there:**

- **`[hidden] { display: none !important }`** — the user-agent `[hidden] { display: none }` rule loses to any class that sets `display: inline-flex` (e.g. `.topbar-btn`). Without this override, setting `el.hidden = true` in JS flips the attribute but the element keeps rendering. Easy to miss; ship the override every time.
- **Both topbar buttons start `hidden` in HTML, JS reveals one synchronously on boot.** Otherwise the Login button visibly flashes for the duration of the WebSocket connect when a returning user reloads the page.
- **`login_callback: (ctx) => window.open(ctx.login_url)`** — `window.open` succeeds here because we're inside the click handler's user-gesture context. Don't await the URL and then open — by then the gesture has expired and the popup is blocked.
- **localStorage cache with 3 h TTL** — mirrors `bioimage.io`'s `LoginButton` so users move between apps without re-authenticating.
- **`?token=` URL param** — testing-only path. Documented in the source as such because tokens in URLs are visible in browser history.
- **`{ _rkwargs: true }` on every `getService(...)` and RPC call** — required in JavaScript; not needed in Python.

**Key points:**
- Import `login` and `connectToServer` from the same CDN module — no npm needed.
- `server_url` and `ws_service_id` come from URL query params injected by BioEngine when the page is served via the artifact's `static_site_url`.
- `frontend_entry: "frontend/index.html"` in `manifest.yaml` is what causes BioEngine to populate `static_site_url` and the dashboard's "Open UI" button. The artifact's `view_config` (`root_directory: "frontend"`, `index: "index.html"`) is configured automatically by `upload_app`.
- Change `TOKEN_KEY` / `TOKEN_EXPIRY` constants per app so apps share a Hypha session origin but keep separate localStorage entries.

### Error popups for button-driven failures

When a button handler triggers a Hypha RPC and it fails, surface the failure as a **modal error dialog with a scrollable detail block** — not a silent console log, and not `window.alert()`. Users need to see *what* broke (server message, stack) to file a useful bug, and `alert()` truncates long stacks and blocks the event loop.

The rule applies to **user-initiated** RPCs (button clicks, form submits). Background / boot-time refreshes (page-load auto-connect, pre-fetching dropdown contents) should keep failing silently with a log line — popping a modal on page load is hostile. The pattern below is a single shared helper plus a `popupOnError` flag so refresh functions can be reused from both contexts.

```html
<!-- Error dialog (placed next to the confirm dialog if you have one). Reuses
     the same .dialog-backdrop / .dialog styles; .dialog-wide widens it and
     .dialog-detail adds a scrollable monospace block for stack traces. -->
<div id="errorDialog" class="dialog-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="errorTitle" hidden>
  <div class="dialog dialog-wide">
    <div class="dialog-title">
      <span class="dialog-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="13"/>
          <line x1="12" y1="16.5" x2="12" y2="16.5"/>
        </svg>
      </span>
      <span id="errorTitle">Something went wrong</span>
    </div>
    <div class="dialog-message" id="errorMessage"></div>
    <pre class="dialog-detail" id="errorDetail"></pre>
    <div class="dialog-actions">
      <button class="dialog-btn cancel" type="button" id="errorCopy">Copy</button>
      <button class="dialog-btn danger" type="button" id="errorClose">Close</button>
    </div>
  </div>
</div>
```

```css
/* Wider variant + scrollable monospace block for stack traces. */
.dialog.dialog-wide { max-width: 36rem; }
.dialog .dialog-detail {
  margin: 0 0 1.1rem;
  padding: 0.7rem 0.85rem;
  background: var(--bg-0); border: 1px solid var(--border);
  border-radius: 0.5rem;
  font: 0.78rem/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--fg-dim);
  max-height: 50vh; overflow-y: auto;
  white-space: pre-wrap; word-break: break-word;
}
.dialog .dialog-detail:empty { display: none; }
```

```javascript
// Stack → message → JSON, so the user gets the most useful representation
// of whatever the RPC layer surfaces.
function formatErr(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return err.stack || err.message || (() => {
    try { return JSON.stringify(err, null, 2); } catch { return String(err); }
  })();
}
function showError({ title = "Something went wrong", message = "", detail = "" } = {}) {
  $("errorTitle").textContent = title;
  $("errorMessage").innerHTML = message;     // HTML so callers can <strong> the resource name
  $("errorDetail").textContent = detail;     // textContent: never inject server output as HTML
  $("errorDialog").hidden = false;
  setTimeout(() => $("errorClose").focus(), 0);
}
function closeError() { $("errorDialog").hidden = true; }
$("errorClose").addEventListener("click", closeError);
$("errorDialog").addEventListener("click", (e) => {
  if (e.target === $("errorDialog")) closeError();
});
$("errorCopy").addEventListener("click", async () => {
  const text = [$("errorTitle").textContent, $("errorMessage").textContent, $("errorDetail").textContent]
    .filter(Boolean).join("\n\n");
  try {
    await navigator.clipboard?.writeText(text);
    $("errorCopy").textContent = "Copied";
    setTimeout(() => { $("errorCopy").textContent = "Copy"; }, 1200);
  } catch (_) {}
});
// Esc closes the topmost open dialog (error first, then confirm).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("errorDialog").hidden) { closeError(); return; }
  if (!$("confirmDialog").hidden) closeConfirm(false);
});
```

**Apply to button handlers, not background loaders.** Refresh functions called from both boot and a button should accept `{ popupOnError = false }` so the boot caller stays quiet:

```javascript
async function refreshTests({ popupOnError = false } = {}) {
  try { cachedTests = await svc.list_visual_tests({ _rkwargs: true }); }
  catch (err) {
    cachedTests = [];
    log("list_visual_tests failed: " + err.message, "err");
    if (popupOnError) showError({
      title: "Could not refresh visual tests",
      message: "<code>list_visual_tests</code> failed on the worker.",
      detail: formatErr(err),
    });
  }
  renderTestList();
}
// boot: silent
refreshTests();
// button: popup on failure
$("refreshBtn").addEventListener("click", () => refreshTests({ popupOnError: true }));
```

**Split a button's try blocks per RPC** so a failure in a follow-up call (e.g. a refresh after a delete) isn't attributed to the primary action:

```javascript
try {
  await svc.delete_visual_test({ name, _rkwargs: true });
} catch (err) {
  showError({ title: "Delete failed", message: `Could not delete <strong>${escapeHTML(name)}</strong>.`, detail: formatErr(err) });
  return;
}
await refreshTests({ popupOnError: true });   // its own popup if it fails
```

**Don't pop a modal per item inside a batch loop** (e.g. one tile fails in a 50-tile run). Surface per-item failures inline on the tile's UI state; reserve the modal for the single button-triggered RPC.
