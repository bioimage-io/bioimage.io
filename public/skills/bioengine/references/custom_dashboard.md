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

### Scope — what to include, what NOT to include

A custom dashboard mirrors the two public pages of the canonical BioEngine UI:

| Include | Equivalent canonical page |
|---|---|
| **Worker discovery** — list available BioEngine workers in the workspace | `https://bioimage.io/#/bioengine` (BioEngineHome) |
| **Worker dashboard** — per-worker view of cluster resources, deployed apps, app frontends | `https://bioimage.io/#/bioengine/worker?service_id=...` (BioEngineWorker) |

Do **not** include:

- **The BioEngine setup wizard** (`https://bioimage.io/#/bioengine/...` with the Docker/SLURM/Kubernetes installer flow). Facility admins use the canonical setup tool or the steps in `worker_onboarding.md` — a per-facility dashboard is not the right place to onboard new workers.
- Anything that asks an end user to install a worker. The dashboard's audience is users of an already-running worker.

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

# The single BioEngine worker this dashboard is for.
# Either a full service ID (workspace/client_id:bioengine-worker), or just the
# workspace/client_id prefix — the published HTML auto-connects to this one.
# Discover via `list_services({"type": "bioengine-worker"})` after the worker is up.
WORKER_SERVICE_ID = os.environ.get("WORKER_SERVICE_ID")  # e.g. "ws-user-google-oauth2|...:bioengine-worker"
if not WORKER_SERVICE_ID:
    raise SystemExit(
        "Set WORKER_SERVICE_ID to the worker's service ID before publishing.\n"
        "Discover it with: hypha_rpc → connect_to_server → list_services({'type':'bioengine-worker'}).\n"
        "If your worker's client_id changes on every restart, use a stable prefix like\n"
        "'<workspace>/bioengine-worker-alm' and rely on Hypha's mode='first' selection."
    )

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

    # Bake the worker service ID into the HTML before upload so the published
    # dashboard auto-connects to this worker — no user input, no URL parameter.
    index_html = (DASHBOARD_DIR / "index.html").read_text()
    if "{{WORKER_SERVICE_ID}}" not in index_html:
        raise SystemExit(
            "dashboard/index.html must contain the placeholder {{WORKER_SERVICE_ID}} "
            "in the <script> block — see section 5."
        )
    (DASHBOARD_DIR / "index.html").write_text(
        index_html.replace("{{WORKER_SERVICE_ID}}", WORKER_SERVICE_ID)
                  .replace("{{SERVER_URL}}", SERVER_URL)
    )

    # Stage the artifact (create or edit an existing one)
    try:
        await am.read(artifact_id)
        artifact = await am.edit(
            artifact_id=artifact_id,
            manifest=MANIFEST,
            stage=True,
            config={
                # Public read on the artifact itself — without this the URL
                # returns 403 even though the BioEngine manifest's
                # authorized_users: ["*"] looks like it should be enough.
                # BioEngine's authorized_users field is a BioEngine concept;
                # the underlying artifact-manager has its own permissions
                # model that has to be set explicitly here.
                "permissions": {"*": "r"},
                "view_config": {
                    "branch": "main",
                    "root_directory": "",
                    "headers": {},
                    "index": "index.html",
                },
            },
        )
        print(f"Editing existing artifact: {artifact_id}")
    except Exception:
        artifact = await am.create(
            type="application",
            alias=ALIAS,
            manifest=MANIFEST,
            stage=True,
            config={
                # Public read on the artifact itself — without this the URL
                # returns 403 even though the BioEngine manifest's
                # authorized_users: ["*"] looks like it should be enough.
                # BioEngine's authorized_users field is a BioEngine concept;
                # the underlying artifact-manager has its own permissions
                # model that has to be set explicitly here.
                "permissions": {"*": "r"},
                "view_config": {
                    "branch": "main",
                    "root_directory": "",
                    "headers": {},
                    "index": "index.html",
                },
            },
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

Save as `dashboard/index.html`. The dashboard is **bound to one BioEngine worker** at publish time — the `{{WORKER_SERVICE_ID}}` and `{{SERVER_URL}}` placeholders are substituted by the publish script in section 4 before upload. The deployed page auto-connects on load: no inputs, no Connect button, no URL parameter required.

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
    .error { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; padding:10px 14px;
             border-radius:8px; margin:16px 0; }
  </style>

  <!-- Hypha RPC client; version matches BioEngine apps' frontend convention -->
  <script src="https://cdn.jsdelivr.net/npm/hypha-rpc@0.21.40/dist/hypha-rpc-websocket.min.js"></script>
</head>
<body>

<header>
  <!-- Replace src with your facility logo, or remove the <img> entirely -->
  <img src="https://bioimage.io/static/img/bioengine-icon.svg" alt="" />
  <div>
    <h1 id="facility-title">My Facility · BioEngine</h1>
    <div style="font-size:13px;opacity:0.9">Powered by BioEngine</div>
  </div>
</header>

<main>
  <section>
    <h2>
      Worker
      <span id="status" class="muted" style="font-weight:normal;font-size:13px;margin-left:8px;">Connecting…</span>
    </h2>
    <div id="cluster-stats" class="grid"></div>

    <h2>Deployed apps</h2>
    <div id="apps"><div class="muted">Loading…</div></div>
  </section>
</main>

<script>
// ───────── Baked at publish time by scripts/publish_dashboard.py ─────────
const SERVER_URL    = "{{SERVER_URL}}";
const WORKER_SVC_ID = "{{WORKER_SERVICE_ID}}";

// Optional admin token via URL parameter only — never hard-code a token in
// the HTML, since the artifact is public-read and the URL would leak it.
// For read-only get_status access, anonymous connection is sufficient.
const params = new URLSearchParams(location.search);
const token  = params.get("token") || undefined;

const $ = (id) => document.getElementById(id);

let serverConn = null;
let workerSvc  = null;

(async () => {
  try {
    serverConn = await hyphaWebsocketClient.connectToServer({ server_url: SERVER_URL, token });
    workerSvc  = await serverConn.getService(WORKER_SVC_ID);
    setStatus(`Connected · ${WORKER_SVC_ID}`, false);
    await refresh();
    setInterval(refresh, 5000);
  } catch (err) {
    console.error(err);
    setStatus(`Failed to connect: ${err.message || err}`, true);
  }
})();

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

- **Facility / lab branding**: edit the CSS custom properties at the top (`--facility-name`, `--brand-color`, `--brand-color-2`), the `<img src=...>` for the logo, and the `<h1>` text.
- **Worker selector**: the `WORKER_SERVICE_ID` constant baked into the HTML can be a full client_id (`ws/<client_id>:bioengine-worker`) or, when the workspace has exactly one worker and the client_id drifts on restart, the shorter `ws/bioengine-worker` form — Hypha resolves to the unique matching client. For multiple workers in the same workspace, use a stable `fullnameOverride` (Kubernetes) or `--client-id` (Docker / SLURM) and bake that.
- **Admin actions**: by default the template is read-only and uses anonymous connection. To add Deploy / Stop / Restart buttons, gate them on the URL-parameter `?token=<admin-token>` and check `server.config.user.email` against an allow-list before showing them. **Never hard-code a token into the HTML** — the artifact is public-read and the URL would leak it.
- **Filter apps**: only show apps whose `manifest.id` is in an allow-list — useful when a facility wants to expose `cellpose-finetuning` and `model-runner` but hide an internal app.
- **Auto-refresh interval**: default 5 s; lower for live demos, higher for shared workers to reduce load.

---

## 7. Discovering the right `WORKER_SERVICE_ID`

If you don't know the worker's exact service ID at publish time:

```python
from hypha_rpc import connect_to_server
s = await connect_to_server({"server_url": "https://hypha.aicell.io",
                             "token": TOKEN, "workspace": WORKSPACE})
workers = [sv["id"] for sv in await s.list_services({"type": "bioengine-worker"})]
print(workers)  # → [".../bioengine-worker-<hash>:bioengine-worker"]
```

For Docker / SLURM-mode workers the client_id is regenerated on every container restart, so the dashboard would break after a worker restart. Two ways to make it stable:

1. **Pin the worker's client_id** at startup via `--client-id bioengine-worker-<facility>` (Docker / SLURM). The published dashboard then targets `<workspace>/bioengine-worker-<facility>:bioengine-worker` and survives restarts.
2. **Use the workspace-only short form** `<workspace>/bioengine-worker` and rely on Hypha's selection mode (defaults to `first` when one match). This works when there is exactly one BioEngine worker registered in the workspace; if a second worker shows up, Hypha will pick one without warning.

---

## 8. Verifying the dashboard

After `publish_dashboard.py` returns the public URL, verify three things:

1. The URL serves the HTML without auth (`curl -sSL <url> | head` should return the page, not `{"detail":"Permission denied"}`). If you see 403, the artifact's `config.permissions` is missing the `{"*": "r"}` entry (section 4 already includes this — but worth checking if the dashboard was published with an older version of the script).
2. The page renders cluster stats and the deployed-apps list within a few seconds of load — no "Connecting…" stuck indefinitely.
3. Stopping the worker and reloading the dashboard shows the connect failure cleanly (a 5xx-style message in the header status), not a blank page or an infinite spinner.

If the URL 404s, the artifact was created but not committed — re-run with `am.commit(artifact_id)`. If the page renders but stats stay empty, the `WORKER_SERVICE_ID` baked into the HTML doesn't resolve — verify it with the discovery snippet in section 7.

Return the URL to the user once all three checks pass.

---

## 9. Known cosmetic issues

- **`total_memory` reports 0 in single-machine Docker mode** on some hosts (other resource fields render correctly). The dashboard's "Memory" card may show `0.0 GB / 0.0 GB` — this is upstream, not a dashboard bug, and `total_gpu` / `total_cpu` are still accurate.
- **`am.create` / `am.edit` return value type varies across `hypha-rpc` versions** — on some versions you get attribute access (`artifact.id`), on others dict access (`artifact["id"]`). The publish script in section 4 reads `artifact_id` (constructed up front from `workspace + ALIAS`) instead of touching the returned object's `id`, sidestepping the issue.
