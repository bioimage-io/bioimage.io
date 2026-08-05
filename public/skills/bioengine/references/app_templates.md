# BioEngine App Templates

## Contents
- [Simple app template](#simple-app-template)
- [Composition app template](#composition-app-template)
- [Frontend UI template](#frontend-ui-template)
  - [Getting the frontend URL](#getting-the-frontend-url)
  - [Sending an uploaded image to the backend](#sending-an-uploaded-image-to-the-backend)
  - [Shipping a multi-file frontend](#shipping-a-multi-file-frontend)
  - [Testing your frontend](#testing-your-frontend)
  - [Choosing your theme (both are shipped)](#choosing-your-theme-both-are-shipped)
  - [Always show that something is happening](#always-show-that-something-is-happening)
  - [Two traps that cost real time](#two-traps-that-cost-real-time)
  - [Never silently drop an external error](#never-silently-drop-an-external-error)
  - [Error popups for button-driven failures](#error-popups-for-button-driven-failures)

---

## Simple app template

### `manifest.yaml`

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

### `my_deployment.py`

```python
"""Single-deployment BioEngine app."""
import time
from datetime import datetime
from typing import Dict, Union

from pydantic import Field

import bioengine

logger = bioengine.logger  # never use print()


@bioengine.app(
    num_cpus=1,
    num_gpus=0,
    memory_mb=1024,
    pip=[
        # Freeze all versions here BEFORE writing business logic.
        # Changing these later requires a full environment rebuild (5-15 min).
        "numpy==1.26.4",
    ],
    max_ongoing_requests=10,
)
class MyDeployment:
    def __init__(self, greeting: str = "Hello") -> None:
        self.greeting = greeting
        self.start_time = time.time()

    @bioengine.async_init
    async def load(self) -> None:
        logger.info("MyDeployment async_init complete")

    @bioengine.smoke_test
    async def smoke(self) -> None:
        import numpy as np
        arr = np.zeros((3, 3))
        assert arr.shape == (3, 3)
        result = await self.ping()
        assert result["status"] == "ok"

    @bioengine.method
    async def ping(self) -> Dict[str, Union[str, float]]:
        """Ping the service."""
        return {
            "status": "ok",
            "message": f"{self.greeting} from MyDeployment!",
            "timestamp": datetime.now().isoformat(),
            "uptime": time.time() - self.start_time,
        }

    @bioengine.method
    async def process(
        self,
        values: list = Field(..., description="List of numbers to sum"),
    ) -> dict:
        """Sum a list of numbers using numpy."""
        import numpy as np
        arr = np.array(values, dtype=float)
        return {"result": float(np.sum(arr)), "count": len(values)}
```

*(Validated: this exact template deploys green on a live worker — `ping` and `process` both call successfully.)*

> **Heavy DL dependencies take a while.** For TensorFlow/PyTorch-class `pip` pins plus a first-use pretrained-weight download inside `async_init`, expect a multi-minute (roughly 5–15 min) `DEPLOYING` window. That's normal, not a hang — don't start unnecessary retries or assume failure; wait for `HEALTHY` or `DEPLOY_FAILED`.

---

## Composition app template

One entry deployment that orchestrates multiple runtime deployments. The entry has no CPUs/GPUs — it routes calls to the runtimes.

**Architecture:**
```
Client → EntryDeployment (CPU=0) → RuntimeA (CPU=1, text)
                                 → RuntimeB (CPU=1, data)
                                 → RuntimeC (CPU=1, images)
```

**Wiring rule (0.6.0)**: composition is wired via **Python type hints on `__init__`**, not a manifest `deployments:` list. Only the entry deployment is named in `manifest.yaml`'s `entry:` field — `import` each runtime class directly and annotate the matching `__init__` parameter with that class (not `DeploymentHandle`):

```python
# entry_deployment.py
from runtime_a import RuntimeA
from runtime_b import RuntimeB
from runtime_c import RuntimeC

class EntryDeployment:
    def __init__(
        self,
        runtime_a: RuntimeA,   # the import + type hint IS the wiring — param name is free
        runtime_b: RuntimeB,
        runtime_c: RuntimeC,
    ) -> None:
```

Calls to a composed runtime are plain `await`s on the instance BioEngine injects — `await self.runtime_a.process_text(text)` — **not** the raw Ray `DeploymentHandle.method.remote(...)` pattern. Methods on a runtime that are only called through composition (never called directly by an external Hypha client) don't need `@bioengine.method` — that decorator is only for exposing a method as a public RPC endpoint on the entry.

> **numpy/ndarray payloads between composed deployments.** Composition calls route through Ray Serve's own `DeploymentHandle.remote()` transport (the `await self.runtime_a....` proxy wraps it), not Hypha/JSON-RPC, so raw `numpy.ndarray` and other native Python objects can be passed and returned directly between composed deployments without a `.tolist()`/JSON-serialisable conversion — this holds whether the two deployments' replicas land on the same worker node or different ones, since Ray's own object transport handles the transfer either way. The `.tolist()` rule (see [Key rules](../SKILL.md#key-rules)) only applies at the external Hypha boundary, i.e. an `@bioengine.method` return value going back to a Hypha client through `ProxyDeployment`.

### `manifest.yaml`

```yaml
name: My Composition App
id: my-composition-app
id_emoji: "🔬"
description: "Multi-deployment composition app"
type: ray-serve
format_version: 0.6.0
version: 1.0.0
authors:
  - {name: "Your Name", affiliation: "Your Org"}
license: MIT
entry: entry_deployment:EntryDeployment
authorized_users:
  - "*"
```

### `entry_deployment.py`

```python
"""Entry deployment — orchestrates RuntimeA, RuntimeB, RuntimeC."""
import asyncio
import time

from pydantic import Field

import bioengine
from runtime_a import RuntimeA
from runtime_b import RuntimeB
from runtime_c import RuntimeC

logger = bioengine.logger


@bioengine.app(
    num_cpus=0,
    num_gpus=0,
    memory_mb=256,
    pip=[],
    max_ongoing_requests=20,
)
class EntryDeployment:
    def __init__(
        self,
        runtime_a: RuntimeA,
        runtime_b: RuntimeB,
        runtime_c: RuntimeC,
    ) -> None:
        self.runtime_a = runtime_a
        self.runtime_b = runtime_b
        self.runtime_c = runtime_c
        self.start_time = time.time()

    @bioengine.smoke_test
    async def smoke(self) -> None:
        ping_a = await self.runtime_a.ping()
        ping_b = await self.runtime_b.ping()
        ping_c = await self.runtime_c.ping()
        assert ping_a == "pong"
        assert ping_b == "pong"
        assert ping_c == "pong"

    @bioengine.method
    async def status(self) -> dict:
        """Get status from all runtimes."""
        a, b, c = await asyncio.gather(
            self.runtime_a.get_status(),
            self.runtime_b.get_status(),
            self.runtime_c.get_status(),
        )
        return {"entry_uptime": time.time() - self.start_time, "runtime_a": a, "runtime_b": b, "runtime_c": c}

    @bioengine.method
    async def process_text(self, text: str = Field(..., description="Text to process")) -> dict:
        """Process text through RuntimeA."""
        return await self.runtime_a.process_text(text)

    @bioengine.method
    async def analyze_data(self, values: list = Field(..., description="List of numbers")) -> dict:
        """Run statistical analysis through RuntimeB."""
        return await self.runtime_b.analyze(values)

    @bioengine.method
    async def pipeline(
        self,
        text: str = Field(..., description="Text input"),
        values: list = Field(..., description="Numeric values"),
    ) -> dict:
        """Run runtimes A and B in parallel."""
        text_result, data_result = await asyncio.gather(
            self.runtime_a.process_text(text),
            self.runtime_b.analyze(values),
        )
        return {"text": text_result, "data": data_result}
```

### `runtime_a.py`

```python
"""RuntimeA — text processing."""
import bioengine

logger = bioengine.logger


@bioengine.app(
    num_cpus=1,
    num_gpus=0,
    memory_mb=512,
    pip=[],
    max_ongoing_requests=5,
)
class RuntimeA:
    @bioengine.async_init
    async def load(self) -> None:
        logger.info("RuntimeA ready")

    @bioengine.smoke_test
    async def smoke(self) -> None:
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
import bioengine

logger = bioengine.logger


@bioengine.app(
    num_cpus=1,
    num_gpus=0,
    memory_mb=512,
    pip=["numpy==1.26.4"],
    max_ongoing_requests=5,
)
class RuntimeB:
    @bioengine.async_init
    async def load(self) -> None:
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
import bioengine

logger = bioengine.logger


@bioengine.app(
    num_cpus=1,
    num_gpus=0,
    memory_mb=1024,
    pip=["numpy==1.26.4", "pillow==10.4.0"],
    max_ongoing_requests=5,
)
class RuntimeC:
    @bioengine.async_init
    async def load(self) -> None:
        from PIL import Image  # noqa: F401
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

*(Validated: this exact 3-runtime composition deploys green on a live worker — all deployments HEALTHY, and `status`, `process_text`, `analyze_data`, `pipeline` all call successfully end-to-end through the composed runtimes.)*

---

## Frontend UI template

This is the reference frontend for a BioEngine app: **one self-contained
`index.html`, no build step, no framework**, one CDN import for `hypha-rpc`.
Copy the whole file into `frontend/index.html`, add `frontend_entry:
"frontend/index.html"` to your manifest, and fill in the six places marked
`▸ EDIT`. Everything else works as shipped.

Being a single copy-pasteable file is the point. Prefer keeping it that way over
any polish that would require a bundler.

What you get beyond auth and RPC wiring:

| Subsystem | What it does |
|---|---|
| **Theme** | Full dark + light token sets on `[data-theme]`. No raw hex outside the two token blocks, so a third theme is a copy-paste. Set on `<html>` by an inline `<head>` script, so there is no flash of the wrong theme. Explicit choice persists in `localStorage` and beats the OS. |
| **Image input** | File picker *and* drag-and-drop on one zone, keyboard-activatable, with the `dragleave`-fires-on-children bug already handled. Non-images are rejected with a non-blocking notice. |
| **Inspection** | One zoom / pan / fit / 1:1 viewer used for the uploaded input **and** for any image the backend returns. Natural dimensions, file size, and `image-rendering: pixelated` at high zoom, because pixel inspection is the point in microscopy. |
| **Before/after** | A `clip-path: inset()` comparison slider, shown once both an input and a result exist. |
| **Info popover** | Origin-aware popover whose prose comes from an `APP_INFO` object — an app author writes sentences, not markup. |
| **Busy feedback** | One controller for every wait (connect, read, encode, inference): motion plus a changing phase label, determinate only where a real fraction exists, and a single `endBusy()` that every caller puts in a `finally`. |
| **Errors** | Nothing external ever fails silently. User-initiated RPCs get a modal with a scrollable, copyable trace. Boot-time and background failures get a clickable status line that opens the same modal on demand, so they never ambush a page load and never disappear into the console. |

*(Validated: `frontend_entry` + `static_site_url` confirmed against a live 0.6.0 app on a running worker — the populated URL carries exactly the `server=` and `ws_service_id=` query params this template's boot script reads. The HTML/JS itself is 0.6.0-format-agnostic — it talks to Hypha RPC, not to the manifest — so it needed no porting.)*

*(Also browser-verified end to end on a live worker with Playwright: both themes, theme persistence across reload, file-picker upload, synthesised-`DataTransfer` drag-and-drop, zoom/pan/fit/1:1 on both the input and a backend-produced overlay, the info popover, a populated 313-row result, determinate upload progress on a 47 MB file, indeterminate inference with a >10s reassurance, and the busy state clearing on both success and a forced backend error. Zero JS page errors.)*

```html
<!DOCTYPE html>
<!-- ===========================================================================
     BioEngine app-UI template — single self-contained file, no build step.

     Copy this whole file to `frontend/index.html`, add `frontend_entry:
     "frontend/index.html"` to your manifest, and fill in the six places marked
     `▸ EDIT`. Everything else (theme, auth, upload, preview, inspect, errors)
     works as-is.

     ▸ EDIT 1  <title> and the topbar brand
     ▸ EDIT 2  APP_INFO — the prose in the info popover
     ▸ EDIT 3  TOKEN_KEY / TOKEN_EXPIRY — must be unique per app
     ▸ EDIT 4  callBackend() — your @bioengine.method name and arguments
     ▸ EDIT 5  renderResult() — how your result object maps onto the UI
     ▸ EDIT 6  the parameter controls in the "Parameters" card
     =========================================================================== -->
<!-- data-theme here only governs the very first paint when JS has not run (or
     localStorage is blocked). Light, because that is what bioimage.io looks
     like. The boot script below immediately replaces it with the OS preference
     or the user's stored choice. -->
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<!-- ▸ EDIT 1 -->
<title>Nuclei Segmentation — BioEngine</title>

<!-- No-flash theme boot. Must run BEFORE the stylesheet paints: it sets
     data-theme on <html> synchronously, so the page never renders in the
     wrong theme and then snaps. An explicit user choice in localStorage always
     wins over the OS preference.
     Same discipline as the topbar's "both buttons start hidden" pattern. -->
<script>
  (function () {
    var KEY = "bioengine-app:theme";           // ▸ EDIT 3 (keep in sync below)

    // ---- Theme policy — the only two knobs. -----------------------------
    // First visit follows the OS preference. Browsers cannot report "no
    // preference": `prefers-color-scheme` resolves to `light` unless dark is
    // explicitly set, so this is a two-way branch, not a three-way one.
    var SEED_FROM_OS = true;

    // NOT "the app's default theme" — it is only the branch taken when the OS
    // does NOT report a light preference, i.e. a dark-OS machine, plus the
    // fallback when JS or localStorage is unavailable. Leave it "dark": it is
    // the dark-OS branch, so setting it to "light" would silently destroy OS
    // seeding for every dark-OS user.
    var FALLBACK_THEME = "dark";

    // Net effect with the defaults above:
    //   stock light-OS machine -> light   (the common case)
    //   dark-OS machine        -> dark
    //   no JS / storage blocked -> light  (the data-theme on <html>)
    //   returning user          -> whatever they last chose, always
    //
    // To ship a single-theme app instead: set SEED_FROM_OS = false and
    // FALLBACK_THEME to the theme you want, and delete #themeBtn. Both token
    // blocks can stay; the unused one costs nothing.
    var t;
    // localStorage throws in private mode and with third-party cookies
    // blocked. Safe to ignore: the OS branch below is a correct fallback.
    try { t = localStorage.getItem(KEY); } catch (e) {}
    if (t !== "light" && t !== "dark") {
      t = (SEED_FROM_OS && window.matchMedia
           && window.matchMedia("(prefers-color-scheme: light)").matches)
        ? "light" : FALLBACK_THEME;
    }
    document.documentElement.setAttribute("data-theme", t);
  })();
</script>

<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* The user-agent rule `[hidden] { display: none }` loses to any class that
     sets `display: flex/inline-flex`. Force-override so `el.hidden = true`
     actually hides those elements. Load-bearing — ship it every time. */
  [hidden] { display: none !important; }

  /* ---- Tokens -----------------------------------------------------------
     Every colour in this file comes from here. There are no raw hex values
     below the two theme blocks — that is what makes a second theme cheap. */
  :root {
    /* Emil Kowalski's strong easing curves. The built-in CSS easings are too
       weak; these are what make the motion feel intentional. */
    --ease-out:    cubic-bezier(0.23, 1, 0.32, 1);
    --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);

    --r-sm: 0.4rem;
    --r-md: 0.55rem;
    --r-lg: 0.85rem;
    --r-pill: 999px;

    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  /* Dark — the default. Deep desaturated navy so a 16-bit fluorescence crop
     is the brightest thing on screen. */
  [data-theme="dark"] {
    --bg-0: #0b1220;          /* page                       */
    --bg-1: #111a2d;          /* raised surface / topbar     */
    --bg-2: #18223a;          /* card                        */
    --bg-3: #1f2c4a;          /* hover / inset               */
    --border:        #2a3a5e;
    --border-strong: #3a4d75;
    --fg:       #e6edf7;
    --fg-dim:   #9aa9c2;
    --fg-muted: #6b7a99;

    --accent:        #38bdf8;
    --accent-strong: #0ea5e9;
    --accent-deep:   #0284c7;
    --accent-fg:     #04121e;   /* text ON an accent fill    */
    --accent-soft:   rgba(56, 189, 248, 0.14);
    --accent-ghost:  rgba(56, 189, 248, 0.07);

    --ok:   #22c55e;  --ok-soft:   rgba(34, 197, 94, 0.14);
    --warn: #f59e0b;  --warn-soft: rgba(245, 158, 11, 0.14);
    --err:  #f87171;  --err-soft:  rgba(248, 113, 113, 0.14);

    --scrim:    rgba(3, 7, 15, 0.72);
    --shadow-md: 0 10px 26px rgba(0, 0, 0, 0.45);
    --shadow-lg: 0 24px 60px rgba(0, 0, 0, 0.60);
    --checker:  rgba(255, 255, 255, 0.045);
    --glow-1:   rgba(14, 165, 233, 0.10);
    --glow-2:   rgba(34, 197, 94, 0.05);
    --topbar-bg: rgba(11, 18, 32, 0.82);
  }

  /* Light — a first-class theme, not an inversion. Tailwind slate + the
     bioimage.io brand blue, so an app dropped next to the website matches it. */
  [data-theme="light"] {
    --bg-0: #f8fafc;          /* slate-50  page              */
    --bg-1: #ffffff;          /* topbar                      */
    --bg-2: #ffffff;          /* card                        */
    --bg-3: #f1f5f9;          /* slate-100 hover / inset     */
    --border:        #e2e8f0; /* slate-200 */
    --border-strong: #cbd5e1; /* slate-300 */
    --fg:       #0f172a;      /* slate-900 */
    --fg-dim:   #475569;      /* slate-600 */
    --fg-muted: #94a3b8;      /* slate-400 */

    --accent:        #2563eb; /* blue-600 — bioimage.io brand */
    --accent-strong: #1d4ed8; /* blue-700 */
    --accent-deep:   #1e40af; /* blue-800 */
    --accent-fg:     #ffffff;
    --accent-soft:   rgba(37, 99, 235, 0.10);
    --accent-ghost:  rgba(37, 99, 235, 0.05);

    --ok:   #16a34a;  --ok-soft:   rgba(22, 163, 74, 0.10);
    --warn: #d97706;  --warn-soft: rgba(217, 119, 6, 0.12);
    --err:  #dc2626;  --err-soft:  rgba(220, 38, 38, 0.09);

    --scrim:    rgba(15, 23, 42, 0.42);
    --shadow-md: 0 8px 22px rgba(15, 23, 42, 0.08);
    --shadow-lg: 0 24px 50px rgba(15, 23, 42, 0.16);
    --checker:  rgba(15, 23, 42, 0.05);
    --glow-1:   rgba(37, 99, 235, 0.07);
    --glow-2:   rgba(14, 165, 233, 0.05);
    --topbar-bg: rgba(255, 255, 255, 0.85);
  }

  /* Theme switch: colours only, 160ms, never layout. The class is added for
     exactly the length of the transition and then removed, so it can never
     interfere with the interaction transitions below. */
  html.theme-switching, html.theme-switching *,
  html.theme-switching *::before, html.theme-switching *::after {
    transition: background-color 160ms var(--ease-out),
                border-color     160ms var(--ease-out),
                color            160ms var(--ease-out),
                fill             160ms var(--ease-out),
                stroke           160ms var(--ease-out) !important;
    transition-delay: 0s !important;
  }

  /* ---- Base -------------------------------------------------------------- */
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, "Segoe UI", sans-serif;
    background:
      radial-gradient(1200px 600px at 82% -220px, var(--glow-1), transparent 70%),
      radial-gradient(900px 500px at -10% 110%, var(--glow-2), transparent 70%),
      var(--bg-0);
    background-attachment: fixed;
    color: var(--fg);
    min-height: 100vh;
    padding: 4.6rem 1rem 4rem;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 1120px; margin: 0 auto; }
  h1, h2, h3 { line-height: 1.25; }
  code, .mono { font-family: var(--mono); }

  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--r-sm);
  }
  ::selection { background: var(--accent-soft); }

  /* ---- Topbar ------------------------------------------------------------ */
  #topbar {
    position: fixed; inset: 0 0 auto 0; z-index: 60;
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; padding: 0.7rem 1.15rem;
    background: var(--topbar-bg);
    -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  #topbar .brand {
    display: flex; align-items: center; gap: 0.55rem;
    font-weight: 650; font-size: 0.92rem; letter-spacing: -0.01em;
    min-width: 0;
  }
  #topbar .brand .brand-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #topbar .brand .logo {
    width: 1.7rem; height: 1.7rem; border-radius: var(--r-md); flex-shrink: 0;
    background: linear-gradient(135deg, var(--accent), var(--accent-deep));
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 0.95rem;
  }
  #topbar .actions { display: flex; align-items: center; gap: 0.45rem; flex-shrink: 0; }

  .topbar-btn {
    display: inline-flex; align-items: center; gap: 0.4rem;
    background: var(--bg-2); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 0.4rem 0.85rem;
    font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer;
    transition: background-color 140ms var(--ease-out),
                border-color 140ms var(--ease-out),
                transform 140ms var(--ease-out);
  }
  .topbar-btn:active { transform: scale(0.97); }
  .topbar-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .topbar-btn svg { width: 1.05rem; height: 1.05rem; flex-shrink: 0; }

  .topbar-iconbtn {
    position: relative;
    background: var(--bg-2); border: 1px solid var(--border);
    border-radius: var(--r-pill); width: 2.15rem; height: 2.15rem;
    display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer; padding: 0; color: var(--fg-dim);
    transition: background-color 140ms var(--ease-out),
                color 140ms var(--ease-out),
                border-color 140ms var(--ease-out),
                transform 140ms var(--ease-out);
  }
  .topbar-iconbtn:active { transform: scale(0.95); }
  .topbar-iconbtn svg { width: 1.2rem; height: 1.2rem; }

  @media (hover: hover) and (pointer: fine) {
    .topbar-btn:hover { background: var(--bg-3); border-color: var(--border-strong); }
    .topbar-iconbtn:hover { background: var(--bg-3); color: var(--fg); border-color: var(--border-strong); }
  }

  /* Theme toggle — the two icons are stacked and crossfade. Sub-200ms and
     transform/opacity only, so it never touches layout. */
  #themeBtn .icon { position: absolute; width: 1.2rem; height: 1.2rem;
                    transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out); }
  [data-theme="dark"]  #themeBtn .icon-sun  { opacity: 1; transform: rotate(0deg)   scale(1); }
  [data-theme="dark"]  #themeBtn .icon-moon { opacity: 0; transform: rotate(-45deg) scale(0.75); }
  [data-theme="light"] #themeBtn .icon-sun  { opacity: 0; transform: rotate(45deg)  scale(0.75); }
  [data-theme="light"] #themeBtn .icon-moon { opacity: 1; transform: rotate(0deg)   scale(1); }

  /* ---- Popovers ---------------------------------------------------------- */
  #userWrap, #infoWrap { position: relative; }
  .popover {
    position: absolute; top: 2.6rem; right: 0; z-index: 70;
    min-width: 17rem; max-width: min(24rem, calc(100vw - 2rem));
    background: var(--bg-2); border: 1px solid var(--border-strong);
    border-radius: var(--r-lg); padding: 0.35rem 0;
    box-shadow: var(--shadow-lg);
    opacity: 1; transform: translateY(0) scale(1);
    /* Origin-aware: it scales out of the button that opened it, not out of
       its own centre. Modals stay centred; popovers never should. */
    transform-origin: top right;
    transition: opacity 170ms var(--ease-out), transform 170ms var(--ease-out);
  }
  @starting-style {
    .popover { opacity: 0; transform: translateY(-5px) scale(0.96); }
  }
  .popover .item {
    display: block; width: 100%; text-align: left;
    padding: 0.55rem 0.9rem; color: var(--fg); font: inherit; font-size: 0.85rem;
    background: none; border: 0; cursor: pointer;
    transition: background-color 120ms var(--ease-out), transform 120ms var(--ease-out);
  }
  .popover .item:active { transform: scale(0.98); }
  @media (hover: hover) and (pointer: fine) { .popover .item:hover { background: var(--bg-3); } }
  .popover .info-row {
    padding: 0.5rem 0.9rem; border-bottom: 1px solid var(--border);
    font-size: 0.78rem; color: var(--fg-dim); word-break: break-all;
  }
  .popover .info-row strong { color: var(--fg); font-weight: 600; }
  .popover .heading {
    padding: 0.5rem 0.9rem 0.5rem; font-size: 0.7rem; font-weight: 650;
    color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.08em;
    border-bottom: 1px solid var(--border);
  }
  #infoPopover { min-width: 21rem; padding-bottom: 0.5rem; }
  #infoPopover .para { padding: 0.6rem 0.95rem 0.15rem; font-size: 0.82rem; color: var(--fg-dim); }
  #infoPopover .para strong { color: var(--fg); font-weight: 600; }
  #infoPopover dl { padding: 0.35rem 0.95rem 0.15rem; font-size: 0.8rem; }
  #infoPopover dt {
    font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--fg-muted); margin-top: 0.6rem; font-weight: 650;
  }
  #infoPopover dd { color: var(--fg); margin-top: 0.12rem; }
  #infoPopover dd code {
    font-size: 0.76rem; background: var(--bg-3); border: 1px solid var(--border);
    border-radius: var(--r-sm); padding: 0.05rem 0.3rem;
  }

  /* ---- Page header ------------------------------------------------------- */
  header.page { margin: 0.6rem 0 1.6rem; }
  header.page h1 {
    font-size: clamp(1.5rem, 3.2vw, 2rem); font-weight: 700; letter-spacing: -0.025em;
  }
  header.page h1 .accent {
    background: linear-gradient(100deg, var(--accent), var(--accent-strong));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  header.page p { color: var(--fg-dim); font-size: 0.92rem; margin-top: 0.45rem; max-width: 62ch; }
  header.page p strong { color: var(--fg); font-weight: 600; }

  /* ---- No-JS notice ------------------------------------------------------
     Without JS this page is not a degraded app, it is an inert screenshot of
     one: the status line reads "Connecting…" forever and NEITHER auth button
     appears, because the topbar pattern starts both `hidden` and relies on the
     boot script to reveal one. Say so, at the top, before the user spends a
     minute clicking a UI that cannot respond. Background is the OPAQUE --bg-2,
     not the translucent --warn-soft: this sits above a full, healthy-looking
     interface, and a notice you can see the broken UI through reads as part of
     the broken UI. The warn colour carries on the border instead. */
  noscript .nojs {
    display: block; margin: 0 0 1rem;
    background: var(--bg-2); color: var(--fg);
    border: 1px solid var(--warn); border-left-width: 3px;
    border-radius: var(--r-md); padding: 0.8rem 0.95rem;
    font-size: 0.88rem; line-height: 1.5;
  }
  noscript .nojs strong { font-weight: 650; }

  /* ---- Layout ------------------------------------------------------------ */
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; align-items: start; }
  .col  { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
  @media (max-width: 860px) { .grid { grid-template-columns: minmax(0, 1fr); } }

  .card {
    background: var(--bg-2); border: 1px solid var(--border);
    border-radius: var(--r-lg); padding: 1.1rem 1.15rem 1.2rem;
    box-shadow: var(--shadow-md);
  }
  .card > h2 {
    font-size: 0.76rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.09em;
    color: var(--fg-muted); margin-bottom: 0.85rem;
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  }
  .card > h2 .badge {
    text-transform: none; letter-spacing: 0; font-size: 0.72rem; font-weight: 600;
    color: var(--accent); background: var(--accent-soft);
    border-radius: var(--r-pill); padding: 0.1rem 0.5rem;
  }

  /* ---- Buttons ----------------------------------------------------------- */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;
    font: inherit; font-size: 0.86rem; font-weight: 600; cursor: pointer;
    border-radius: var(--r-md); padding: 0.55rem 1rem;
    border: 1px solid var(--border); background: var(--bg-3); color: var(--fg);
    transition: background-color 140ms var(--ease-out),
                border-color 140ms var(--ease-out),
                opacity 140ms var(--ease-out),
                transform 140ms var(--ease-out);
  }
  .btn svg { width: 1rem; height: 1rem; flex-shrink: 0; }
  .btn .btn-icon { display: inline-flex; align-items: center; flex-shrink: 0; }
  .btn:active { transform: scale(0.97); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn:disabled:active { transform: none; }
  .btn-primary {
    background: var(--accent); border-color: var(--accent); color: var(--accent-fg);
    padding: 0.62rem 1.15rem;
  }
  .btn-block { width: 100%; }
  @media (hover: hover) and (pointer: fine) {
    .btn:hover:not(:disabled) { background: var(--bg-2); border-color: var(--border-strong); }
    .btn-primary:hover:not(:disabled) { background: var(--accent-strong); border-color: var(--accent-strong); }
  }

  /* ---- Drop zone --------------------------------------------------------- */
  .dropzone {
    position: relative; display: block; width: 100%;
    border: 1.5px dashed var(--border-strong); border-radius: var(--r-lg);
    background: var(--accent-ghost); color: var(--fg-dim);
    padding: 1.8rem 1rem; text-align: center; cursor: pointer;
    font: inherit;
    transition: background-color 160ms var(--ease-out),
                border-color 160ms var(--ease-out),
                color 160ms var(--ease-out),
                transform 160ms var(--ease-out);
  }
  .dropzone:active { transform: scale(0.985); }
  .dropzone .dz-icon {
    width: 2.1rem; height: 2.1rem; margin: 0 auto 0.55rem; display: block;
    color: var(--fg-muted);
    transition: color 160ms var(--ease-out), transform 200ms var(--ease-out);
  }
  .dropzone .dz-title { font-size: 0.9rem; font-weight: 600; color: var(--fg); }
  .dropzone .dz-hint  { font-size: 0.78rem; color: var(--fg-muted); margin-top: 0.2rem; }
  @media (hover: hover) and (pointer: fine) {
    .dropzone:hover { border-color: var(--accent); background: var(--accent-soft); }
    .dropzone:hover .dz-icon { color: var(--accent); }
  }
  /* Drag state — unmistakable, and driven by a counter so it cannot flicker
     when the pointer crosses a child element. */
  .dropzone.dragging {
    border-color: var(--accent); border-style: solid;
    background: var(--accent-soft); color: var(--fg);
    transform: scale(1.01);
  }
  .dropzone.dragging .dz-icon { color: var(--accent); transform: translateY(-3px); }

  /* ---- Image preview ----------------------------------------------------- */
  .preview { margin-top: 0.9rem; }
  .thumb-btn {
    position: relative; display: block; width: 100%; padding: 0;
    border: 1px solid var(--border); border-radius: var(--r-md);
    background: var(--bg-0);
    cursor: zoom-in; overflow: hidden;
    transition: border-color 140ms var(--ease-out), transform 140ms var(--ease-out);
  }
  .thumb-btn:active { transform: scale(0.985); }
  .thumb-btn img {
    display: block; margin: 0 auto;
    width: auto; max-width: 100%; max-height: 15rem; object-fit: contain;
  }
  .thumb-btn .zoom-cue {
    position: absolute; right: 0.5rem; bottom: 0.5rem;
    display: inline-flex; align-items: center; gap: 0.3rem;
    font-size: 0.7rem; font-weight: 600; color: var(--fg);
    background: var(--topbar-bg); border: 1px solid var(--border);
    -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    border-radius: var(--r-pill); padding: 0.2rem 0.5rem;
    opacity: 0; transform: translateY(3px);
    transition: opacity 160ms var(--ease-out), transform 160ms var(--ease-out);
  }
  .thumb-btn .zoom-cue svg { width: 0.8rem; height: 0.8rem; }
  @media (hover: hover) and (pointer: fine) {
    .thumb-btn:hover { border-color: var(--accent); }
    .thumb-btn:hover .zoom-cue { opacity: 1; transform: translateY(0); }
  }
  .thumb-btn:focus-visible .zoom-cue { opacity: 1; transform: translateY(0); }

  .meta-row {
    display: flex; flex-wrap: wrap; gap: 0.35rem 0.5rem; align-items: center;
    margin-top: 0.6rem; font-size: 0.76rem; color: var(--fg-dim);
  }
  .meta-row .name {
    color: var(--fg); font-weight: 600; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .meta-row .chip {
    font-family: var(--mono); font-size: 0.71rem;
    background: var(--bg-3); border: 1px solid var(--border);
    border-radius: var(--r-sm); padding: 0.08rem 0.38rem; color: var(--fg-dim);
  }
  .meta-row .spacer { flex: 1 1 auto; }

  /* ---- Params ------------------------------------------------------------ */
  .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.8rem; }
  .field > label { font-size: 0.78rem; font-weight: 600; color: var(--fg-dim); }
  .field .hint { font-size: 0.72rem; color: var(--fg-muted); }
  select, input[type="number"], input[type="text"] {
    font: inherit; font-size: 0.85rem; color: var(--fg);
    background: var(--bg-3); border: 1px solid var(--border);
    border-radius: var(--r-md); padding: 0.45rem 0.6rem; width: 100%;
    transition: border-color 140ms var(--ease-out), background-color 140ms var(--ease-out);
  }
  select:focus, input:focus { border-color: var(--accent); }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; }

  .status-row { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.85rem; font-size: 0.8rem; color: var(--fg-dim); }
  .status-dot {
    width: 0.5rem; height: 0.5rem; border-radius: var(--r-pill); flex-shrink: 0;
    background: var(--fg-muted);
    transition: background-color 160ms var(--ease-out);
  }
  .status-dot.ok   { background: var(--ok); }
  .status-dot.err  { background: var(--err); }
  #status.ok { color: var(--fg-dim); }
  #status.err { color: var(--err); }
  #status { min-width: 0; }
  #elapsed { font-family: var(--mono); font-size: 0.73rem; color: var(--fg-muted); margin-left: auto; }

  /* Deferred-error affordance: real button semantics, keyboard reachable, and
     it has to LOOK pressable or nobody discovers the error behind it. */
  .status-btn {
    display: inline-flex; align-items: center; gap: 0.25rem; flex-shrink: 0;
    font: inherit; font-size: 0.74rem; font-weight: 600; cursor: pointer;
    color: var(--err); background: var(--err-soft);
    border: 1px solid var(--err); border-radius: var(--r-pill);
    padding: 0.1rem 0.5rem 0.1rem 0.35rem;
    transition: background-color 130ms var(--ease-out),
                transform 130ms var(--ease-out);
  }
  .status-btn svg { width: 0.85rem; height: 0.85rem; }
  .status-btn:active { transform: scale(0.96); }
  @media (hover: hover) and (pointer: fine) {
    .status-btn:hover { background: var(--err); color: var(--accent-fg); }
  }

  /* ---- Busy feedback -----------------------------------------------------
     A disabled control says "blocked", not "busy". Every wait longer than a
     blink gets motion + a phase label, and every wait ends through the single
     endBusy() call so a failure can never leave a spinner running. */
  .spinner {
    width: 0.9rem; height: 0.9rem; flex-shrink: 0; border-radius: var(--r-pill);
    border: 2px solid currentColor; border-top-color: transparent;
    /* Deliberately fast: the same wait feels shorter behind a quicker spinner. */
    animation: spin 560ms linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  .progress {
    position: relative; height: 3px; margin-top: 0.6rem; overflow: hidden;
    background: var(--bg-3); border-radius: var(--r-pill);
  }
  .progress .bar {
    position: absolute; inset: 0; border-radius: inherit;
    background: var(--accent); transform-origin: left center;
    transform: scaleX(var(--p, 0));
    transition: transform 180ms var(--ease-out);
  }
  /* No honest fraction to show -> a sweep. Never a fabricated percentage. */
  .progress.indeterminate .bar {
    inset: 0 auto 0 0; width: 38%;
    transition: none; transform: translateX(-100%);
    animation: sweep 1s var(--ease-in-out) infinite;
  }
  @keyframes sweep { to { transform: translateX(263%); } }

  .busy-hint {
    margin-top: 0.5rem; font-size: 0.76rem; color: var(--fg-muted);
    opacity: 1; transition: opacity 200ms var(--ease-out);
  }
  @starting-style { .busy-hint { opacity: 0; } }

  /* The Run button is full-width so it cannot reflow; the fixed-width label
     keeps the spinner from sliding as the phase name changes. */
  #runBtn .label { min-width: 10.5rem; text-align: center; }

  /* Skeleton — only for the FIRST result, so the layout does not jump when
     data lands. A re-run keeps the previous result in place and dims it. */
  .sk { position: relative; overflow: hidden; border-radius: var(--r-md); background: var(--bg-3); }
  .sk::after {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent, var(--accent-soft), transparent);
    transform: translateX(-100%);
    animation: shimmer 1.15s linear infinite;
  }
  .sk-stat { flex: 1 1 6rem; height: 3.3rem; }
  .sk-img  { height: 11rem; margin-bottom: 0.9rem; }
  .sk-row  { height: 1.1rem; margin-bottom: 0.42rem; }
  .sk-row:nth-child(even) { opacity: 0.7; }
  @keyframes shimmer { to { transform: translateX(100%); } }
  #resultBody.rerunning { opacity: 0.45; transition: opacity 180ms var(--ease-out); }

  /* Completion registers — but only the first time. A user who runs this
     twenty times does not need twenty celebrations. */
  .badge.pop { animation: pop 420ms var(--ease-out); }
  @keyframes pop {
    0%   { transform: scale(0.9); opacity: 0.4; }
    55%  { transform: scale(1.06); opacity: 1; }
    100% { transform: scale(1); }
  }

  /* ---- Result ------------------------------------------------------------ */
  .empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 0.4rem; padding: 2.4rem 1rem; text-align: center; color: var(--fg-muted);
    border: 1px dashed var(--border); border-radius: var(--r-lg); font-size: 0.83rem;
  }
  .empty svg { width: 1.8rem; height: 1.8rem; opacity: 0.6; }

  .stats { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-bottom: 0.9rem; }
  .stat {
    flex: 1 1 6rem; background: var(--bg-3); border: 1px solid var(--border);
    border-radius: var(--r-md); padding: 0.55rem 0.7rem;
    opacity: 0; transform: translateY(6px);
    animation: riseIn 300ms var(--ease-out) forwards;
    animation-delay: var(--d, 0ms);
  }
  .stat .k { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--fg-muted); font-weight: 650; }
  .stat .v { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em; margin-top: 0.1rem; }
  .stat.accent .v { color: var(--accent); }
  @keyframes riseIn { to { opacity: 1; transform: none; } }

  .table-wrap {
    max-height: 17rem; overflow: auto; border: 1px solid var(--border);
    border-radius: var(--r-md); margin-top: 0.9rem;
  }
  table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  thead th {
    position: sticky; top: 0; z-index: 1;
    background: var(--bg-3); color: var(--fg-muted);
    font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 650;
    text-align: right; padding: 0.45rem 0.7rem; border-bottom: 1px solid var(--border);
  }
  thead th:first-child { text-align: left; }
  tbody td {
    padding: 0.32rem 0.7rem; text-align: right; font-family: var(--mono); font-size: 0.74rem;
    color: var(--fg-dim); border-bottom: 1px solid var(--border);
  }
  tbody td:first-child { text-align: left; color: var(--fg-muted); }
  tbody tr:last-child td { border-bottom: 0; }
  /* Stagger the first rows on first paint. Capped at 14 rows — a 300-row
     cascade would just read as lag. Decorative only; never blocks reading. */
  tbody tr {
    opacity: 0; transform: translateY(5px);
    animation: riseIn 260ms var(--ease-out) forwards;
    animation-delay: var(--d, 0ms);
  }
  @media (hover: hover) and (pointer: fine) { tbody tr:hover td { background: var(--accent-ghost); } }

  /* ---- Before / after compare -------------------------------------------- */
  #compareCard { margin-top: 1rem; }
  .compare {
    position: relative; width: 100%; border-radius: var(--r-md);
    border: 1px solid var(--border); overflow: hidden; background: var(--bg-3);
    --split: 50%;
    touch-action: none;
  }
  .compare img { display: block; width: 100%; height: auto; }
  /* The RESULT is the base layer; the INPUT sits on top, clipped to the left
     `--split`% — so the left of the slider is "before" and the right is
     "after", which is the direction everyone expects. One property,
     hardware-accelerated, no extra DOM. */
  .compare .clip {
    position: absolute; inset: 0; width: 100%; height: 100%;
    clip-path: inset(0 calc(100% - var(--split)) 0 0);
  }
  .compare .clip img { height: 100%; object-fit: fill; }
  .compare .handle {
    position: absolute; top: 0; bottom: 0; left: var(--split);
    width: 2px; margin-left: -1px; background: var(--accent);
    pointer-events: none;
  }
  .compare .handle::after {
    content: ""; position: absolute; top: 50%; left: 50%;
    width: 1.9rem; height: 1.9rem; margin: -0.95rem 0 0 -0.95rem;
    border-radius: var(--r-pill); background: var(--accent);
    border: 2px solid var(--accent-fg);
    box-shadow: var(--shadow-md);
    transition: transform 160ms var(--ease-out);
  }
  .compare:focus-within .handle::after { transform: scale(1.12); }
  .compare .tag {
    position: absolute; top: 0.5rem; font-size: 0.68rem; font-weight: 650;
    letter-spacing: 0.06em; text-transform: uppercase;
    background: var(--topbar-bg); border: 1px solid var(--border); color: var(--fg-dim);
    -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    border-radius: var(--r-pill); padding: 0.15rem 0.5rem; pointer-events: none;
  }
  .compare .tag-before { left: 0.5rem; }
  .compare .tag-after  { right: 0.5rem; }
  /* A real range input carries the keyboard + a11y semantics; it is laid over
     the image at zero opacity so pointer drag and arrow keys both work. */
  .compare input[type="range"] {
    position: absolute; inset: 0; width: 100%; height: 100%;
    margin: 0; opacity: 0; cursor: ew-resize; -webkit-appearance: none; appearance: none;
    background: transparent;
  }
  .compare input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 2.5rem; height: 100%; }
  .compare input[type="range"]::-moz-range-thumb { width: 2.5rem; height: 100%; border: 0; opacity: 0; }

  /* ---- Inspect modal (zoom / pan / fit / 1:1) ---------------------------- */
  .modal-backdrop {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center; padding: 1.5rem;
    background: var(--scrim);
    -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
    opacity: 1;
    transition: opacity 200ms var(--ease-out);
  }
  @starting-style { .modal-backdrop { opacity: 0; } }
  .modal {
    display: flex; flex-direction: column; min-height: 0;
    width: min(1080px, 100%); height: min(760px, 100%);
    background: var(--bg-2); border: 1px solid var(--border-strong);
    border-radius: var(--r-lg); box-shadow: var(--shadow-lg); overflow: hidden;
    /* Modals are not anchored to a trigger, so they scale from their centre. */
    transform-origin: center;
    opacity: 1; transform: scale(1);
    transition: opacity 220ms var(--ease-out), transform 220ms var(--ease-out);
  }
  @starting-style { .modal { opacity: 0; transform: scale(0.96); } }
  .modal-head {
    display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0;
    padding: 0.7rem 0.8rem 0.7rem 1rem; border-bottom: 1px solid var(--border);
  }
  .modal-head .title { font-size: 0.88rem; font-weight: 650; min-width: 0;
                       overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .modal-head .sub { font-size: 0.74rem; color: var(--fg-muted); font-family: var(--mono); }
  .modal-head .spacer { flex: 1 1 auto; }

  .viewer {
    position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden;
    background:
      repeating-conic-gradient(var(--checker) 0% 25%, transparent 0% 50%) 0 0 / 20px 20px,
      var(--bg-0);
    cursor: grab; touch-action: none;
  }
  .viewer.panning { cursor: grabbing; }
  .viewer img {
    position: absolute; top: 0; left: 0; transform-origin: 0 0;
    max-width: none; max-height: none; user-select: none; -webkit-user-drag: none;
  }
  /* Without this, pixel inspection at high zoom is useless — the browser
     smooths exactly the detail a scientist zoomed in to see. */
  .viewer.pixelated img { image-rendering: pixelated; }

  .viewer-bar {
    display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; flex-wrap: wrap;
    padding: 0.55rem 0.8rem; border-top: 1px solid var(--border); background: var(--bg-1);
  }
  .vbtn {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
    font: inherit; font-size: 0.78rem; font-weight: 600; color: var(--fg-dim);
    background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--r-md);
    min-width: 2rem; height: 2rem; padding: 0 0.55rem; cursor: pointer;
    transition: background-color 130ms var(--ease-out), color 130ms var(--ease-out),
                border-color 130ms var(--ease-out), transform 130ms var(--ease-out);
  }
  .vbtn:active { transform: scale(0.94); }
  .vbtn svg { width: 0.95rem; height: 0.95rem; }
  @media (hover: hover) and (pointer: fine) {
    .vbtn:hover { background: var(--bg-2); color: var(--fg); border-color: var(--border-strong); }
  }
  #zoomLevel {
    font-family: var(--mono); font-size: 0.76rem; color: var(--fg);
    min-width: 4rem; text-align: center;
  }
  .viewer-bar .spacer { flex: 1 1 auto; }
  .viewer-bar .hint { font-size: 0.72rem; color: var(--fg-muted); }

  /* ---- Error dialog ------------------------------------------------------ */
  .dialog {
    width: min(36rem, 100%); background: var(--bg-2);
    border: 1px solid var(--border-strong); border-radius: var(--r-lg);
    box-shadow: var(--shadow-lg); padding: 1.2rem;
    transform-origin: center; opacity: 1; transform: scale(1);
    transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
  }
  @starting-style { .dialog { opacity: 0; transform: scale(0.96); } }
  .dialog-title { display: flex; align-items: flex-start; gap: 0.55rem; font-weight: 650; margin-bottom: 0.6rem; }
  .dialog-icon { display: inline-flex; color: var(--err); flex-shrink: 0; }
  .dialog-icon svg { width: 1.25rem; height: 1.25rem; }
  .dialog-heads { display: flex; flex-direction: column; min-width: 0; }
  .dialog-subtitle {
    font-size: 0.74rem; font-weight: 500; color: var(--fg-muted);
    margin-top: 0.1rem; word-break: break-all;   /* service ids are long */
  }
  .dialog-message { font-size: 0.88rem; color: var(--fg-dim); margin-bottom: 0.9rem; }
  .dialog-message code {
    font-size: 0.82rem; background: var(--bg-3); border: 1px solid var(--border);
    border-radius: var(--r-sm); padding: 0.05rem 0.3rem;
  }
  .dialog-detail {
    display: block; margin: 0; padding: 0.7rem 0.85rem;
    background: var(--bg-0); border: 1px solid var(--border); border-radius: var(--r-md);
    font: 0.76rem/1.45 var(--mono); color: var(--fg-dim);
    max-height: 40vh; overflow: auto; white-space: pre-wrap; word-break: break-word;
  }
  /* Worker tracebacks run to ~100 lines, so the user has to know there is more
     below. Scrollbar styling alone cannot carry that: Chromium draws fade-in
     overlay scrollbars and ignores ::-webkit-scrollbar, so on a static
     screenshot (or a trackpad, or a touch device) there is no visible bar at
     all. Hence an explicit "more below" cue driven by scroll position.

     The cue must not sit ON the text. An earlier version absolutely positioned
     the label over the last visible line, so the one affordance added because a
     scrollbar is invisible went on to obscure the very content it advertised.
     The label now occupies its own reserved row underneath the box.

     Do NOT tell the user the answer is on the last line. In the browser,
     err.stack appends the hypha-rpc CDN frames after the Python traceback, so
     the actionable exception usually sits in the MIDDLE of the scroll. */
  .dialog-detail-wrap { position: relative; margin: 0 0 1.1rem; --hint-row: 1.45rem; }
  /* Anchored above the hint row, so the fade tracks the bottom of the scroll
     box rather than the bottom of the wrapper. */
  .dialog-detail-wrap::after {
    content: ""; position: absolute; left: 1px; right: 1px;
    bottom: calc(var(--hint-row) + 1px);
    height: 1.6rem; border-radius: 0 0 var(--r-md) var(--r-md);
    background: linear-gradient(transparent, var(--bg-0));
    opacity: 0; transition: opacity 160ms var(--ease-out); pointer-events: none;
  }
  .dialog-detail-wrap.more::after { opacity: 1; }
  /* Height is reserved whether or not the hint shows, so revealing it never
     shifts the dialog layout. */
  .more-hint {
    display: flex; justify-content: flex-end; align-items: center; gap: 0.2rem;
    height: var(--hint-row); padding-top: 0.3rem;
    font-size: 0.68rem; font-weight: 650; letter-spacing: 0.02em;
    color: var(--fg-dim); pointer-events: none;
    opacity: 0; transition: opacity 160ms var(--ease-out);
  }
  .dialog-detail-wrap.more .more-hint { opacity: 1; }

  /* Still style the scrollbar where the engine honours it. */
  /* Setting the standard properties makes Chromium IGNORE the ::-webkit-
     scrollbar rules below and fall back to a fade-in overlay bar, so scope
     them to engines that have no ::-webkit-scrollbar (i.e. Firefox). */
  @supports not selector(::-webkit-scrollbar) {
    .dialog-detail, .table-wrap {
      scrollbar-width: thin;
      scrollbar-color: var(--border-strong) transparent;
    }
  }
  /* WebKit/Blink: defining these opts out of overlay scrollbars, so the track
     is always drawn rather than fading in on hover. */
  .dialog-detail::-webkit-scrollbar,
  .table-wrap::-webkit-scrollbar { width: 10px; height: 10px; }
  .dialog-detail::-webkit-scrollbar-track,
  .table-wrap::-webkit-scrollbar-track { background: transparent; }
  .dialog-detail::-webkit-scrollbar-thumb,
  .table-wrap::-webkit-scrollbar-thumb {
    background: var(--border-strong);
    border-radius: var(--r-pill);
    border: 3px solid transparent;
    background-clip: content-box;
  }
  @media (hover: hover) and (pointer: fine) {
    .dialog-detail::-webkit-scrollbar-thumb:hover,
    .table-wrap::-webkit-scrollbar-thumb:hover { background: var(--fg-muted); background-clip: content-box; }
  }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  /* Above .modal-backdrop's z-index: an error raised from inside the image
     inspect overlay must stack in front of it, not behind. */
  #errorDialog { z-index: 110; }

  /* ---- Notice (non-blocking rejection / info messages) ------------------- */
  #notice {
    position: fixed; left: 50%; bottom: 1.4rem; z-index: 200;
    display: flex; align-items: center; gap: 0.55rem;
    max-width: min(30rem, calc(100vw - 2rem));
    padding: 0.6rem 0.9rem; border-radius: var(--r-md);
    background: var(--bg-2); border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg); font-size: 0.83rem; color: var(--fg);
    transform: translateX(-50%) translateY(0); opacity: 1;
    transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
  }
  @starting-style { #notice { opacity: 0; transform: translateX(-50%) translateY(10px); } }
  #notice.leaving { opacity: 0; transform: translateX(-50%) translateY(10px); }
  #notice svg { width: 1.05rem; height: 1.05rem; flex-shrink: 0; }
  /* A `-soft` tint token is ~12% alpha. Everywhere else in this file those sit
     inside an opaque card, so they composite over an opaque parent and are
     fine. #notice is `position: fixed` over page content, so REPLACING the
     background with the tint would make the text unreadable over a dark
     microscopy image. Layer the tint over the opaque base instead.
     Rule for any variant you add: floating element -> tint over an opaque base. */
  #notice.warn {
    border-color: var(--warn);
    background: linear-gradient(var(--warn-soft), var(--warn-soft)), var(--bg-2);
  }
  #notice.warn svg { color: var(--warn); }
  #notice.ok {
    border-color: var(--ok);
    background: linear-gradient(var(--ok-soft), var(--ok-soft)), var(--bg-2);
  }
  #notice.ok svg { color: var(--ok); }
  #notice.err {
    border-color: var(--err);
    background: linear-gradient(var(--err-soft), var(--err-soft)), var(--bg-2);
  }
  #notice.err svg { color: var(--err); }

  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  /* ---- Reduced motion ----------------------------------------------------
     Fewer and gentler, not zero: opacity and colour still carry meaning, only
     movement is removed. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
    .popover, .modal, .dialog, #notice, .stat, tbody tr { transform: none !important; }
    .dropzone.dragging { transform: none; }

    /* Reduced motion must not mean no feedback. The spinner stops rotating and
       the sweep stops travelling, but both keep breathing — opacity is safe
       where movement is not — and the phase text keeps changing regardless. */
    .spinner {
      animation: breathe 1.6s ease-in-out infinite !important;
      border-top-color: currentColor;
    }
    .progress.indeterminate .bar {
      width: 100%; transform: none !important;
      animation: breathe 1.6s ease-in-out infinite !important;
    }
    .sk::after { transform: none !important;
                 animation: breathe 1.8s ease-in-out infinite !important; }
  }
</style>
</head>

<body>

<!-- ======================= TOPBAR =========================================
     Both auth children start `hidden` in the HTML; the boot script reveals
     exactly one (or neither, while auto-connecting) so the Login button never
     flashes for a returning user with a cached token. -->
<div id="topbar">
  <div class="brand">
    <!-- ▸ EDIT 1 -->
    <span class="logo" aria-hidden="true">🔬</span>
    <span class="brand-name">Nuclei Segmentation</span>
  </div>

  <div class="actions">
    <!-- Theme toggle -->
    <button id="themeBtn" class="topbar-iconbtn" type="button"
            aria-label="Switch colour theme" title="Switch colour theme">
      <svg class="icon icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2"/>
        <path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>
      </svg>
      <svg class="icon icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z"/>
      </svg>
    </button>

    <!-- Info button + origin-aware popover -->
    <div id="infoWrap">
      <button id="infoBtn" class="topbar-iconbtn" type="button"
              aria-label="About this app" aria-haspopup="dialog" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="11.5"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      </button>
      <!-- Filled from APP_INFO (▸ EDIT 2) so an app author writes prose, not markup. -->
      <div id="infoPopover" class="popover" role="dialog" aria-label="About this app" hidden>
        <div class="heading" id="infoHeading">About</div>
        <div class="para" id="infoSummary"></div>
        <dl>
          <dt>Input</dt>   <dd id="infoInput"></dd>
          <dt>Returns</dt> <dd id="infoReturns"></dd>
          <dt>Runtime</dt> <dd id="infoRuntime"></dd>
        </dl>
      </div>
    </div>

    <button id="loginBtn" class="topbar-btn" type="button" aria-label="Sign in to Hypha" hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
        <polyline points="10 17 15 12 10 7"/>
        <line x1="15" y1="12" x2="3" y2="12"/>
      </svg>
      <span>Sign in</span>
    </button>

    <div id="userWrap" hidden>
      <button id="userBtn" class="topbar-iconbtn" type="button"
              aria-label="Account menu" aria-haspopup="menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3.4"/>
          <path d="M5.5 19a7 7 0 0 1 13 0"/>
        </svg>
      </button>
      <div id="userMenu" class="popover" role="menu" hidden>
        <div class="info-row">
          <div><strong id="userEmail">…</strong></div>
          <div>workspace <strong id="userWs">…</strong></div>
        </div>
        <button class="item" id="logoutBtn" type="button" role="menuitem">Sign out</button>
      </div>
    </div>
  </div>
</div>

<div class="container">

  <!-- Placed ABOVE the header so it is the first thing read, not a footnote
       under a UI the visitor has already started trying to use. -->
  <noscript>
    <div class="nojs">
      <strong>This app needs JavaScript.</strong>
      Everything below is rendered but inert: the image never uploads, the
      status line stays on “Connecting…”, and no sign-in control appears. The
      analysis runs on a remote worker reached over a WebSocket from this page,
      so there is no no-JS fallback to offer. Enable JavaScript for this site,
      or run the same model from the command line with
      <code>bioengine</code>.
    </div>
  </noscript>

  <!-- ▸ EDIT 1 — headline prose -->
  <header class="page">
    <h1><span class="accent">Nuclei</span> Segmentation</h1>
    <p>
      Classical CPU segmentation of <strong>2D fluorescence images</strong> —
      normalise, Gaussian smooth, threshold, distance-watershed, label. Drop an
      image below and every object centroid comes back as a table you can read.
    </p>
  </header>

  <div class="grid">

    <!-- ============ LEFT: input + parameters ============ -->
    <div class="col">

      <div class="card">
        <h2>Input image</h2>

        <!-- Drop zone doubles as the file-picker trigger. `role=button` +
             tabindex make it keyboard-activatable; the real <input> stays
             hidden but is what actually opens the picker. -->
        <div id="drop" class="dropzone" role="button" tabindex="0"
             aria-label="Choose an image file, or drop one here">
          <svg class="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 9 12 4 17 9"/>
            <line x1="12" y1="4" x2="12" y2="16"/>
          </svg>
          <div class="dz-title">Drop an image, or click to choose</div>
          <div class="dz-hint">PNG, TIFF, JPEG — single 2D plane</div>
        </div>
        <input id="fileInput" type="file" accept="image/*,.tif,.tiff" class="sr-only" tabindex="-1" />

        <div id="preview" class="preview" hidden>
          <button id="inputThumbBtn" class="thumb-btn" type="button"
                  aria-label="Inspect the input image full size">
            <img id="inputThumb" alt="Uploaded input image" />
            <span class="zoom-cue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>
                <line x1="11" y1="8.5" x2="11" y2="13.5"/><line x1="8.5" y1="11" x2="13.5" y2="11"/>
              </svg>
              Inspect
            </span>
          </button>
          <div class="meta-row" id="fileMeta">
            <span class="name" id="fileName">—</span>
            <span class="chip" id="fileDims">—</span>
            <span class="chip" id="fileSize">—</span>
            <span class="spacer"></span>
            <button id="clearBtn" class="btn" type="button" style="padding:0.25rem 0.6rem;font-size:0.76rem">Clear</button>
          </div>
        </div>
      </div>

      <!-- ▸ EDIT 6 — replace these with your method's parameters -->
      <div class="card">
        <h2>Parameters</h2>
        <div class="field-row">
          <div class="field">
            <label for="thresholdSel">Threshold</label>
            <select id="thresholdSel">
              <option value="otsu" selected>Otsu</option>
              <option value="li">Li</option>
            </select>
          </div>
          <div class="field">
            <label for="sigmaInput">Gaussian σ (px)</label>
            <input id="sigmaInput" type="number" min="0" max="10" step="0.5" value="1" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="minSizeInput">Min object size (px)</label>
            <input id="minSizeInput" type="number" min="0" max="10000" step="5" value="30" />
          </div>
          <div class="field">
            <label for="minDistInput">Min seed distance (px)</label>
            <input id="minDistInput" type="number" min="1" max="200" step="1" value="5" />
          </div>
        </div>

        <!-- The button carries its own phase: an inline spinner replaces the
             play icon and the label names what is happening. It never just
             greys out. (hypha-rpc calls are not cancellable, so there is no
             cancel affordance here — add one if your backend supports it.) -->
        <button id="runBtn" class="btn btn-primary btn-block" type="button" disabled>
          <!-- The icon is wrapped in a <span> on purpose. `hidden` is an
               HTMLElement property; SVGElement does not reflect it, so
               `svgEl.hidden = true` silently sets a JS expando and the icon
               keeps rendering. Toggle a wrapper, not the <svg>. -->
          <span id="runIcon" class="btn-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>
            </svg>
          </span>
          <span id="runSpinner" class="spinner" aria-hidden="true" hidden></span>
          <span class="label" id="runLabel">Run segmentation</span>
        </button>

        <div class="status-row">
          <span id="statusSpinner" class="spinner" aria-hidden="true" hidden></span>
          <span id="statusDot" class="status-dot" aria-hidden="true"></span>
          <!-- role=status announces phase changes; the elapsed counter is
               aria-hidden so it does not re-announce every second. -->
          <span id="status" role="status">Connecting…</span>
          <!-- Appears only when a failure was deferred rather than shown as a
               modal (page load, background work). Carries the real error so
               nothing is dropped; the user opens it when they choose to. -->
          <button id="statusBtn" class="status-btn" type="button" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="11.5"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>Details</span>
          </button>
          <span id="elapsed" aria-hidden="true"></span>
        </div>
        <div id="progress" class="progress" role="progressbar"
             aria-valuemin="0" aria-valuemax="100" aria-label="Progress" hidden>
          <span class="bar"></span>
        </div>
        <div id="busyHint" class="busy-hint" hidden></div>
      </div>
    </div>

    <!-- ============ RIGHT: result ============ -->
    <div class="col">
      <div class="card">
        <h2>Result <span id="resultBadge" class="badge" hidden></span></h2>

        <div id="resultEmpty" class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2.5"/>
            <circle cx="8.8" cy="9" r="1.8"/>
            <path d="m21 15.5-4.6-4.6L5.5 21"/>
          </svg>
          <span>Nothing yet — load an image and press Run.</span>
        </div>

        <!-- Placeholder shaped like the real result, so the first run does not
             make the layout jump when data lands. -->
        <div id="resultSkeleton" aria-hidden="true" hidden>
          <div class="stats">
            <div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div>
          </div>
          <div class="sk sk-img"></div>
          <div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div>
          <div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div>
        </div>

        <div id="resultBody" hidden>
          <!-- ▸ EDIT 5 — stats -->
          <div class="stats" id="statsRow"></div>

          <div id="overlayWrap" hidden>
            <button id="overlayThumbBtn" class="thumb-btn" type="button"
                    aria-label="Inspect the result overlay full size">
              <img id="overlayImg" alt="Segmentation overlay produced by the backend" />
              <span class="zoom-cue">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>
                  <line x1="11" y1="8.5" x2="11" y2="13.5"/><line x1="8.5" y1="11" x2="13.5" y2="11"/>
                </svg>
                Inspect
              </span>
            </button>
            <div class="meta-row">
              <span class="name">Overlay</span>
              <span class="chip" id="overlayDims">—</span>
              <span class="chip" id="overlaySize">—</span>
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">#</th><th scope="col">label</th>
                  <th scope="col">y</th><th scope="col">x</th><th scope="col">area</th>
                </tr>
              </thead>
              <tbody id="objBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Before / after — only appears when both images exist. -->
      <div class="card" id="compareCard" hidden>
        <h2>Before / after</h2>
        <div class="compare" id="compare">
          <img id="compareResult" alt="Result overlay" />
          <div class="clip"><img id="compareInput" alt="Input image" /></div>
          <span class="tag tag-before">Input</span>
          <span class="tag tag-after">Result</span>
          <div class="handle" aria-hidden="true"></div>
          <input id="compareRange" type="range" min="0" max="100" value="50" step="0.5"
                 aria-label="Reveal the result over the input" />
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ======================= INSPECT MODAL =================================== -->
<div id="inspect" class="modal-backdrop" role="dialog" aria-modal="true"
     aria-labelledby="inspectTitle" hidden>
  <div class="modal">
    <div class="modal-head">
      <span class="title" id="inspectTitle">Image</span>
      <span class="sub" id="inspectSub">—</span>
      <span class="spacer"></span>
      <button class="vbtn" id="inspectClose" type="button" aria-label="Close (Esc)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="viewer" id="viewer">
      <img id="viewerImg" alt="" draggable="false" />
    </div>

    <div class="viewer-bar">
      <button class="vbtn" id="zoomOut" type="button" aria-label="Zoom out">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <span id="zoomLevel" role="status" aria-label="Zoom level">100%</span>
      <button class="vbtn" id="zoomIn" type="button" aria-label="Zoom in">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/></svg>
      </button>
      <button class="vbtn" id="zoomFit" type="button">Fit</button>
      <button class="vbtn" id="zoomOne" type="button">1:1</button>
      <span class="spacer"></span>
      <span class="hint">Scroll to zoom · drag to pan · Esc to close</span>
    </div>
  </div>
</div>

<!-- ======================= ERROR DIALOG ==================================== -->
<!-- z-index above the inspect overlay: an error raised while the image viewer
     is open must render in front of it, never behind. -->
<div id="errorDialog" class="modal-backdrop" role="alertdialog" aria-modal="true"
     aria-labelledby="errorTitle" hidden>
  <div class="dialog">
    <div class="dialog-title">
      <span class="dialog-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.5"/>
        </svg>
      </span>
      <span class="dialog-heads">
        <span id="errorTitle">Something went wrong</span>
        <!-- One line of context: service id, artifact id, filename. -->
        <span id="errorSubtitle" class="dialog-subtitle" hidden></span>
      </span>
    </div>
    <div class="dialog-message" id="errorMessage"></div>
    <div class="dialog-detail-wrap" id="errorDetailWrap">
      <pre class="dialog-detail" id="errorDetail"></pre>
      <span class="more-hint" aria-hidden="true">
        scroll for more
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"
             stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
    </div>
    <div class="dialog-actions">
      <button class="btn" type="button" id="errorCopy">Copy</button>
      <button class="btn btn-primary" type="button" id="errorClose">Close</button>
    </div>
  </div>
</div>

<script type="module">
import { login, connectToServer }
  from "https://cdn.jsdelivr.net/npm/hypha-rpc@0.20.54/dist/hypha-rpc-websocket.mjs";

/* ============================================================================
   ▸ EDIT 2 — the info popover's prose. Mechanics below never change.
   ========================================================================== */
const APP_INFO = {
  heading: "About this app",
  summary: "Segments nuclei in a single 2D fluorescence plane using a classical "
         + "pipeline — percentile normalise, Gaussian smoothing, a global threshold, "
         + "a distance-transform watershed split, then connected-component labelling. "
         + "<strong>No model weights, no GPU</strong>, so it runs anywhere and is "
         + "reproducible run to run.",
  input:   "One 2D image file (PNG / TIFF / JPEG). Multi-channel images are "
         + "converted to grayscale; z-stacks and time series are not supported.",
  returns: "An object count, a per-object table of centroid <code>y</code>/<code>x</code> "
         + "and area in pixels, and a PNG overlay with the object outlines drawn on "
         + "the input.",
  runtime: "1 CPU, 4 GB, no accelerator.",
};

/* ============================================================================
   URL params — all injected by BioEngine when the page is served from the
   artifact's static_site_url.
     ?server=<hypha-server>            base URL; defaults to this page's origin
     ?ws_service_id=<full-service-id>  already fully resolved — use as-is
     ?webrtc_service_id=<full-id>      injected too; this template ignores it
     ?token=<hypha-token>              TESTING-ONLY auto-connect bypass. It is
                                       what makes agent-driven browser testing
                                       possible; tokens land in browser history,
                                       so never paste a production token.
   ========================================================================== */
const params = new URLSearchParams(window.location.search);
const PAGE_ORIGIN =
  (window.location.protocol === "http:" || window.location.protocol === "https:")
    ? window.location.origin : null;
const SERVER_URL = params.get("server") || PAGE_ORIGIN || "https://hypha.aicell.io";
const SERVICE_ID = params.get("ws_service_id") || "";
const URL_TOKEN  = params.get("token") || "";

/* ▸ EDIT 3 — unique per app, so apps share a Hypha session but not storage. */
const THEME_KEY    = "bioengine-app:theme";     // keep in sync with the <head> boot script
const TOKEN_KEY    = "bioengine-app:token";
const TOKEN_EXPIRY = "bioengine-app:tokenExpiry";
const TOKEN_TTL_MS = 3 * 60 * 60 * 1000;

const $ = id => document.getElementById(id);
const escapeHTML = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let server = null, svc = null, userWorkspace = null, userEmail = null;
// Declared up here (not in the error section) so setStatus can always clear it,
// whatever order an app author moves the blocks below into.
let deferredError = null;

/* ==========================================================================
   THEME
   ========================================================================== */
const prefersReduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let themeTimer = null;
function applyTheme(theme, { animate = true } = {}) {
  const root = document.documentElement;
  if (animate && !prefersReduced()) {
    root.classList.add("theme-switching");
    clearTimeout(themeTimer);
    // Removed as soon as the colour transition is done, so this class can
    // never interfere with the interaction transitions.
    themeTimer = setTimeout(() => root.classList.remove("theme-switching"), 200);
  }
  root.setAttribute("data-theme", theme);
  $("themeBtn").setAttribute(
    "aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  $("themeBtn").setAttribute("title", $("themeBtn").getAttribute("aria-label"));
}
applyTheme(document.documentElement.getAttribute("data-theme") || "dark", { animate: false });

$("themeBtn").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  // Ignorable: localStorage is blocked in private mode / with third-party
  // cookies off. The theme still applies for this page; only persistence is
  // lost, and nothing external failed.
  try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
});

// Follow the OS only while the user has never chosen explicitly.
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
  let stored = null;
  // Ignorable: same as above. `stored` stays null and we follow the OS.
  try { stored = localStorage.getItem(THEME_KEY); } catch (_) {}
  if (stored === "light" || stored === "dark") return;
  applyTheme(e.matches ? "light" : "dark");
});

/* ==========================================================================
   INFO POPOVER  (populated from APP_INFO — no markup editing needed)
   ========================================================================== */
$("infoHeading").textContent  = APP_INFO.heading;
$("infoSummary").innerHTML    = APP_INFO.summary;
$("infoInput").innerHTML      = APP_INFO.input;
$("infoReturns").innerHTML    = APP_INFO.returns;
$("infoRuntime").innerHTML    = APP_INFO.runtime;

const POPOVERS = [["userMenu", "userBtn"], ["infoPopover", "infoBtn"]];
function togglePopover(popId, trigId) {
  const open = $(popId).hidden;
  for (const [p, t] of POPOVERS) {           // only one open at a time
    $(p).hidden = true;
    $(t).setAttribute("aria-expanded", "false");
  }
  $(popId).hidden = !open;
  $(trigId).setAttribute("aria-expanded", String(open));
}
$("infoBtn").addEventListener("click", () => togglePopover("infoPopover", "infoBtn"));
$("userBtn").addEventListener("click", () => togglePopover("userMenu", "userBtn"));

document.addEventListener("mousedown", (e) => {
  for (const [popId, trigId] of POPOVERS) {
    const pop = $(popId), trig = $(trigId);
    if (!pop.hidden && !pop.contains(e.target) && !trig.contains(e.target)) {
      pop.hidden = true;
      trig.setAttribute("aria-expanded", "false");
    }
  }
});

/* Escape closes the topmost layer: error dialog → inspect → popovers. */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("errorDialog").hidden) { closeError(); return; }
  if (!$("inspect").hidden)     { closeInspect(); return; }
  for (const [popId, trigId] of POPOVERS) {
    if (!$(popId).hidden) {
      $(popId).hidden = true;
      $(trigId).setAttribute("aria-expanded", "false");
      $(trigId).focus();
    }
  }
});

/* ==========================================================================
   NOTICE — non-blocking, for things that must not interrupt (rejected files)
   ========================================================================== */
let noticeTimer = null, noticeEl = null;
function notify(message, kind = "warn", ms = 4200) {
  clearTimeout(noticeTimer);
  if (noticeEl) noticeEl.remove();
  noticeEl = document.createElement("div");
  noticeEl.id = "notice";
  noticeEl.className = kind;
  noticeEl.setAttribute("role", "status");
  noticeEl.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'
    + '<line x1="12" y1="9" x2="12" y2="13.5"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    + "<span>" + escapeHTML(message) + "</span>";
  document.body.appendChild(noticeEl);
  const el = noticeEl;
  noticeTimer = setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => { if (el === noticeEl) { el.remove(); noticeEl = null; } }, 220);
  }, ms);
}

/* ==========================================================================
   BUSY FEEDBACK
   One controller for every wait in the app: page-load connect, file read,
   encode, inference. Three rules hold it together:
     1. Motion is ALWAYS paired with a phase label that changes, so a long
        wait reads as progress rather than a hang.
     2. Determinate only where a real fraction exists (bytes read, chunks
        encoded). The worker cannot report inference progress, so inference is
        indeterminate — a fabricated percentage is worse than an honest sweep.
     3. Every wait ends through endBusy(), and every caller puts it in a
        `finally`. That is what stops a failed call leaving a spinner running.
   ========================================================================== */
const RUN_LABEL = $("runLabel").textContent;
const busy = { active: false, button: false, t0: 0, tick: null, hint: null, reveal: null };

function showBusyChrome(on) {
  $("statusSpinner").hidden = !on;
  $("statusDot").hidden = on;
  $("progress").hidden = !on;
  if (busy.button) { $("runSpinner").hidden = !on; $("runIcon").hidden = on; }
}

function beginBusy(label, { hint = null, hintAfterMs = 10000, button = false,
                            delayMs = 90 } = {}) {
  endBusy();                       // never stack two busy states
  busy.active = true;
  busy.button = button;
  busy.t0 = Date.now();
  setStatus("busy", label);
  setProgress(null);               // start indeterminate until told otherwise

  // Sub-100ms work should not flash a spinner at the user. Nothing is revealed
  // until the wait proves it is long enough to be worth showing.
  busy.reveal = setTimeout(() => showBusyChrome(true), delayMs);

  busy.tick = setInterval(() => {
    const s = Math.round((Date.now() - busy.t0) / 1000);
    $("elapsed").textContent = s >= 3 ? s + "s" : "";
  }, 500);

  if (hint) busy.hint = setTimeout(() => {
    // Silence past ten seconds reads as a crash.
    $("busyHint").textContent = hint;
    $("busyHint").hidden = false;
  }, hintAfterMs);
}

/* frac === undefined -> indeterminate. Pass a number ONLY when it is real. */
function busyPhase(label, frac) {
  if (!busy.active) return;
  setStatus("busy", label);
  if (busy.button) $("runLabel").textContent = label + "…";
  setProgress(frac);
}

function setProgress(frac) {
  const p = $("progress");
  if (frac === undefined || frac === null || Number.isNaN(frac)) {
    p.classList.add("indeterminate");
    p.removeAttribute("aria-valuenow");     // correct ARIA for indeterminate
    return;
  }
  const v = Math.max(0, Math.min(1, frac));
  p.classList.remove("indeterminate");
  p.style.setProperty("--p", v);
  p.setAttribute("aria-valuenow", Math.round(v * 100));
}

/* Resets EVERY busy affordance. Safe to call when nothing is running. */
function endBusy({ kind = null, status = null } = {}) {
  clearTimeout(busy.reveal); clearInterval(busy.tick); clearTimeout(busy.hint);
  busy.reveal = busy.tick = busy.hint = null;
  busy.active = false;
  $("statusSpinner").hidden = true;
  $("statusDot").hidden = false;
  $("runSpinner").hidden = true;
  $("runIcon").hidden = false;
  $("runLabel").textContent = RUN_LABEL;
  busy.button = false;
  $("elapsed").textContent = "";
  $("busyHint").hidden = true;
  $("busyHint").textContent = "";
  const p = $("progress");
  p.hidden = true;
  p.classList.remove("indeterminate");
  p.style.setProperty("--p", 0);
  p.removeAttribute("aria-valuenow");
  $("resultSkeleton").hidden = true;
  $("resultBody").classList.remove("rerunning");
  if (status !== null) setStatus(kind, status);
  refreshRunEnabled();
}

/* ==========================================================================
   ERROR DIALOG
   THE RULE: never silently drop a failure that came from outside this page,
   whether it came from hypha RPC, the network, or file/image IO. Every one of
   them must be reachable by the user, with the full text, copyable.
   The ONE exception is timing, not visibility: do not ambush a page load with
   a modal. Boot-time and background failures set a CLICKABLE status line
   instead (see deferError below), which opens this same dialog on demand.
   ========================================================================== */

/* Ray colourises worker tracebacks with ANSI escapes. Rendered into a <pre>
   they appear as literal "?[36m" garbage wrapped around the exception name,
   which is the first thing the user reads. Strip them here, at the single
   choke point every caller already goes through, so no call site can forget.

   The pattern anchors on the ESC byte, which never occurs in ordinary
   traceback text, so it cannot eat real content. The stripped form is also
   what Copy puts on the clipboard: escapes pasted into an issue or a message
   to a maintainer are noise, not colour. */
const ANSI_ESCAPE = /\x1B\[[0-9;?]*[ -\/]*[@-~]/g;
function stripAnsi(s) {
  return typeof s === "string" ? s.replace(ANSI_ESCAPE, "") : s;
}

function formatErr(err) {
  if (!err) return "";
  if (typeof err === "string") return stripAnsi(err);
  return stripAnsi(err.stack || err.message || (() => {
    // A non-Error object with circular refs. Falling back to String() still
    // gives the user something to copy, which is the whole point.
    try { return JSON.stringify(err, null, 2); } catch { return String(err); }
  })());
}

let errorReturnFocus = null;
function showError({ title = "Something went wrong", subtitle = "", message = "",
                     detail = "" } = {}) {
  // Remember where focus was so it can go back on close.
  errorReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement : null;
  $("errorTitle").textContent = title;
  $("errorSubtitle").textContent = subtitle;
  $("errorSubtitle").hidden = !subtitle;
  $("errorMessage").innerHTML = message;    // HTML so callers can <strong> a name
  // textContent: never inject server output as HTML. The fallback keeps an
  // error with no text looking like a handled error, not a broken dialog.
  $("errorDetail").textContent = detail || "(no error message returned)";
  $("errorDialog").hidden = false;
  setTimeout(() => { $("errorClose").focus(); updateDetailOverflow(); }, 0);
}
/* Show the "more below" fade only while there is actually more below. */
function updateDetailOverflow() {
  const d = $("errorDetail");
  const more = d.scrollHeight - d.scrollTop - d.clientHeight > 2;
  $("errorDetailWrap").classList.toggle("more", more);
}
$("errorDetail").addEventListener("scroll", updateDetailOverflow);
function closeError() {
  $("errorDialog").hidden = true;
  if (errorReturnFocus && document.contains(errorReturnFocus)) errorReturnFocus.focus();
  errorReturnFocus = null;
}
$("errorClose").addEventListener("click", closeError);
$("errorDialog").addEventListener("click", e => { if (e.target === $("errorDialog")) closeError(); });
$("errorCopy").addEventListener("click", async () => {
  const text = [$("errorTitle").textContent, $("errorSubtitle").textContent,
                $("errorMessage").textContent, $("errorDetail").textContent]
    .filter(Boolean).join("\n\n");
  try {
    await navigator.clipboard?.writeText(text);
    $("errorCopy").textContent = "Copied";
    setTimeout(() => { $("errorCopy").textContent = "Copy"; }, 1200);
  } catch (_) {
    // Clipboard needs permission / a secure context. Nothing is lost: the
    // text is on screen and selectable. Not worth a second error dialog.
  }
});

/* ---- Deferred errors ----------------------------------------------------
   For failures that must NOT interrupt (page-load auto-connect, background
   refreshes). The status line becomes a button carrying the real error, so
   nothing is dropped and nothing ambushes the user. */
function deferError({ status, title, subtitle = "", message = "", detail = "" }) {
  setStatus("err", status);              // clears any previously deferred error
  deferredError = { title, subtitle, message, detail };
  $("statusBtn").hidden = false;
  $("statusBtn").setAttribute("aria-label", `${status} — show the full error`);
}
function clearDeferredError() {
  deferredError = null;
  $("statusBtn").hidden = true;
}
$("statusBtn").addEventListener("click", () => {
  if (deferredError) showError(deferredError);
});

/* ==========================================================================
   IMAGE INPUT — file picker AND drag-and-drop on the same zone
   ========================================================================== */
const state = {
  file: null, bytes: null, inputURL: null,
  inputDims: null,                 // [w, h]
  overlayURL: null, overlayDims: null, overlaySize: 0,
};

const fmtBytes = n => {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
};

const drop = $("drop"), fileInput = $("fileInput");

drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) acceptFile(fileInput.files[0]);
});

/* `dragleave` fires every time the pointer crosses into a CHILD element, so a
   naive handler removes the state the instant you move over the icon. A depth
   counter is the reliable fix — increment on enter, decrement on leave, and
   only drop the state at zero. */
let dragDepth = 0;
const setDragging = on => drop.classList.toggle("dragging", on);

drop.addEventListener("dragenter", (e) => {
  e.preventDefault(); e.stopPropagation();
  dragDepth++; setDragging(true);
});
drop.addEventListener("dragover", (e) => {
  // Without preventDefault on dragover the browser refuses the drop entirely.
  e.preventDefault(); e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  setDragging(true);
});
drop.addEventListener("dragleave", (e) => {
  e.preventDefault(); e.stopPropagation();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragging(false);
});
drop.addEventListener("drop", (e) => {
  e.preventDefault(); e.stopPropagation();
  dragDepth = 0; setDragging(false);
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) { notify("No file found in that drop."); return; }
  acceptFile(files[0]);
});

/* A file dropped outside the zone would otherwise navigate the page away. */
["dragover", "drop"].forEach(type =>
  window.addEventListener(type, (e) => {
    if (!drop.contains(e.target)) { e.preventDefault(); if (type === "drop") dragDepth = 0, setDragging(false); }
  }));

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i;
function looksLikeImage(file) {
  return (file.type && file.type.startsWith("image/")) || IMAGE_EXT.test(file.name || "");
}

/* Read in slices rather than one file.arrayBuffer() call. Two reasons:
   the fraction reported is literally the bytes read so the bar is honest, and
   awaiting each slice yields to the event loop, so the spinner that is
   supposed to show the work actually animates while it happens.
   (FileReader's `progress` event is not a substitute — for a local file Chrome
   often fires it once at the end, which is a fraction you cannot draw.) */
async function readFileWithProgress(file, onProgress) {
  const SLICE = 1 << 20;                        // 1 MB
  const out = new Uint8Array(file.size);
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + SLICE, file.size);
    out.set(new Uint8Array(await file.slice(offset, end).arrayBuffer()), offset);
    offset = end;
    onProgress(offset / file.size);
  }
  onProgress(1);
  return out;
}

async function acceptFile(file) {
  if (!looksLikeImage(file)) {
    // Visible, non-blocking, and the zone keeps whatever it already had.
    notify(`“${file.name}” is not an image — expected PNG, TIFF or JPEG.`);
    return;
  }
  clearInput({ keepResult: true });
  state.file = file;

  const reading = `Reading ${fmtBytes(file.size)}`;
  beginBusy(reading);
  try {
    state.bytes = await readFileWithProgress(file, f => busyPhase(reading, f));
  } catch (err) {
    endBusy({ kind: "err", status: "Could not read that file." });
    showError({ title: "Could not read that file",
                subtitle: `${file.name} · ${fmtBytes(file.size)}`,
                message: `<strong>${escapeHTML(file.name)}</strong> could not be read.`,
                detail: formatErr(err) });
    state.file = null;
    return;
  }
  endBusy({ kind: svc ? "ok" : "",
            status: svc ? "Ready — press Run." : "Sign in (top right) to run this app." });

  $("fileName").textContent = file.name;
  $("fileSize").textContent = fmtBytes(file.size);
  $("fileDims").textContent = "…";

  const url = URL.createObjectURL(file);
  state.inputURL = url;
  $("inputThumb").src = url;
  $("compareInput").src = url;
  $("preview").hidden = false;

  // Natural dimensions: scientists need to know what they are looking at.
  // TIFFs that the browser cannot decode still upload fine — only the
  // preview and the dimension readout degrade.
  const probe = new Image();
  probe.onload = () => {
    state.inputDims = [probe.naturalWidth, probe.naturalHeight];
    $("fileDims").textContent = `${probe.naturalWidth} × ${probe.naturalHeight}`;
    $("inputThumbBtn").hidden = false;
  };
  probe.onerror = () => {
    // Reported inline, not as a modal, and deliberately so: browsers cannot
    // decode plenty of perfectly valid microscopy files (16-bit / multi-page
    // TIFF), the bytes still upload and segment fine, and the `error` event
    // carries no error object to show. So this is visible, not silent — the
    // chip says "preview unavailable" and the dead thumbnail is removed rather
    // than left as a broken-image glyph over an empty viewer.
    $("fileDims").textContent = "preview unavailable";
    $("inputThumbBtn").hidden = true;
  };
  probe.src = url;

  refreshRunEnabled();
}

function clearInput({ keepResult = false } = {}) {
  if (state.inputURL) URL.revokeObjectURL(state.inputURL);
  state.file = null; state.bytes = null; state.inputURL = null; state.inputDims = null;
  $("preview").hidden = true;
  $("inputThumb").removeAttribute("src");
  fileInput.value = "";
  if (!keepResult) clearResult();
  updateCompareVisibility();
  refreshRunEnabled();
}
$("clearBtn").addEventListener("click", (e) => { e.stopPropagation(); clearInput(); });

/* ==========================================================================
   INSPECT VIEWER — zoom (wheel + buttons), pan, fit, 1:1
   One viewer serves every image the UI touches: the uploaded input AND
   anything the backend sends back.
   ========================================================================== */
const viewer = $("viewer"), viewerImg = $("viewerImg");
const view = { scale: 1, tx: 0, ty: 0, w: 0, h: 0 };
let inspectTrigger = null;

function applyView() {
  viewerImg.style.transform =
    `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  $("zoomLevel").textContent = Math.round(view.scale * 100) + "%";
  // Below ~1.25× the browser is downsampling and smoothing helps; above it,
  // smoothing destroys exactly the detail you zoomed in for.
  viewer.classList.toggle("pixelated", view.scale >= 1.25);
}
// clientWidth/Height, NOT getBoundingClientRect(): the rect is the *transformed*
// box, so while the modal is still scaling in from 0.96 it reports 96% of the
// real size and "Fit" lands on the wrong zoom.
function viewportSize() {
  return [viewer.clientWidth, viewer.clientHeight];
}
function fitView() {
  const [vw, vh] = viewportSize();
  if (!view.w || !view.h || !vw || !vh) return;
  view.scale = Math.min(vw / view.w, vh / view.h);
  view.tx = (vw - view.w * view.scale) / 2;
  view.ty = (vh - view.h * view.scale) / 2;
  applyView();
}
function zoomTo(nextScale, cx, cy) {
  const [vw, vh] = viewportSize();
  if (cx === undefined) { cx = vw / 2; cy = vh / 2; }
  const s = Math.min(40, Math.max(0.02, nextScale));
  // Keep the point under the cursor pinned while the scale changes.
  view.tx = cx - (cx - view.tx) * (s / view.scale);
  view.ty = cy - (cy - view.ty) * (s / view.scale);
  view.scale = s;
  applyView();
}
function oneToOne() {
  const [vw, vh] = viewportSize();
  zoomTo(1, vw / 2, vh / 2);
  view.tx = (vw - view.w) / 2;
  view.ty = (vh - view.h) / 2;
  applyView();
}

function openInspect({ src, title, sub, trigger }) {
  inspectTrigger = trigger || null;
  $("inspectTitle").textContent = title || "Image";
  $("inspectSub").textContent = sub || "";
  $("inspect").hidden = false;
  viewerImg.src = src;
  const start = () => {
    view.w = viewerImg.naturalWidth || viewerImg.width;
    view.h = viewerImg.naturalHeight || viewerImg.height;
    viewerImg.style.width = view.w + "px";
    viewerImg.style.height = view.h + "px";
    fitView();
  };
  if (viewerImg.complete && viewerImg.naturalWidth) start();
  else viewerImg.onload = start;
  // An image the app produced failing to decode is an external failure and a
  // real one — the viewer would otherwise sit blank with no explanation.
  viewerImg.onerror = () => {
    closeInspect();
    showError({
      title: "Could not display that image",
      subtitle: title || "",
      message: "The image data could not be decoded by the browser.",
      detail: "Source: " + String(src).slice(0, 300),
    });
  };
  setTimeout(() => $("inspectClose").focus(), 0);
}
function closeInspect() {
  $("inspect").hidden = true;
  // Detach the handlers BEFORE clearing src: dropping the src can itself fire
  // `error`, which would pop the decode dialog every time the viewer closes.
  viewerImg.onload = viewerImg.onerror = null;
  viewerImg.removeAttribute("src");
  viewerImg.style.width = viewerImg.style.height = "";   // no stale size next open
  // Focus goes back where it came from — never stranded on <body>.
  if (inspectTrigger) { inspectTrigger.focus(); inspectTrigger = null; }
}
$("inspectClose").addEventListener("click", closeInspect);
$("inspect").addEventListener("click", e => { if (e.target === $("inspect")) closeInspect(); });

viewer.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = viewer.getBoundingClientRect();
  const factor = Math.exp(-e.deltaY * 0.0016);
  zoomTo(view.scale * factor, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

let panning = false, panId = null, lastX = 0, lastY = 0;
viewer.addEventListener("pointerdown", (e) => {
  if (panning) return;                       // ignore extra touch points mid-drag
  panning = true; panId = e.pointerId;
  lastX = e.clientX; lastY = e.clientY;
  viewer.classList.add("panning");
  viewer.setPointerCapture(e.pointerId);     // keep panning outside the bounds
});
viewer.addEventListener("pointermove", (e) => {
  if (!panning || e.pointerId !== panId) return;
  view.tx += e.clientX - lastX;
  view.ty += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  applyView();
});
const endPan = (e) => {
  if (!panning || (e && e.pointerId !== panId)) return;
  panning = false; panId = null;
  viewer.classList.remove("panning");
};
viewer.addEventListener("pointerup", endPan);
viewer.addEventListener("pointercancel", endPan);

$("zoomIn").addEventListener("click", () => zoomTo(view.scale * 1.5));
$("zoomOut").addEventListener("click", () => zoomTo(view.scale / 1.5));
$("zoomFit").addEventListener("click", fitView);
$("zoomOne").addEventListener("click", oneToOne);

$("inputThumbBtn").addEventListener("click", () => openInspect({
  src: state.inputURL,
  title: state.file ? state.file.name : "Input image",
  sub: [state.inputDims ? `${state.inputDims[0]} × ${state.inputDims[1]} px` : null,
        state.file ? fmtBytes(state.file.size) : null].filter(Boolean).join("  ·  "),
  trigger: $("inputThumbBtn"),
}));
$("overlayThumbBtn").addEventListener("click", () => openInspect({
  src: state.overlayURL,
  title: "Result overlay",
  sub: [state.overlayDims ? `${state.overlayDims[0]} × ${state.overlayDims[1]} px` : null,
        state.overlaySize ? fmtBytes(state.overlaySize) : null].filter(Boolean).join("  ·  "),
  trigger: $("overlayThumbBtn"),
}));

/* ==========================================================================
   BEFORE / AFTER SLIDER — one clip-path, no extra DOM
   ========================================================================== */
const compareRange = $("compareRange");
compareRange.addEventListener("input", () => {
  $("compare").style.setProperty("--split", compareRange.value + "%");
});
function updateCompareVisibility() {
  const both = !!(state.inputURL && state.overlayURL);
  $("compareCard").hidden = !both;
  if (both) {
    compareRange.value = 50;
    $("compare").style.setProperty("--split", "50%");
  }
}

/* ==========================================================================
   AUTH — token cache, login, boot. Unchanged behaviour, restyled onto tokens.
   ========================================================================== */
/* The three localStorage catches below are all genuinely ignorable: storage
   throws in private mode and with third-party cookies blocked, and every one
   degrades to "no cached session", which is a state the app already handles
   by showing the Login button. Nothing external failed, so there is nothing
   to surface. */
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

function setStatus(kind, msg) {
  $("statusDot").className = "status-dot " + (kind || "");
  $("status").className = kind === "err" ? "err" : (kind === "ok" ? "ok" : "");
  $("status").textContent = msg;
  // Any new status supersedes a deferred error, so the Details button can
  // never outlive the message it belongs to. deferError() re-arms it after.
  clearDeferredError();
}
function setLoggedOutUI() {
  endBusy();                    // belt and braces: never leave a spinner behind
  $("loginBtn").hidden = false; $("loginBtn").disabled = false;
  $("userWrap").hidden = true;  $("userMenu").hidden = true;
  setStatus("", "Sign in (top right) to run this app.");
  refreshRunEnabled();
}
function setLoggingInUI() { $("loginBtn").disabled = true; }
function setLoggedInUI() {
  $("loginBtn").hidden = true;
  $("userWrap").hidden = false;
  $("userEmail").textContent = userEmail || "(unknown)";
  $("userWs").textContent = userWorkspace || "—";
}
function refreshRunEnabled() {
  $("runBtn").disabled = !(svc && state.bytes) || busy.active;
}

/* Covers ONE of the two ways a connection ends: a clean close (codes 1000/1001,
   e.g. the worker restarting or the token expiring), which is the only case
   hypha-rpc reports to the page. An unexpected drop is retried silently and
   effectively forever, console-only, with no callback — so there is deliberately
   nothing here for that case. See § Losing the connection while the page sits
   idle for why a heartbeat is usually the wrong answer.

   `_connection` is a private field, not public API. Every hop is optional-chained
   so a hypha-rpc release that moves it costs us the disconnect notice and
   nothing else. */
function watchForDisconnect() {
  server?.rpc?._connection?.on_disconnected?.((reason) => {
    svc = null;                      // stale handle; refreshRunEnabled() disables Run
    refreshRunEnabled();
    setStatus("err", "Disconnected from the worker. Reload the page to reconnect.");
  });
}

async function connectWithToken(token) {
  setLoggingInUI();
  // Page-load connect is the wait the old template sat silent through.
  beginBusy("Connecting to Hypha", {
    delayMs: 0,                  // this one is always slow; show it immediately
    hint: "Still connecting — the worker may be waking up.",
  });
  try {
    server = await connectToServer({ server_url: SERVER_URL, token });
    watchForDisconnect();
    userWorkspace = server.config.workspace;
    userEmail = (server.config.user && server.config.user.email) || userWorkspace;
    setLoggedInUI();
    if (!SERVICE_ID) {
      endBusy({ kind: "err",
                status: "No ws_service_id in the URL — open this app from the BioEngine dashboard." });
      return;
    }
    busyPhase("Resolving service");
    svc = await server.getService(SERVICE_ID, { _rkwargs: true });
    endBusy({ kind: "ok", status: "Connected to " + SERVICE_ID });
  } catch (err) {
    // Rethrown on purpose: both callers surface it — startLogin() with a modal
    // (user-initiated) and boot with deferError() (must not ambush a load).
    // Nothing is swallowed here.
    endBusy({ kind: "err", status: "Connection failed." });
    throw err;
  }
}

async function startLogin() {
  setLoggingInUI();
  try {
    const token = await login({
      server_url: SERVER_URL,
      // window.open works here because we are inside the click's user gesture.
      login_callback: (ctx) => { window.open(ctx.login_url); },
    });
    saveToken(token);
    await connectWithToken(token);
  } catch (err) {
    showError({ title: "Login failed",
                subtitle: SERVER_URL,
                message: "Could not complete the Hypha auth flow.",
                detail: formatErr(err) });
    setLoggedOutUI();
  }
}
$("loginBtn").addEventListener("click", startLogin);

$("logoutBtn").addEventListener("click", async () => {
  clearSavedToken();
  svc = null; userWorkspace = null; userEmail = null;
  // Ignorable: we are tearing the session down on purpose. A socket that is
  // already gone is the outcome we wanted, and the local state below is reset
  // either way. Surfacing this would be noise on a successful sign-out.
  try { if (server?.disconnect) await server.disconnect(); } catch (_) {}
  server = null;
  setLoggedOutUI();
});

/* Boot: URL token (testing) → cached token → stay logged out. While a token is
   available BOTH topbar buttons stay hidden, so Login never flashes. */
(async () => {
  const cached = URL_TOKEN || loadSavedToken();
  if (!cached) { setLoggedOutUI(); return; }
  try {
    await connectWithToken(cached);
  } catch (err) {
    if (!URL_TOKEN) clearSavedToken();
    console.error("auto-connect failed", err);
    setLoggedOutUI();
    // A hypha failure, so it must NOT be dropped — but a modal on page load
    // ambushes the user. Defer it: the status line gets a Details button that
    // opens the full dialog with the real trace, on demand.
    deferError({
      status: "Could not connect — sign in again.",
      title: "Auto-connect failed",
      subtitle: SERVICE_ID || SERVER_URL,
      message: "The cached session could not be used to reach the worker.",
      detail: formatErr(err),
    });
  }
})();

/* ==========================================================================
   ▸ EDIT 4 — call your @bioengine.method.
   A browser Uint8Array round-trips byte-exact into a Python `bytes`
   parameter over hypha-rpc, so no base64 is needed. `_rkwargs: true` is
   required on every JS RPC call.
   ========================================================================== */
async function callBackend(report) {
  // Encoding is real work over a known number of chunks -> determinate.
  const payload = await b64(state.bytes, f => report("Encoding image", f));

  // The worker cannot report inference progress, so this phase is honestly
  // indeterminate: motion + a changing label, and no invented percentage.
  report("Segmenting");
  return await svc.segment({
    image_base64:     payload,                 // this backend takes base64;
    sigma:            parseFloat($("sigmaInput").value) || 0,
    threshold_method: $("thresholdSel").value,
    min_size:         parseInt($("minSizeInput").value, 10) || 0,
    min_distance:     parseInt($("minDistInput").value, 10) || 1,
    return_overlay:   true,
    _rkwargs: true,
  });
  /* Binary variant — prefer this in new backends (~33% smaller payload, and it
     skips the encode phase entirely):
     return await svc.segment_bytes({ image_bytes: state.bytes,
                                      threshold_method: ..., _rkwargs: true }); */
}

/* Chunked so the progress it reports is real, and so it yields to the event
   loop — a synchronous encode would freeze the very spinner meant to show it. */
async function b64(u8, onProgress) {
  const CHUNK = 0x8000;
  let s = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    if ((i / CHUNK) % 8 === 0) {
      onProgress(i / u8.length);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  onProgress(1);
  return btoa(s);
}

/* ▸ EDIT 5 — map your result object onto the UI. */
function renderResult(res) {
  const objects = Array.isArray(res.objects) ? res.objects : [];

  const stats = [
    { k: "Objects", v: String(res.count ?? objects.length), accent: true },
    { k: "Threshold", v: `${res.threshold_method ?? "—"}` },
    { k: "Elapsed", v: res.elapsed_s != null ? res.elapsed_s.toFixed(3) + " s" : "—" },
  ];
  $("statsRow").innerHTML = stats.map((s, i) =>
    `<div class="stat${s.accent ? " accent" : ""}" style="--d:${i * 60}ms">`
    + `<div class="k">${escapeHTML(s.k)}</div><div class="v">${escapeHTML(s.v)}</div></div>`
  ).join("");

  // Stagger only the first rows (30–80ms apart). A 300-row cascade reads as lag.
  $("objBody").innerHTML = objects.map((o, i) =>
    `<tr style="--d:${Math.min(i, 13) * 40}ms"><td>${i + 1}</td>`
    + `<td>${escapeHTML(o.label ?? i + 1)}</td>`
    + `<td>${Number(o.y ?? (o.centroid || [])[0] ?? 0).toFixed(2)}</td>`
    + `<td>${Number(o.x ?? (o.centroid || [])[1] ?? 0).toFixed(2)}</td>`
    + `<td>${escapeHTML(o.area ?? "—")}</td></tr>`
  ).join("");

  if (res.overlay_png_base64) {
    setOverlay("data:image/png;base64," + res.overlay_png_base64,
               Math.round(res.overlay_png_base64.length * 3 / 4));
  } else {
    $("overlayWrap").hidden = true;
  }

  $("resultBadge").textContent = `${res.count ?? objects.length} objects`;
  $("resultBadge").hidden = false;
  $("resultEmpty").hidden = true;
  $("resultBody").hidden = false;
}

/* Result images get exactly the same treatment as user-provided ones. */
function setOverlay(src, approxBytes) {
  state.overlayURL = src;
  state.overlaySize = approxBytes || 0;
  $("overlayImg").src = src;
  $("compareResult").src = src;
  $("overlaySize").textContent = fmtBytes(state.overlaySize);
  $("overlayDims").textContent = "…";
  $("overlayImg").onload = () => {
    state.overlayDims = [$("overlayImg").naturalWidth, $("overlayImg").naturalHeight];
    $("overlayDims").textContent = `${state.overlayDims[0]} × ${state.overlayDims[1]}`;
  };
  /* The call can succeed and still hand back bytes the browser cannot decode,
     e.g. a truncated or mislabelled PNG. Without this the user sees a broken
     image glyph, a dims chip stuck on the placeholder, and no explanation,
     which reads as a frontend bug when it is a backend one. */
  $("overlayImg").onerror = () => {
    $("overlayWrap").hidden = true;
    $("overlayDims").textContent = "—";
    showError({
      title: "Result image could not be displayed",
      subtitle: SERVICE_ID || "",
      message: "The run finished, but the returned image data could not be decoded.",
      detail: "The worker replied successfully, so this is not a connection problem. "
            + "The returned bytes are not a valid image, which usually means the app "
            + "encoded the result incorrectly.\n\nReported size: "
            + fmtBytes(state.overlaySize),
    });
  };
  $("overlayWrap").hidden = false;
  updateCompareVisibility();
}

function clearResult() {
  state.overlayURL = null; state.overlayDims = null; state.overlaySize = 0;
  $("resultBody").hidden = true;
  $("resultEmpty").hidden = false;
  $("resultBadge").hidden = true;
  $("overlayWrap").hidden = true;
  $("objBody").innerHTML = "";
  $("statsRow").innerHTML = "";
  updateCompareVisibility();
}

let successCount = 0;

$("runBtn").addEventListener("click", async () => {
  if (!svc || !state.bytes) return;
  $("runBtn").disabled = true;

  const firstRun = $("resultBody").hidden;
  beginBusy("Starting", {
    button: true,
    delayMs: 0,
    hint: "Still running — large images take longer.",
  });
  if (firstRun) {
    // No result to preserve: show a placeholder shaped like the real thing.
    $("resultEmpty").hidden = true;
    $("resultSkeleton").hidden = false;
  } else {
    // A result is already on screen: keep it and dim it, so nothing moves.
    $("resultBody").classList.add("rerunning");
  }

  const t0 = performance.now();
  let doneMsg = "", err = null;
  try {
    const res = await callBackend(busyPhase);
    busyPhase("Rendering result");
    if (firstRun) clearResult();
    renderResult(res);
    doneMsg = `Done — ${res.count ?? "?"} objects in `
            + `${((performance.now() - t0) / 1000).toFixed(2)}s.`;
  } catch (e) {
    err = e;
  } finally {
    // The ONLY exit from the busy state, on both paths. This is what stops a
    // failed call leaving the spinner running forever.
    endBusy(err ? { kind: "err", status: "Run failed." }
                : { kind: "ok", status: doneMsg });
  }

  if (err) {
    if ($("resultBody").hidden) $("resultEmpty").hidden = false;
    // User-initiated RPC → modal with the full trace, never a silent log.
    showError({
      title: "Run failed",
      // One line of context: which file, against which service.
      subtitle: [state.file && state.file.name, SERVICE_ID].filter(Boolean).join("  ·  "),
      message: "The <code>segment</code> call did not complete on the worker.",
      detail: formatErr(err),
    });
    return;
  }

  // Completion registers on every run through the status line and the green
  // dot; the badge only celebrates the first one. Someone running this twenty
  // times does not need twenty celebrations.
  if (++successCount === 1) {
    $("resultBadge").classList.add("pop");
    setTimeout(() => $("resultBadge").classList.remove("pop"), 500);
  }
});
</script>
</body>
</html>
```

**Why each piece is there:**

- **`[hidden] { display: none !important }`** — the user-agent `[hidden] { display: none }` rule loses to any class that sets `display: inline-flex` (e.g. `.topbar-btn`). Without this override, setting `el.hidden = true` in JS flips the attribute but the element keeps rendering. Easy to miss; ship the override every time.
- **Both topbar buttons start `hidden` in HTML, JS reveals one synchronously on boot.** Otherwise the Login button visibly flashes for the duration of the WebSocket connect when a returning user reloads the page.
- **`login_callback: (ctx) => window.open(ctx.login_url)`** — `window.open` succeeds here because we're inside the click handler's user-gesture context. Don't await the URL and then open — by then the gesture has expired and the popup is blocked.
- **localStorage cache with 3 h TTL** — mirrors `bioimage.io`'s `LoginButton` so users move between apps without re-authenticating.
- **`SERVER_URL` defaults to `window.location.origin`** — when the page is served from a Hypha instance (e.g. `https://hypha.aicell.io/...`), the same instance is the right RPC target by default, so the user never has to pass `?server=`. The `http(s):` protocol check guards against `file://` and other non-http origins falling through into `connectToServer`, in which case the hardcoded `https://hypha.aicell.io` fallback kicks in. Still allow `?server=` to override (e.g. for cross-instance development).
- **`?token=` URL param** — testing-only path. Documented in the source as such because tokens in URLs are visible in browser history.
- **`{ _rkwargs: true }` on every `getService(...)` and RPC call** — required in JavaScript, and **not accepted** in Python. It is a JS-only marker telling the RPC codec to unpack the trailing object as keyword arguments; the Python client already passes kwargs natively, so passing `_rkwargs=False` there is not harmless, it is a hard `TypeError: got an unexpected keyword argument '_rkwargs'`.
- **`data-theme` is set by an inline script in `<head>`, before the stylesheet paints.** Any theme decision made after first paint is a visible flash. This is the same discipline as the topbar's "both buttons start hidden" rule, applied to colour.
- **`SEED_FROM_OS` / `DEFAULT_THEME` are named constants, not a buried expression.** Browsers cannot report "no preference" — `prefers-color-scheme` resolves to `light` unless dark is explicitly set — so seeding from the OS means most stock machines start light. Seeding is the right default for a real app; set `SEED_FROM_OS = false` for demo or screenshot work, where a consistent first frame matters more.
- **The theme switch uses a temporary `html.theme-switching *` rule.** It is the one blunt selector in the file: it transitions five colour properties for 160ms and is then removed, so it can never interfere with the interaction transitions. Enumerating per-component colour transitions instead costs ~40 rules and leaks theme timing into hover timing. Verified not to move layout.
- **The drop zone counts `dragenter`/`dragleave` depth.** `dragleave` fires every time the pointer crosses into a *child* element, so a naive handler drops the drag state the instant the pointer moves over the icon. The counter is the fix; a `relatedTarget` check also works.
- **Window-level `dragover`/`drop` are `preventDefault`ed.** Without it, a file dropped just outside the zone navigates the page away and the user loses their session.
- **The inspect viewer measures with `clientWidth`/`clientHeight`, not `getBoundingClientRect()`.** See § *Two traps* below — this one is silent and easy to ship.
- **The Run button's icon is wrapped in a `<span>`.** `hidden` is an `HTMLElement` property; `SVGElement` does not reflect it. See § *Two traps*.
- **`#notice` layers its tint over an opaque base.** See § *Two traps*.
- **Every wait exits through one `endBusy()`, called from a `finally`.** A spinner still spinning after a failed call is the classic bug in this pattern, and it is a bug of structure: as soon as two code paths can end a wait, one of them eventually will not.

**Key points:**
- Import `login` and `connectToServer` from the same CDN module — no npm needed.
- `server_url` and `ws_service_id` come from URL query params injected by BioEngine when the page is served via the artifact's `static_site_url`.
- `frontend_entry: "frontend/index.html"` in `manifest.yaml` is still the field that causes BioEngine to populate `static_site_url` and the dashboard's "Open UI" button (confirmed unchanged in format_version 0.6.0). It's additive to the normal `entry:` field — add it alongside `entry:`, don't replace it:
  ```yaml
  format_version: 0.6.0
  entry: my_deployment:MyDeployment   # the deployment class (0.6.0 single-entry field)
  frontend_entry: "frontend/index.html"   # optional — only if you ship a frontend/ dir
  ```
  The artifact's `view_config` (`root_directory: "frontend"`, `index: "index.html"`) is configured automatically by `upload_app`.
- Change `TOKEN_KEY` / `TOKEN_EXPIRY` constants per app so apps share a Hypha session origin but keep separate localStorage entries.
- **The frontend does not resolve service IDs, and there is no CORS to fight.** BioEngine injects the fully-resolved `ws_service_id` (plus a `webrtc_service_id`) into the URL when it serves the page from `static_site_url`, so the page never runs the `get_app_status` discovery recipe in [service_ids.md](service_ids.md) — that recipe is for *external* callers. And because the page and the `wss://` RPC endpoint are the same origin, there is no preflight, no CORS header, and no `view_config.headers` tuning to do. Read `ws_service_id` off the query string and connect.
- Change `THEME_KEY` as well as `TOKEN_KEY` / `TOKEN_EXPIRY` per app, and keep `THEME_KEY` in sync with the literal in the `<head>` boot script — that script runs before the module and cannot import the constant.
- **Give every image the same treatment.** Whatever the backend returns is as much a scientific image as the one the user uploaded; if the input is zoomable and the result overlay is not, the result is the one people actually needed to inspect. The template routes both through one `openInspect({src, title, sub, trigger})`.
- **Popovers scale from their trigger; modals scale from their centre.** A popover with `transform-origin: center` looks subtly wrong in a way most people cannot name.
- **Stagger the results table, but cap it.** 30–80ms between rows reads as polish; a 300-row cascade reads as lag. The template staggers the first 14 rows and no more.
- Honour `prefers-reduced-motion`, but read it as *fewer and gentler*, not *none*. The template keeps opacity and colour transitions and every text status; it drops rotation and travel. A spinner that stops moving entirely under reduced motion removes the only signal that work is happening — the template's spinner breathes instead.

### Getting the frontend URL

`bioengine apps status <app-id>` prints Application / Status / Artifact / Deployments and **never the frontend URL**. It only exists in the JSON form:

```bash
bioengine apps status my-app --json     # → result["my-app"]["static_site_url"]
```

The populated URL looks like this (note the three injected query params):

```
https://hypha.aicell.io/<workspace>/view/my-app/?server=https://hypha.aicell.io&ws_service_id=<workspace>/bioengine-worker-<site>-<hash>:my-app&webrtc_service_id=<...>:my-app-rtc
```

### Sending an uploaded image to the backend

The wire format for image bytes is the first wall every image-app frontend hits. **A browser `Uint8Array` and a raw `ArrayBuffer` both round-trip byte-exact into a Python `bytes` parameter over hypha-rpc** (validated in a live browser: 102145 bytes sent, 102145 received, on both same-node and default routing). **Base64 is not required** — it also works, but inflates every upload by ~33%. Prefer binary.

Browser side:

```js
// <input type="file" id="fileInput" accept="image/*">
const file  = $("fileInput").files[0];
const buf   = await file.arrayBuffer();       // or FileReader.readAsArrayBuffer
const bytes = new Uint8Array(buf);            // buf itself also works

const result = await svc.segment({
  image_bytes: bytes,                         // straight through — no base64
  threshold_method: "otsu",
  _rkwargs: true,                             // required on every JS RPC call
});
```

Matching deployment method — declare the parameter as `bytes`:

```python
@bioengine.method
async def segment(
    self,
    image_bytes: bytes = Field(..., description="Raw 2D image file bytes (binary, not base64)."),
    threshold_method: str = Field("otsu", description="'otsu' or 'li'."),
) -> dict:
    """Segment an image supplied as raw file bytes."""
    import asyncio

    raw = bytes(image_bytes)                  # normalise whatever hypha-rpc handed you
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, self._segment_sync, raw, str(threshold_method).lower())
```

Note the return direction is still governed by the `.tolist()` rule — send masks and coordinate arrays back as plain lists (or, for a preview image, a base64 PNG string).

### Shipping a multi-file frontend

The template is a single self-contained `index.html`, but you are not limited to one file. **Sibling files and nested subdirectories under `frontend/` are all served, with correct MIME types**, at paths relative to the `static_site_url` base (the `root_directory: frontend` prefix is stripped). So this layout works as written:

```
frontend/
├── index.html          # → <static_site_url>/
├── styles.css          # → <static_site_url>/styles.css        (text/css)
└── assets/
    └── logo.svg        # → <static_site_url>/assets/logo.svg
```

Reference them with ordinary relative URLs (`<link rel="stylesheet" href="styles.css">`, `fetch("assets/data.json")`).

### Testing your frontend

`?token=<hypha-token>` is the auto-connect bypass at the top of the boot sequence, and it is **the one thing that makes agent-driven browser testing possible** — the interactive `login()` flow needs a human to complete it in a popup, so without `?token=` an automated browser run stalls at the login screen. Load `<static_site_url>?…&token=$HYPHA_TOKEN` in a headless browser and the page connects and enables its controls unattended. It stays testing-only: tokens in URLs land in browser history, so never paste a production token into a shared link.

Two headless-Chromium traps that cost more time than anything BioEngine-related, and are worth pre-empting:

- **Waits and screenshots time out on a perfectly healthy page.** Playwright's `wait_for_function` polls on `requestAnimationFrame` by default and `page.screenshot()` waits for frame stability. An occluded headless page intermittently stops producing compositor frames, so both hang until timeout while the app underneath is fine. Fixes: `page.wait_for_function(..., polling=500)` (wall-clock polling instead of rAF), capture via CDP `Page.captureScreenshot` instead of `page.screenshot()`, and launch with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion`.
- **Don't reuse one browser across a logged-out and a logged-in scenario.** A fresh `launch()` per scenario removed a reproducible connect hang.

### Choosing your theme (both are shipped)

The template ships **two complete token sets** and a toggle. You are not obliged to keep all
three. Pick one of these and edit accordingly — everything below the token blocks is
theme-agnostic, because there is no raw hex anywhere else in the file.

| You want | What to do |
|---|---|
| **Both, user-switchable** (shipped default) | Nothing. |
| **Light only** | In the `<head>` boot script set `SEED_FROM_OS = false` and `FALLBACK_THEME = "light"`, and delete the `#themeBtn` element. Leave both token blocks; the unused one costs nothing and makes it a one-line change to reinstate. |
| **Dark only** | Same, with `FALLBACK_THEME = "dark"`. |
| **A third theme** (an institute palette) | Copy either `[data-theme="..."]` block, rename it, change the values. Nothing else in the file needs to know. |

Two knobs govern the whole policy, and only two:

```js
var SEED_FROM_OS   = true;     // first visit follows prefers-color-scheme
var FALLBACK_THEME = "dark";   // used when the OS does NOT report light
```

**`FALLBACK_THEME` is not "the app's default theme."** Browsers cannot report *no
preference* — `prefers-color-scheme` resolves to `light` unless dark is explicitly set — so
seeding is a two-way branch, and `FALLBACK_THEME` is only the **dark-OS branch** (plus the
no-JS / storage-blocked fallback). Setting it to `"light"` while `SEED_FROM_OS` is true does
not "make light the default": it silently destroys OS seeding for every dark-OS user, because
then both branches produce light. If you want light-only, turn seeding off as well.

With the shipped defaults:

| Situation | First paint |
|---|---|
| Stock light-OS machine | **light** (the common case) |
| Dark-OS machine | **dark** |
| JS disabled / localStorage blocked | **light** — the `data-theme` on `<html>` |
| Returning user who has toggled | **their choice**, always, over anything above |

> **What "JS disabled" actually looks like, beyond the theme.** The row above answers *which
> colours*, which is the least of it. With JS off the page renders complete and operational and
> does nothing at all: the file input never uploads, the status line sits on "Connecting…"
> forever, and — this is the non-obvious one — **neither auth button is visible**, because the
> topbar deliberately starts both `hidden` and lets the boot script reveal exactly one (that is
> what stops a Login button flashing at a returning user). No boot script, no reveal. The
> template therefore ships a `<noscript>` block above the header saying so plainly. Keep it if
> you re-theme, and keep it *above* the fold: a notice underneath the UI is found after the
> visitor has already spent a minute clicking a dead interface.

Set the `<html data-theme="...">` attribute to match whichever theme you want on a no-JS load;
it governs nothing else, because the boot script overwrites it before first paint.

### Always show that something is happening

A disabled button communicates "blocked", not "busy". Never let a disabled control be the only signal that the app is working. This matters more for BioEngine than for most UIs: a cold worker can take **10–11 minutes** to come up, and inference on a large plane runs from seconds to minutes.

The template implements the rules below; they are worth restating because they are easy to get subtly wrong.

- **Determinate only where a real fraction exists.** Bytes read and chunks encoded are real. Inference is not — the worker reports no progress, so it gets an indeterminate sweep and **no `aria-valuenow`**. A progress bar that lies is worse than a spinner that does not.
- **Indeterminate still has to be informative.** Pair the motion with a label that changes as the phase changes (`Connecting` → `Resolving service`, `Reading 46.76 MB` → `Encoding image` → `Segmenting` → `Rendering result`). A long wait then reads as progress instead of a hang.
- **Spin fast.** The template's spinner turns in 560ms. Perceived performance is as real as actual performance: the same wait feels shorter behind a quicker spinner.
- **Put the phase in the button.** Swap the idle icon for an inline spinner and the label for the phase name. Keep the button's width fixed (the template's is full-width, and the label has a `min-width`) so nothing reflows.
- **Do not flash.** Reveal the busy chrome only after ~90ms. Work that finishes faster than that should show nothing at all — a spinner that appears for 10ms is noise, not feedback.
- **Say more after ~10s.** Silence past ten seconds reads as a crash. The template surfaces a reassurance line ("Still running — large images take longer.").
- **Skeleton the *first* result only.** On a re-run, keep the previous result on screen and dim it: the layout then never jumps at all.
- **Let completion register, once.** Every run updates the status line and the dot; only the first run plays the badge animation. Someone running the same app twenty times does not need twenty celebrations.
- **Errors must clear the busy state everywhere.** Structure this so it cannot rot: one `endBusy()` that resets every affordance, called from a `finally` on every path. Then test the failure path deliberately — send bytes the backend cannot decode and confirm the spinner stops, the label resets, and the button re-enables.

```javascript
// The shape that makes the invariant hold. Note there is exactly one exit.
let doneMsg = "", err = null;
try {
  const res = await callBackend(busyPhase);   // busyPhase(label, frac?) drives the UI
  busyPhase("Rendering result");
  renderResult(res);
  doneMsg = `Done — ${res.count} objects.`;
} catch (e) {
  err = e;
} finally {
  endBusy(err ? { kind: "err", status: "Run failed." }
              : { kind: "ok", status: doneMsg });
}
if (err) showError({ title: "Run failed", detail: formatErr(err) });
```

### Two traps that cost real time

Both of these are silent: the code looks right, the assertions pass, and the UI is wrong. Both were found only by looking at a screenshot.

**1. `getBoundingClientRect()` returns the *transformed* box.** Any measure-on-open logic inside a container that animates in will read the wrong size. A modal entering from `transform: scale(0.96)` reports 96% of its real dimensions for the duration of the transition, so a "fit image to window" computed on open lands on the wrong zoom and never matches the Fit button afterwards. Use `clientWidth` / `clientHeight`, which are layout values and transform-independent.

```javascript
// Wrong — 96% of the truth while the modal is still scaling in
const r = viewer.getBoundingClientRect();
const [vw, vh] = [r.width, r.height];

// Right — layout size, unaffected by any ancestor transform
const [vw, vh] = [viewer.clientWidth, viewer.clientHeight];
```

This collides head-on with the rule that nothing should enter from `scale(0)` — follow both and you will hit it.

**2. A translucent tint token is only safe over an opaque ancestor.** Status tints (`--warn-soft` and friends) are ~12% alpha. Inside a card they composite over the card's opaque background and look correct. A *floating* element — `position: fixed` toast, dropdown, tooltip — has page content behind it instead, so replacing its background with the tint makes the text unreadable, and it is worst over exactly the dark microscopy pixels these apps display. Layer the tint over an opaque base rather than replacing it:

```css
/* Wrong — ~12% alpha over whatever the page is showing */
#notice.warn { background: var(--warn-soft); }

/* Right — tint composited over an opaque base */
#notice.warn {
  background: linear-gradient(var(--warn-soft), var(--warn-soft)), var(--bg-2);
}
```

**And a third, for whenever you toggle an `<svg>`:** `hidden` is an `HTMLElement` property. `SVGElement` does not implement it, so `svgEl.hidden = true` silently sets a plain JS expando, never adds the attribute, and the icon keeps rendering — while any test that reads `svgEl.hidden` back happily reports `true`. Wrap the `<svg>` in a `<span>` and toggle that, or use `setAttribute("hidden", "")`. This is the same family as the `[hidden] { display: none !important }` guard above: `el.hidden = true` not doing what it says.

**The pattern behind all three:** every one passed its geometry assertion and was caught only by reading the rendered image. When you verify a frontend, assert on what *renders* — `getComputedStyle(el).display`, the element's bounding box — not on the property you just set, and look at the screenshots rather than only collecting them.

### Never silently drop an external error

**The rule: a failure that came from outside the page — a hypha RPC, the network, image or
file IO — must always be reachable by the user, in full, and copyable.** No console-only
paths. An app that swallows a worker error leaves the user with a UI that simply did not do
anything, and nothing to send you when they report it.

That is not the same as "pop a modal for everything". Two shapes, and the rule for choosing:

| Failure | Surface |
|---|---|
| **User-initiated** — they pressed Run, Delete, Login | Modal immediately. They are waiting for an outcome; this is the outcome. |
| **Deferred** — page-load auto-connect, background refresh, prefetch | **Never** a modal (ambushing a page load with a dialog is hostile). Put the message in the status line and make that line a **button** carrying the real error. |

The deferred case is the one that usually gets dropped, because "don't pop a modal on load"
quietly becomes `console.error` and a vague one-liner. Never-silent and never-ambushing are
both achievable — take both:

```javascript
// Boot: the cached token failed. Not a modal. Not a console-only log either.
} catch (err) {
  console.error("auto-connect failed", err);
  setLoggedOutUI();
  deferError({
    status:   "Could not connect — sign in again.",   // shown in the status line
    title:    "Auto-connect failed",
    subtitle: SERVICE_ID,                             // one line of context
    message:  "The cached session could not be used to reach the worker.",
    detail:   formatErr(err),                         // the real trace, on demand
  });
}
```

`deferError` stashes the error and reveals a small **Details** button next to the status
line. It must be a real `<button>` (keyboard reachable, `aria-label`, pointer cursor, an
icon) — if it does not look pressable, nobody finds the error behind it. Any subsequent
`setStatus()` clears it, so the button can never outlive its message.

**Why the detail pane scrolls.** A worker error is not one line. A real
`ray.exceptions.UnserializableException` measured on a live deployment came back as **97
lines / 7430 characters** of nested traceback. So the pane is `max-height` + `overflow: auto`
+ `white-space: pre-wrap`: the dialog never stretches the page, the newlines survive, and the
user can scroll and copy the whole thing. Note that Chromium now draws fade-in *overlay*
scrollbars and ignores `::-webkit-scrollbar`, so the scrollbar alone does not tell anyone
there is more below — the template adds an explicit "scroll for more" cue, toggled by scroll
position, in a row **reserved beneath** the pane rather than floating over the text. A cue
added because the scrollbar is invisible must not itself cover the content it advertises.

**Do not tell the user the answer is on the last line.** That is true of a traceback printed
in a terminal, and false here: `err.stack` in the browser appends the hypha-rpc frames loaded
from the CDN *after* the Python traceback, so the actionable exception usually sits in the
**middle** of the scroll. The user has to be able to reach all of it, which is exactly why the
pane scrolls and why the cue exists.

**Strip ANSI escapes before display.** Ray colourises worker tracebacks, and those escapes
render inside a `<pre>` as literal `?[36m` garbage wrapped around the exception name, which is
the first thing the user reads. `formatErr` strips them at the single choke point every caller
already goes through, so no call site can forget. The regex anchors on the ESC byte, which
never occurs in ordinary traceback text, so it cannot eat real content. Strip for the
clipboard too: escape codes pasted into a bug report are noise, not colour.

#### Losing the connection while the page sits idle

Everything above is about a call that *failed*. A page left open for an hour has a different
problem: the websocket drops and nothing tells the user, so the next click fails for a reason
that has nothing to do with what they clicked. Here is what hypha-rpc actually does, verified
against the `0.20.54` build this template pins:

| What happened | What hypha-rpc does | What you must do |
|---|---|---|
| **Clean close** (codes 1000/1001: server restart, token expiry, workspace shut down) | Calls the connection's `on_disconnected(reason)` handler once. | Register a handler and reflect it in the status line. |
| **Unexpected drop** (network blip, laptop sleep, proxy timeout) | **Reconnects silently, effectively forever** — the retry cap is 10<sup>6</sup> — and reports each attempt to the *console only*. `on_disconnected` is **never called**. | Nothing to hook. Do not claim live connection state you do not have. |
| **A call in flight when the socket dropped** | Rejects on the per-call method timeout (30 s default). | Already covered: it arrives at your `catch` as an ordinary RPC failure. |

So the hook exists but only covers the clean case:

```javascript
// The connection lives on a private field. Guard the whole path — it is not
// public API and can move between hypha-rpc releases; a missing hook must
// degrade to "no disconnect notice", never to a TypeError at boot.
server.rpc?._connection?.on_disconnected?.((reason) => {
  setStatus("err", "Disconnected from the worker. Reload to reconnect.");
});
```

**And be honest in the status line.** Because the silent-reconnect path is unobservable from
the page, a green "Connected" dot cannot mean *connected right now*. It means *the last call
succeeded*. Word it that way, or drive it from the last successful call rather than from the
connect event. The browser's `online` / `offline` events are a useful complement (they catch
the laptop going offline) but they are not a substitute: `offline` means *this browser* has no
network, and says nothing about whether the worker is reachable or alive.

Do not paper the gap over with a polling heartbeat unless the app genuinely needs live
presence. An extra RPC every few seconds per open tab is a real cost on a shared worker, and
the honest cheap version — surface clean closes, let call failures speak for themselves, and
never overclaim in the status line — covers what a user can actually act on.

Non-negotiables for the dialog itself:

- **`textContent` for the detail, never `innerHTML`.** It is server output; treat it as data.
- **Fall back to `"(no error message returned)"`** when the detail is empty, so an error with
  no text still looks handled rather than looking like a broken dialog.
- **A `subtitle`** for one line of context — service id, artifact id, filename. It is what
  makes a pasted screenshot actionable.
- **Return focus** to whatever had it when the dialog opened, on close.
- **Stack it above every other overlay.** An error raised while an image viewer or another
  dialog is open must render in front of it, not behind. Give it a higher `z-index` and
  verify by hit-testing, not by reading the stylesheet.

**Genuinely ignorable failures exist — comment them.** `localStorage` throwing in private
mode, or `server.disconnect()` failing while you are deliberately tearing the session down,
are safe to swallow: nothing external failed and the app already handles the degraded state.
The rule is that a bare `catch (_) {}` must carry a one-line comment saying why it is safe.
An uncommented empty catch is indistinguishable from a bug.

### Error popups for button-driven failures

When a button handler triggers a Hypha RPC and it fails, surface the failure as a **modal error dialog with a scrollable detail block** — not a silent console log, and not `window.alert()`. Users need to see *what* broke (server message, stack) to file a useful bug, and `alert()` truncates long stacks and blocks the event loop.

The **modal** applies to **user-initiated** RPCs (button clicks, form submits). Background and boot-time refreshes (page-load auto-connect, pre-fetching dropdown contents) must not pop a modal, because ambushing a page load is hostile — but they must not fail silently either. They route through `deferError` instead, which puts the message in the status line and makes that line a button carrying the full trace (see *Never silently drop an external error* above). The pattern below is a single shared helper plus a `popupOnError` flag so refresh functions can be reused from both contexts.

```html
<!-- Error dialog (placed next to the confirm dialog if you have one). Reuses
     the same .modal-backdrop / .dialog styles; .dialog-wide widens it and
     .dialog-detail adds a scrollable monospace block for stack traces. -->
<div id="errorDialog" class="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="errorTitle" hidden>
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
      <button class="btn" type="button" id="errorCopy">Copy</button>
      <button class="btn btn-primary" type="button" id="errorClose">Close</button>
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
// of whatever the RPC layer surfaces. Ray colourises worker tracebacks with
// ANSI escapes, which render as literal "?[36m" garbage in a <pre>; strip them
// at this one choke point so no call site can forget.
const ANSI_ESCAPE = /\x1B\[[0-9;?]*[ -\/]*[@-~]/g;
const stripAnsi = s => (typeof s === "string" ? s.replace(ANSI_ESCAPE, "") : s);

function formatErr(err) {
  if (!err) return "";
  if (typeof err === "string") return stripAnsi(err);
  return stripAnsi(err.stack || err.message || (() => {
    try { return JSON.stringify(err, null, 2); } catch { return String(err); }
  })());
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

**Modal for button handlers, deferred status line for background loaders.** Refresh functions called from both boot and a button should accept `{ popupOnError = false }`, and the flag selects *which surface*, never whether the user is told at all. The boot path is quiet, not silent:

```javascript
async function refreshTests({ popupOnError = false } = {}) {
  try { cachedTests = await svc.list_visual_tests({ _rkwargs: true }); }
  catch (err) {
    cachedTests = [];
    log("list_visual_tests failed: " + err.message, "err");
    const surfaced = {
      title:    "Could not refresh visual tests",
      subtitle: SERVICE_ID,
      message:  "The list of visual tests could not be read from the worker.",
      detail:   formatErr(err),
    };
    // Same error, same full trace, two surfaces. The boot path must never be a
    // bare log(): a log line is invisible to the person the app is failing on.
    if (popupOnError) showError(surfaced);
    else deferError({ status: "Could not load visual tests.", ...surfaced });
  }
  renderTestList();
}
// boot: no modal, but a clickable status line carrying the trace
refreshTests();
// button: modal on failure
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

**For batch buttons, aggregate failures into a single end-of-run popup.** A 50-tile loop that pops a modal per failure is hostile. The correct shape: keep marking per-item failures inline on the tile (so they're visible while the batch is still running), collect each error into an array, and at the end fire exactly one `showError()` with the aggregated detail. That way the literal "every button-driven RPC failure goes to a modal" rule holds without spamming the user.

```javascript
const batchErrors = [];
for (const item of items) {
  try { await svc.process({ image_ref: item.url, _rkwargs: true }); item.state = "done"; }
  catch (err) {
    item.state = "error"; item.error = err.message || String(err);
    batchErrors.push({ stage: "process", file: item.name, detail: formatErr(err) });
  }
  render();   // per-tile state surfaces in the inline UI immediately
}

if (batchErrors.length) {
  const detail = batchErrors
    .map(e => `[${e.stage}] ${e.file}\n${e.detail}`)
    .join("\n\n----------\n\n");
  showError({
    title: `Batch finished with ${batchErrors.length} error${batchErrors.length === 1 ? "" : "s"}`,
    message: `${batchErrors.length} of ${items.length} item${items.length === 1 ? "" : "s"} failed. Full traces below.`,
    detail,
  });
}
```

The scrollable `.dialog-detail` block makes this scale: 50 separate stack traces fit fine because the user can scroll, copy them all at once, and the rest of the UI is not blocked.
