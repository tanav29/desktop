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
- Enough Docker memory for your workload (the default per-desktop cap is 3 GB)

## Lifecycle

```bash
docker compose up -d --build   # build + start (first boot builds the image)
docker compose down            # stop and remove container (image kept)
docker compose logs -f         # watch the boot: Xvfb → XFCE → x11vnc → websockify → daemon
docker compose ps
```

First build takes a few minutes; every start after that is seconds. Wait for
`healthy` in `docker compose ps`, then open <http://localhost:6080/vnc.html>.

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

## Configure a desktop

Set these environment variables before `docker compose up -d --build`, or put
them in a `.env` file beside `docker-compose.yml` (see `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `DESKTOP_NAME` | `default` | Name reported to the agent; use a unique name per desktop |
| `DESKTOP_MEMORY_LIMIT` | `3g` | Maximum container memory, for example `4g` or `2048m` |
| `DESKTOP_CPUS` | `2` | Maximum CPU time in cores; fractional values such as `1.5` are allowed |
| `DESKTOP_API_PORT` | `8095` | Host port for the daemon |
| `DESKTOP_VNC_PORT` | `6080` | Host port for the viewer |
| `DESKTOP_WORKSPACE` | `./workspace` | Host directory mounted at `/workspace` |
| `GH_TOKEN` | empty | Git auth and GitHub API access inside the container |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | `eve-agent` / `eve@agent.local` | Commit identity |
| `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` | same as author | Commit identity |

The memory setting is a cap, not an allocation or a guarantee. Total host RAM
is determined by the machine and, with Docker Desktop, its configured resource
limits. Choose caps that fit the available Docker resources; running several
desktops requires enough resources for their combined workload. Use
`docker compose ps` and `docker stats` to inspect running containers.

To change a desktop's settings, update the environment and run `docker compose
up -d` again with the same project name. Compose recreates the container when
its configuration changes; files in the mounted workspace persist.

## Run multiple computers

Give each desktop a unique name, Compose project, ports, and workspace. For
example, in PowerShell:

```powershell
$env:DESKTOP_NAME = "research"
$env:DESKTOP_MEMORY_LIMIT = "3g"
$env:DESKTOP_CPUS = "2"
$env:DESKTOP_API_PORT = "8095"
$env:DESKTOP_VNC_PORT = "6080"
$env:DESKTOP_WORKSPACE = "./workspace-research"
docker compose -p research up -d --build

$env:DESKTOP_NAME = "coding"
$env:DESKTOP_MEMORY_LIMIT = "4g"
$env:DESKTOP_CPUS = "1.5"
$env:DESKTOP_API_PORT = "8096"
$env:DESKTOP_VNC_PORT = "6081"
$env:DESKTOP_WORKSPACE = "./workspace-coding"
docker compose -p coding up -d --build
```

Tell the agent the desktop name. The web app discovers local daemon ports
8095?8099 by default; configure `COMPUTER_DISCOVERY_PORTS` in the web app for
other ports. The web viewer, recording, and share tools still use the default
desktop. The SDK can target a desktop directly by its API port:

```ts
const research = new Desktop({ port: 8095 });
const coding = new Desktop({ port: 8096 });
```

## Verifying health

```bash
curl -sf http://localhost:6080/vnc.html >/dev/null && echo viewer-ok
curl -sf http://localhost:8095/api/health          # {"ok":true} only when X answers
docker compose exec desktop pgrep -f xfce4-session   # desktop process alive
```

The compose healthcheck requires both the viewer page and the daemon health
endpoint, so a dead desktop fails `docker ps` instead of passing with a static
page.

## Tips

- Chromium is the memory hog — raise `DESKTOP_MEMORY_LIMIT` if you see OOM kills.
- Watch first boot with `docker compose logs -f`; you should see the chain
  Xvfb → XFCE → x11vnc → websockify → daemon come up in order.
- For manual GUI poking via `docker exec`, remember `DISPLAY=:99`.
