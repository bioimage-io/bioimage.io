# Public dev server for the quick-river worktree — 2026-10-24

Purpose: give Nils a live URL to see and click the changes this session makes, and give this
session a place to do UI validation before calling anything done.

| | |
|---|---|
| Public URL | https://tl-quick-river-dev-81f52732.hypha.run |
| Tunnel | `myco expose 3042 --name quick-river-dev --public`; pinned via `myco session link add` |
| CRA dev server | 127.0.0.1:3041 |
| Identity proxy | 127.0.0.1:3042 (what the tunnel points at) |
| Start / restart | `.dev/start-dev.sh` — idempotent, skips a port already listening |
| Logs | `/tmp/quick-river-dev/dev.log`, `/tmp/quick-river-dev/proxy.log` |
| UI check | `node .dev/check-live.mjs <url> [route ...]` |

`.dev/` is gitignored, so none of this is committable. `node_modules` is a symlink to the
shared install at `/data/nmechtel/bioimage.io/node_modules`, same as brave-forest-2.

## Validation actually run (not inferred)

- `.dev/proxy.mjs` strips the encoding: direct :3041 returns `Content-Encoding: br`, via :3042
  the header is absent and the body is plain HTML (6201 B).
- Headless Chromium, 1440x900, service workers blocked, against the **tunnel**:
  `/` 621 `#root` nodes, `/#/models` 621, `/#/bioengine` 467, `/#/upload` 127. All PASS.
- Hot reload over the tunnel: `wss://tl-quick-river-dev-81f52732.hypha.run/ws` opens, and
  `touch src/App.tsx` pushed `{"type":"invalid"}` → `{"type":"hash"}` → `{"type":"hot"}` →
  `{"type":"liveReload"}` to the browser.
- Only remaining console error on a healthy page: 404 for
  `https://cdn.matomo.cloud/bioimage.matomo.cloud/matomo.js` (third-party analytics, not ours).
- `webpack compiled with 7 warnings` (pre-existing eqeqeq / array-callback-return lint), `No
  issues found` from the TS checker plugin.

## Three traps, all hit for real while setting this up

1. **The identity proxy is mandatory.** Without it the tunnel serves undeclared brotli and the
   page is binary garbage with ZERO console errors and a 200 with a plausible content-length.
   curl cannot detect this. Assert on DOM node count in a browser.
2. **`WDS_SOCKET_HOST` must be `0.0.0.0`, with `WDS_SOCKET_PORT=0`.** I first set the literal
   tunnel hostname; CRA 5 has no `WDS_SOCKET_PROTOCOL`, so the client dialled `ws://` from an
   https page, and the Mixed Content `SecurityError` thrown by the `WebSocket` constructor
   aborted the whole React render — `#root` 621 nodes → 0, with one console line as the only
   clue. The in-addr-any value makes webpack-dev-server adopt the page's own origin and
   upgrade to `wss:`, which works for 127.0.0.1 and the tunnel simultaneously.
3. **Killing the dev server alone does nothing** — the restart loop brings it straight back,
   and an orphaned react-scripts then holds :3041 while the new loop fails on "Something is
   already running". Kill the loop in `/tmp/quick-river-dev/dev-loop.sh` FIRST, then the
   server by its port's PID. Never `pkill -f` a pattern naming the script. The loop now has a
   port guard so a stuck port makes it wait instead of spinning.

Ports 3005, 3012, 3021, 3031, 3050, 3051 belong to other worktrees. `myco expose` does not
claim a port exclusively, so never reuse one that merely looks idle.
