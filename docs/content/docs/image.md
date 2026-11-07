---
title: The Computer Image
description: What's inside the Docker image — desktop, tools, resources, and configuration.
---

The computer is a Docker image (`computer-desktop`, built from the repo's
`Dockerfile`): a real Debian 13 (trixie) desktop, small enough to boot in
seconds and capped at 2 CPU / 3 GB RAM.

## The desktop stack

The entrypoint (`entrypoint.sh`) starts the pieces in order:

```
Xvfb :99  →  XFCE session  →  x11vnc :5900  →  websockify/noVNC :6080  →  daemon :8095
```

| Piece | Role |
|---|---|
| **Xvfb** on `:99` | Virtual X server — no display hardware needed |
| **XFCE** | Lightweight, fully normal desktop environment |
| **x11vnc** | Exposes the X display over VNC (container-internal) |
| **websockify + noVNC** | Streams it to your browser at `http://localhost:6080/vnc.html` |
| **daemon** | HTTP control plane on `:8095` — see [Daemon API](/docs/daemon) |

## Preinstalled toolchain

Everything an agent needs to do real work:

| Category | Tools |
|---|---|
| Languages | Python 3 |
| Editor / shell | `nano`, `bash` (terminal app: xterm) |
| VCS | `git` |
| Network | `curl`, `ca-certificates` |
| Search | `ripgrep` |
| Images | ImageMagick — `import` (screenshots), `convert` |
| X11 control | `xdotool`, xvfb, x11vnc |
| Clipboard | `xclip` |
| Browser | Debian Chromium, launched with the `chromium` wrapper |

Build tools are **not** preinstalled (kept out for size). Install on demand:

```bash
apt-get install -y --no-install-recommends build-essential
```

No `node`/`npm` either. If a task needs them:

```bash
docker exec -d linux-desktop bash -c 'apt-get update && apt-get install -y --no-install-recommends nodejs npm'
```

## Files and persistence

- `/workspace` inside the container is mounted from `./workspace` on your host.
- Screenshots written to `/workspace` land directly on your host disk.
- SDK worker logs live under `/workspace/.workers/<title>/console.log`.
- Everything outside `/workspace` is ephemeral — reset with
  `docker compose down && docker compose up -d`.

## Configuration

Set these in `docker-compose.yml` (or your shell env):

| Variable | Default | Purpose |
|---|---|---|
| `RESOLUTION` | `1600x900` | Virtual display geometry |
| `DISPLAY` | `:99` | X display used by everything GUI |
| `API_PORT` | `8095` | Daemon port inside the container |
| `GH_TOKEN` / `GITHUB_TOKEN` | empty | Git auth + GitHub API calls from inside |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | `eve-agent` / `eve@agent.local` | Commit identity for agent-made commits |
| `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` | same as author | Same |

## Resources and health

```yaml
mem_limit: 3g        # Chromium is the memory hog — raise if needed
cpus: 2
restart: unless-stopped
healthcheck:         # probes BOTH the viewer page and /api/health,
  interval: 30s      # so a dead desktop fails instead of faking healthy
```

Check health yourself:

```bash
curl -sf http://localhost:8095/api/health   # {"ok": true} only when the X display answers
docker exec linux-desktop pgrep -f xfce4-session   # desktop process alive
```

More operational detail in [Docker setup](/docs/docker).
