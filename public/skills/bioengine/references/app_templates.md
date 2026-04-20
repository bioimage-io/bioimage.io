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

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>My BioEngine App</title>
  <style>
    body { font-family: system-ui; background: #0f172a; color: #e2e8f0;
           min-height: 100vh; display: flex; flex-direction: column;
           align-items: center; padding: 2rem 1rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: .75rem;
            padding: 1.5rem; width: 100%; max-width: 640px; margin-bottom: 1rem; }
    button { background: #0284c7; color: #fff; border: none; border-radius: .5rem;
             padding: .5rem 1.25rem; cursor: pointer; font-weight: 600; }
    button:disabled { background: #334155; color: #64748b; cursor: not-allowed; }
    pre { background: #0f172a; border-radius: .5rem; padding: 1rem;
          font-size: .8rem; white-space: pre-wrap; min-height: 3rem;
          color: #94a3b8; overflow-y: auto; max-height: 16rem; }
  </style>
</head>
<body>
<div class="card">
  <h2>My BioEngine App</h2>
  <button id="connectBtn" onclick="connect()">Connect</button>
  <p id="status">Not connected</p>
</div>
<div class="card">
  <button id="pingBtn" onclick="callPing()" disabled>Ping</button>
  <pre id="result">—</pre>
</div>

<script type="module">
import { connectToServer }
  from "https://cdn.jsdelivr.net/npm/hypha-rpc@0.20.54/dist/hypha-rpc-websocket.mjs";

const p          = new URLSearchParams(window.location.search);
const SERVER_URL = p.get("server")        || "https://hypha.aicell.io";
const SERVICE_ID = p.get("ws_service_id") || "";

let svc = null;

window.connect = async () => {
  document.getElementById("status").textContent = "Connecting…";
  try {
    const server = await connectToServer({ server_url: SERVER_URL });
    svc = await server.getService(SERVICE_ID, { _rkwargs: true });
    document.getElementById("status").textContent = "Connected ✓";
    document.getElementById("pingBtn").disabled = false;
  } catch (e) {
    document.getElementById("status").textContent = "Error: " + e.message;
  }
};

window.callPing = async () => {
  document.getElementById("result").textContent = "Loading…";
  try {
    const r = await svc.ping({ _rkwargs: true });
    document.getElementById("result").textContent = JSON.stringify(r, null, 2);
  } catch (e) {
    document.getElementById("result").textContent = "Error: " + e.message;
  }
};
</script>
</body>
</html>
```

**Key points:**
- Import `connectToServer` from CDN — no npm needed.
- `server_url` and `ws_service_id` come from URL query params injected by BioEngine.
- Always pass `{ _rkwargs: true }` to service calls in **JavaScript**. Not needed in Python.
