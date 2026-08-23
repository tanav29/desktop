---
title: Troubleshooting
description: Failure modes, health checks, and how to reset when things go sideways.
---

## Health checks first

```bash
curl -sf http://localhost:6080/vnc.html >/dev/null && echo viewer-ok
curl -sf http://localhost:8095/api/health          # {"ok":true} only when the X display answers
docker exec linux-desktop pgrep -f xfce4-session   # desktop process alive
docker compose logs -f                             # boot chain: Xvfb → XFCE → x11vnc → websockify → daemon
```

`/api/health` probes the real display with `xdpyinfo` — if it says 503, the
desktop is genuinely down, not just unobservable.

## Failure modes

| Symptom | Cause / fix |
|---|---|
| Typing goes nowhere | Window not focused → `windowactivate --sync` first, or `wait_for` + `focus` in an actions batch |
| `windowkill` kills the wrong thing | Title too generic → make titles unique per worker |
| App invisible on screen | Missing `DISPLAY=:99`, or minimized → `windowactivate`; check with `search --onlyvisible` |
| Nothing on screen at all | Xvfb crashed → `docker compose logs -f`; container should auto-restart (`restart: unless-stopped`) |
| `Can't open display` | Env lost in your shell → pass `DISPLAY=:99` explicitly |
| Container OOM / Chromium dies | Memory cap hit → raise `mem_limit` (default 3g) in `docker-compose.yml` |
| Daemon unreachable from SDK | Wrong port → `Desktop({ port })` must match the published host port; check `docker ps` |
| Healthcheck never passes | One of the two probes failing — test both URLs above manually |
| Actions fail at step N | Read `failedAt` + `steps[N].note` in the response — it names the exact step and reason |

## Debugging actions

Every failed batch tells you where and why it stopped, plus the state at that
moment:

```json
{"ok": false, "failedAt": 3,
 "steps": [{"i": 0, "do": "focus", "ok": true}, "...",
           {"i": 3, "do": "click", "ok": false, "note": "..."}],
 "state": {"pointer": [812, 61], "focused": "Chromium"}}
```

Pair this with a screenshot for full context:

```ts
const r = await computer.actions(myBatch);
if (!r.ok) {
  await computer.screenshot(`fail-${Date.now()}.png`);
}
```

## The nuclear option

The whole box is disposable — that's the point:

```bash
docker compose down && docker compose up -d
```

Fresh desktop, same files: everything in `/workspace` survives because it's
mounted from `./workspace` on your host.

If the image itself is broken, rebuild from scratch:

```bash
docker compose down --rmi local && docker compose up -d --build
```

## Still stuck

- Watch the boot log end to end: `docker compose logs -f`
- Inspect inside: `docker exec -it linux-desktop bash` (remember `DISPLAY=:99`
  for anything GUI)
- The [automation playbook](/docs/automation) covers the reliable patterns
  (verify-before-type, unique titles, batching) that prevent most issues.
