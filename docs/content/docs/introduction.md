---
title: Introduction
description: What desktop is, why it exists, and what ships in the box.
---

**desktop** is a computer-use environment for agents. Most agents live in a chat
box — desktop gives them an entire computer instead: a lightweight Linux desktop
that runs entirely inside Docker (XFCE on Xvfb, served through noVNC), with an
HTTP daemon and a TypeScript SDK so *any* agent can drive it — shell, GUI apps,
browser, keyboard, mouse, screen. Small, fast, disposable.

## Why

Building computer-use agents usually means choosing between bad options:

- **Full VMs** (proprietary sandboxes, cloud browsers) — heavy, slow, locked in.
- **Automating your own machine** — fragile and dangerous; one bad `rm` and it's
  your actual filesystem.
- **API-only agents** — never touch the GUIs where real work actually happens.

`desktop` is the middle path: a real Debian 13 + XFCE + Chromium desktop in a
container capped at **2 CPU / 3 GB**, booted with one command, reset with
`docker compose down`, and driven over **plain HTTP** by anything that can call
an API — Claude, GPT, Gemini, GLM, or a bash script. No vendor lock-in, no
heavyweight runtime, nothing installed on your host but Docker.

## What's in the box

| Piece | What it is | Where |
|---|---|---|
| **Computer image** | Debian 13 + XFCE + Chromium + automation tools in a container | `Dockerfile`, `docker-compose.yml` |
| **Daemon** | Python-stdlib HTTP API over xdotool / ImageMagick / bash on port 8095 | `daemon/daemon.py` |
| **SDK** | Thin TypeScript client: `actions`, `cmd`, `create`, `kill`, `screenshot`, `live`, `frames` | `sdk/` |
| **Viewer** | noVNC browser view of the live desktop on port 6080 | `novnc/` |
| **eve** | A complete operator agent built on this stack, with a Next.js chat UI | `web/` |

## Who it's for

- **Agent builders** who want a safe, resettable environment their model can
  click around in.
- **Tool authors** who want one clean HTTP surface (`POST /api/actions`) instead
  of shelling out to `docker exec`.
- **Humans** who want to watch what the agent is doing — open
  `http://localhost:6080/vnc.html` and see every keystroke in real time.

## Next steps

- [Quickstart](/docs/quickstart) — boot your first computer in ~2 minutes.
- [Architecture](/docs/architecture) — how the pieces fit together.
- [Docker setup](/docs/docker) — compose anatomy, env vars, running several computers.
- [TypeScript SDK](/docs/sdk) — the full client API.
