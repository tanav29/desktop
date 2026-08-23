---
title: Docker Setup
description: Compose anatomy, lifecycle commands, environment variables, and running multiple computers.
---

Everything runs in Docker — nothing is installed on your host but Docker
itself. This page covers the compose setup, day-to-day commands, and how to run
more than one computer.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
  (Docker Desktop includes both)
- ~3 GB RAM to spare per computer (the container is capped at `mem_limit: 3g`)

## Lifecycle

```bash
docker compose up -d --build   # build + start (first boot builds the image)
docker compose down            # stop and remove container (image kept)
docker compose logs -f         # watch the boot: Xvfb → XFCE → x11vnc → websockify → daemon
docker ps --filter name=linux-desktop
```

First build takes a few minutes; every start after that is seconds. Wait for
`healthy` in `docker ps`, then open <http://localhost:6080/vnc.html>.

## Reset semantics

- `./workspace` on your host **persists** across restarts and rebuilds — it's
  mounted at `/workspace` in the container.
- Everything else (installed packages, desktop state, window layout) is
  disposable:

```bash
docker compose down && docker compose up -d    # fresh computer, same files
```

The container also restarts itself (`restart: unless-stopped`) if any part of
the desktop stack dies — the entrypoint exits on purpose so tini/compose can
bring the whole box back up cleanly.

## What compose sets up

```yaml
services:
  desktop:
    build: .
    container_name: linux-desktop
    ports:
      - "6080:6080"        # noVNC viewer — for humans
      - "8095:8095"        # daemon HTTP API — for agents
    volumes:
      - ./workspace:/workspace   # persists on host
    environment:
      - DISPLAY=:99
      - RESOLUTION=1600x900
      - GH_TOKEN=${GH_TOKEN:-}         # git auth + GitHub API inside
      - GIT_AUTHOR_NAME=${GIT_AUTHOR_NAME:-eve-agent}
      - GIT_AUTHOR_EMAIL=${GIT_AUTHOR_EMAIL:-eve@agent.local}
      - GIT_COMMITTER_NAME=${GIT_COMMITTER_NAME:-eve-agent}
      - GIT_COMMITTER_EMAIL=${GIT_COMMITTER_EMAIL:-eve@agent.local}
    init: true            # tini reaps children — kills are clean
    mem_limit: 3g         # Chromium is the memory hog; raise if needed
    cpus: 2
    restart: unless-stopped
    healthcheck:          # probes /vnc.html AND /api/health
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `RESOLUTION` | `1600x900` | Virtual display size |
| `GH_TOKEN` / `GITHUB_TOKEN` | empty | Git auth + GitHub API calls from inside the container |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | `eve-agent` / `eve@agent.local` | Commit identity |
| `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` | same as author | Commit identity |

Put secrets in a `.env` file next to `docker-compose.yml` (see `.env.example`).

## Run multiple computers

Each computer = one container with its own published daemon port. Copy the
service, change the names and ports:

```yaml
services:
  desktop-1:
    build: .
    container_name: linux-desktop-1
    ports: ["6080:6080", "8095:8095"]
    volumes: ["./workspace-1:/workspace"]
    # ...same env/caps as above

  desktop-2:
    build: .
    container_name: linux-desktop-2
    ports: ["6082:6080", "8096:8095"]
    volumes: ["./workspace-2:/workspace"]
```

From the SDK, the daemon port *is* the computer:

```ts
const comp1 = new Desktop({ port: 8095 });
const comp2 = new Desktop({ port: 8096 });
```

## Verifying health

```bash
curl -sf http://localhost:6080/vnc.html >/dev/null && echo viewer-ok
curl -sf http://localhost:8095/api/health          # {"ok":true} only when X answers
docker exec linux-desktop pgrep -f xfce4-session   # desktop process alive
```

The compose healthcheck requires both the viewer page and the daemon health
endpoint, so a dead desktop fails `docker ps` instead of passing with a static
page.

## Tips

- Chromium is the memory hog — raise `mem_limit` if you see OOM kills.
- Watch first boot with `docker compose logs -f`; you should see the chain
  Xvfb → XFCE → x11vnc → websockify → daemon come up in order.
- For manual GUI poking via `docker exec`, remember `DISPLAY=:99`.
