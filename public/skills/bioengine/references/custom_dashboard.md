# Custom dashboard for a BioEngine worker

This guide walks you (the agent) through publishing a **branded static dashboard** for a BioEngine worker. Use it when the user runs a core facility, a research lab, or any deployment that wants its own UI alongside, or instead of, https://bioimage.io/#/bioengine.

The dashboard is a single HTML file plus optional assets, hosted as a Hypha **artifact** in the user's own workspace. The same `HYPHA_TOKEN` used to start the worker is reused here.

Public URL after publishing:

```
https://hypha.aicell.io/<workspace>/view/<alias>/
```

---

## 1. When to use this

- Facility offering BioEngine as a service to its users (KTH ALM, EMBL ALMF, etc.).
- Lab that wants an internal dashboard with the lab logo and only the apps it cares about.
- A teaching deployment that hides admin actions from students.
- A read-only public view of an institutional worker's apps.

If the user is fine with the canonical dashboard, do not build a custom one — point them to https://bioimage.io/#/bioengine instead.

---

## 2. What the dashboard does

It talks to the BioEngine worker via `hypha-rpc-websocket` and renders the data already exposed by `get_status()`:

- Worker mode (`single-machine` / `slurm` / `external-cluster`) and geo location.
- Total / used CPUs, GPUs, memory, per-node breakdown.
- List of deployed apps with their status, replicas, `static_site_url`, and BioImage.IO metadata.
- Optional facility branding: logo, theme colour, header text.
- Optional admin actions (deploy, stop, restart) for users in `admin_users`.

For the read-only path it needs **no admin permissions** — any user with workspace read access can load the dashboard and view status.

---

## 3. Why a Hypha artifact and not bioengine apps upload

`bioengine apps upload` builds a Ray Serve application artifact. It requires `type: ray-serve` and a non-empty `deployments` list. A static dashboard has no Python deployment, so we go straight to the **artifact-manager** RPC service instead. We still end up with a Hypha `type: application` artifact whose `view_config.index = "index.html"` — exactly the same static-site mechanism BioEngine apps use to host their frontends, just without the Ray Serve part.

Pattern:

1. `connect_to_server` with the user's `HYPHA_TOKEN`.
2. `get_service("public/artifact-manager")`.
3. `create` a staged artifact in the worker's workspace.
4. `put_file` for each file in the dashboard (HTML, optional logo, optional CSS).
5. `commit` the artifact.
6. Output the public URL.

The dashboard is in the same workspace as the worker, so links between them are short and the same Hypha auth applies.

---

## 4. Publish script (Python)

Save this as `publish_dashboard.py` and run it once after the worker is up and `worker_onboarding.md` C7 has passed.

```python
import asyncio
import os
from pathlib import Path
from hypha_rpc import connect_to_server

SERVER_URL = "https://hypha.aicell.io"
TOKEN      = os.environ["HYPHA_TOKEN"]
ALIAS      = "my-facility-dashboard"        # change me
DASHBOARD_DIR = Path("./dashboard")          # contains index.html (+ optional assets)

MANIFEST = {
    "name": "My Facility BioEngine Dashboard",
    "id":   ALIAS,
    "id_emoji": "🔬",
    "description": "Branded BioEngine dashboard for users of <facility name>.",
    "type": "application",
    "format_version": "0.5.0",
    "version": "0.1.0",
    "license": "MIT",
    "frontend_entry": "index.html",
    "authorized_users": ["*"],   # public read; tighten if needed
}

async def main():
    server = await connect_to_server({"server_url": SERVER_URL, "token": TOKEN})
    am = await server.get_service("public/artifact-manager")
    workspace = server.config.workspace
    artifact_id = f"{workspace}/{ALIAS}"

    # Stage the artifact (create or edit an existing one)
    try:
        await am.read(artifact_id)
        artifact = await am.edit(
            artifact_id=artifact_id,
            manifest=MANIFEST,
            stage=True,
            config={"view_config": {
                "branch": "main",
                "root_directory": "",
                "headers": {},
                "index": "index.html",
            }},
        )
        print(f"Editing existing artifact: {artifact_id}")
    except Exception:
        artifact = await am.create(
            type="application",
            alias=ALIAS,
            manifest=MANIFEST,
            stage=True,
            config={"view_config": {
                "branch": "main",
                "root_directory": "",
                "headers": {},
                "index": "index.html",
            }},
        )
        print(f"Created artifact: {artifact.id}")

    # Upload every file under DASHBOARD_DIR (recursive)
    import httpx
    for path in DASHBOARD_DIR.rglob("*"):
        if not path.is_file():
            continue
        rel = str(path.relative_to(DASHBOARD_DIR)).replace("\\", "/")
        upload_url = await am.put_file(artifact_id, file_path=rel)
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.put(upload_url, content=path.read_bytes())
            r.raise_for_status()
        print(f"  uploaded {rel} ({path.stat().st_size} B)")

    # Commit so the artifact is published
    await am.commit(artifact_id=artifact_id, version="0.1.0")
    print(f"\n✅ Dashboard live at:")
    print(f"   {SERVER_URL}/{workspace}/view/{ALIAS}/")

asyncio.run(main())
```

After running it, the URL is the answer to return to the user.

---

## 5. Minimal `index.html` template

Save as `dashboard/index.html`. It connects to a single worker, renders status, and lists deployed apps. The four constants at the top are the only places the agent normally edits per facility.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>BioEngine — My Facility</title>

  <!-- ──────── Theme variables (edit per facility) ──────── -->
  <style>
    :root {
      --facility-name:  "My Facility";
      --brand-color:    #2563eb;       /* primary accent */
      --brand-color-2:  #7c3aed;       /* gradient companion */
      --bg:             #fafafa;
      --fg:             #1f2937;
      --muted:          #6b7280;
      --card:           #ffffff;
      --border:         #e5e7eb;
    }
    body { margin:0; background:var(--bg); color:var(--fg);
           font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    header { background:linear-gradient(135deg,var(--brand-color),var(--brand-color-2));
             color:white; padding:20px 32px; display:flex; align-items:center; gap:16px; }
    header img { height:36px; }
    main { padding:24px 32px; max-width:1100px; margin:0 auto; }
    h1 { margin:0; font-size:22px; }
    h2 { font-size:18px; border-bottom:1px solid var(--border); padding-bottom:6px; margin-top:28px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
    .stat { font-size:12px; text-transform:uppercase; color:var(--muted); letter-spacing:0.05em; }
    .value { font-size:22px; font-weight:600; margin-top:4px; }
    .row { display:flex; gap:8px; align-items:center; margin:4px 0; font-size:14px; }
    .badge { display:inline-block; padding:1px 8px; border-radius:9999px; font-size:11px; font-weight:600;
             background:#dcfce7; color:#166534; }
    .badge.warn { background:#fef3c7; color:#92400e; }
    .badge.err  { background:#fee2e2; color:#991b1b; }
    .muted { color:var(--muted); }
    button { background:var(--brand-color); color:white; border:none; padding:8px 14px;
             border-radius:6px; cursor:pointer; font-size:14px; }
    button[disabled] { opacity:0.5; cursor:not-allowed; }
    input { border:1px solid var(--border); padding:6px 10px; border-radius:6px; font-size:14px; min-width:300px; }
    .error { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; padding:10px 14px;
             border-radius:8px; margin:16px 0; }
  </style>

  <!-- Hypha RPC client; version matches BioEngine apps' frontend convention -->
  <script src="https://cdn.jsdelivr.net/npm/hypha-rpc@0.20.30/dist/hypha-rpc-websocket.min.js"></script>
</head>
<body>

<header>
  <!-- Replace src with your facility logo, or remove the <img> entirely -->
  <img src="https://bioimage.io/bioengine-icon.svg" alt="" />
  <div>
    <h1 id="facility-title">My Facility · BioEngine</h1>
    <div style="font-size:13px;opacity:0.9">Powered by BioEngine</div>
  </div>
</header>

<main>
  <!-- ──────── Configuration (set by hand or via URL parameters) ──────── -->
  <section id="config">
    <h2>Worker</h2>
    <div class="row">
      <label for="server-url">Server URL</label>
      <input id="server-url" value="https://hypha.aicell.io" />
    </div>
    <div class="row">
      <label for="service-id">Worker service ID</label>
      <input id="service-id" placeholder="my-workspace/my-client-id:bioengine-worker" />
    </div>
    <div class="row">
      <label for="token">Hypha token (optional for public workers)</label>
      <input id="token" type="password" />
    </div>
    <div class="row">
      <button id="connect">Connect</button>
      <span id="status" class="muted">Not connected.</span>
    </div>
  </section>

  <section id="status-section" hidden>
    <h2>Cluster</h2>
    <div class="grid" id="cluster-stats"></div>

    <h2>Deployed apps</h2>
    <div id="apps"></div>
  </section>
</main>

<script>
const $ = (id) => document.getElementById(id);

// Allow URL params: ?service=ws/cid:bioengine-worker&server=...&token=...
const params = new URLSearchParams(location.search);
if (params.get("server"))  $("server-url").value = params.get("server");
if (params.get("service")) $("service-id").value = params.get("service");
if (params.get("token"))   $("token").value      = params.get("token");

let serverConn = null;
let workerSvc  = null;
let refreshTimer = null;

$("connect").addEventListener("click", async () => {
  const serverUrl = $("server-url").value.trim();
  const serviceId = $("service-id").value.trim();
  const token     = $("token").value.trim() || undefined;

  if (!serviceId) { setStatus("Enter a service ID first.", true); return; }
  setStatus("Connecting…", false);
  $("connect").disabled = true;

  try {
    serverConn = await hyphaWebsocketClient.connectToServer({ server_url: serverUrl, token });
    workerSvc  = await serverConn.getService(serviceId);
    setStatus(`Connected to ${serviceId}.`, false);
    $("status-section").hidden = false;
    await refresh();
    refreshTimer = setInterval(refresh, 5000);
  } catch (err) {
    console.error(err);
    setStatus(`Failed: ${err.message || err}`, true);
  } finally {
    $("connect").disabled = false;
  }
});

function setStatus(msg, isError) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = isError ? "#991b1b" : "";
}

async function refresh() {
  try {
    const status = await workerSvc.get_status();
    renderCluster(status);
    renderApps(status);
  } catch (err) {
    console.error(err);
    setStatus(`refresh failed: ${err.message || err}`, true);
  }
}

function renderCluster(s) {
  const c = s.ray_cluster?.cluster || {};
  const card = (label, val) => `<div class="card"><div class="stat">${label}</div><div class="value">${val}</div></div>`;
  const geo = s.geo_location || {};
  $("cluster-stats").innerHTML = [
    card("Mode",       s.worker_mode || "—"),
    card("Ray version", s.ray_version || "—"),
    card("CPUs",       fmt(c.used_cpu) + " / " + fmt(c.total_cpu)),
    card("GPUs",       fmt(c.used_gpu) + " / " + fmt(c.total_gpu)),
    card("Location",   [geo.region, geo.country_name].filter(Boolean).join(", ") || "—"),
    card("Uptime",     fmtUptime(s.service_uptime)),
  ].join("");
}

function fmt(v) { return v == null ? "—" : (Math.round(v * 10) / 10); }
function fmtUptime(sec) {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function renderApps(s) {
  const apps = s.bioengine_apps || {};
  const ids  = Object.keys(apps);
  if (!ids.length) {
    $("apps").innerHTML = `<div class="muted">No apps deployed.</div>`;
    return;
  }
  $("apps").innerHTML = ids.map(id => {
    const a = apps[id];
    const m = a.manifest || {};
    const badgeClass = a.status === "RUNNING" ? "" : a.status === "DEPLOYING" ? "warn" : "err";
    const link = a.static_site_url
      ? `<a href="${a.static_site_url}" target="_blank">Open UI ↗</a>`
      : "";
    return `<div class="card" style="margin:8px 0;">
      <div class="row"><strong>${m.id_emoji || "📦"} ${m.name || id}</strong>
        <span class="badge ${badgeClass}">${a.status || "UNKNOWN"}</span></div>
      <div class="muted" style="margin:4px 0 8px 0;">${m.description || ""}</div>
      <div class="row">${link}</div>
    </div>`;
  }).join("");
}
</script>

</body>
</html>
```

---

## 6. Customisation hooks

The most common changes the agent makes (or asks the user about) before publishing:

- **Facility / lab branding**: `--facility-name`, `--brand-color`, `--brand-color-2`, `<img src=...>` for the logo, `<h1>` text.
- **Pre-fill the worker service ID**: replace the `placeholder=` on `#service-id` with the actual ID so the user does not have to type it. For a fully zero-click dashboard, also remove the inputs and just call `connectToServer + getService` on page load.
- **Token handling**: for a public worker (read-only `authorized_users: ["*"]`), omit the token input entirely and pass no token. For a private worker, accept the token via URL parameter (`?token=...`) — never hard-code a token into the HTML, it would leak via the artifact's public URL.
- **Filter apps**: only show apps whose `manifest.id` is in an allow-list — useful when a facility wants to expose `cellpose-finetuning` and `model-runner` but hide an internal app.
- **Hide admin actions**: by default this template is read-only; add Deploy / Stop / Restart buttons only after gating on the user's identity (`server.config.user.email in allowed_admins`).
- **Auto-refresh interval**: default 5 s; lower for live demos, higher for shared workers to reduce load.

---

## 7. Multi-worker variants (optional)

If the user wants to watch several workers (e.g. a federation across facilities), accept a comma-separated list of service IDs and render one card per worker. The template above already does the heavy lifting per worker; just wrap the connect-and-render block in a `for…of` over the list. Be honest about the cost: each worker is a separate WebSocket connection.

---

## 8. Verifying the dashboard

After `publish_dashboard.py` returns the public URL, verify two things:

1. The URL serves the HTML without auth (or with the right auth if `authorized_users` is restricted).
2. Hitting **Connect** with the actual worker service ID renders cluster stats and any deployed apps.

If the URL 404s, the artifact was created but not committed — re-run with `am.commit(artifact_id)`. If the page renders but stats stay empty, the worker is not registered or the token is wrong.

Return the URL to the user once both checks pass.
