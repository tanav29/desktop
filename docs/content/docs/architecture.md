---
title: Architecture
description: How the image, daemon, and SDK fit together — and why every call is one round-trip.
---

```
┌──────────────────── your machine ────────────────────┐
│                                                      │
│   web UI (Next.js) ────── eve agent                  │
│     (chat + live        (tools + loop)               │
│      desktop pane)                                   │
│                           │                          │
│                    computer-use-sdk                  │
│                           │ HTTP                     │
│                           ▼                          │
│   ┌──────────── Docker container ─────────────┐      │
│   │  daemon :8095   every call = 1 round-trip │      │
│   │    │                                      │      │
│   │  XFCE on Xvfb :99  ·  xdotool             │      │
│   │  x11vnc → websockify → noVNC :6080        │      │
│   │  Chromium · xfce4-terminal · ImageMagick  │      │
│   └───────────────────────────────────────────┘      │
│                           │                          │
│              ./workspace persists on host            │
└──────────────────────────────────────────────────────┘
```

## Three layers, each replaceable

| Layer | What it does | Swap it with |
|---|---|---|
| **Container** | Real GUI desktop: Xvfb → XFCE → x11vnc → noVNC | Any X11 desktop |
| **Daemon** | Python-stdlib HTTP API over xdotool/ImageMagick/bash — shell quoting and process cleanup handled for you | Anything that speaks HTTP |
| **SDK** | Thin TS client: `actions`, `cmd`, `create`, `kill`, `screenshot`, `live`, `frames` | Raw `fetch()` calls |

## Ports

| Port | Surface |
|---|---|
| `6080` | noVNC viewer (`/vnc.html`) — watch the desktop in a browser |
| `8095` | daemon HTTP API — the control plane agents call |
| `5900` | x11vnc inside the container (not exposed) |
| `8090` | SDK `live()` MJPEG stream, served from your host process |

## Why it's fast

Every control surface is one HTTP round-trip to a process that is already
running *inside* the container. Calls cost milliseconds — versus ~150 ms+ for
spawning `docker exec` per action.

The biggest win is batching: [`POST /api/actions`](/docs/daemon#post-api-actions)
runs a whole input sequence (wait for window → focus → key → paste → key) in one
request. When the caller is a language model paying a turn of context per call,
one request per *task* instead of one per keystroke matters more than any other
optimization.

## One computer = one port

Each computer runs its own daemon. In `docker-compose.yml` each one publishes a
distinct host port for it (8095, 8096, …). That port is the computer's identity
from the SDK's point of view:

```ts
import { Desktop } from "computer-use-sdk";

const comp1 = new Desktop();               // port 8095 — computer #1
const comp2 = new Desktop({ port: 8096 }); // computer #2
```

Run several containers side by side and address them independently — see
[running multiple computers](/docs/docker#run-multiple-computers).

## Persistence model

- `/workspace` inside the container is mounted from `./workspace` on your host.
  It survives restarts, resets, rebuilds.
- Everything else — desktop state, installed packages, window layout — is
  ephemeral. `docker compose down` is your reset button.
