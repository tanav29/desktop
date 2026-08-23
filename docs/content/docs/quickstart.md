---
title: Quickstart
description: Boot a computer, open it in your browser, and drive it from the SDK.
---

Get a disposable Linux computer running on your machine, then drive it from
code. Total time: about two minutes.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Docker Desktop works fine)
- Node.js 18+ — only if you want to use the TypeScript SDK

## 1. Boot the computer

Clone the repository and start the container from its root:

```bash
git clone https://github.com/tanav29/desktop && cd desktop
docker compose up -d --build
```

This builds the image (`computer-desktop`) and starts one container named
`linux-desktop`. Wait for it to become `healthy`:

```bash
docker ps --filter name=linux-desktop
```

## 2. Verify and look at it

The daemon answers on port **8095**, the desktop viewer on port **6080**:

```bash
curl http://localhost:8095/api/health   # -> {"ok": true, "display": ":99"}
```

Open **http://localhost:6080/vnc.html** in your browser for the live desktop.

| Port | What |
|---|---|
| `6080` | noVNC viewer — the desktop, for humans |
| `8095` | HTTP daemon — the control plane, for agents |

## 3. Drive it from the SDK

```bash
cd sdk && npm install && npm run build && node smoke.mjs
```

Or write your own script:

```ts
import { computer } from "computer-use-sdk";

// shell — the escape hatch
await computer.cmd("pgrep -f xfce4-session");

// launch an app with a unique title
await computer.create("chromium https://example.com", { title: "web-1" });

// a whole input sequence in ONE round-trip
await computer.actions([
  { do: "wait_for", window: "Chromium", timeoutMs: 45_000 },
  { do: "focus",    window: "Chromium" },
  { do: "key",      keys: "ctrl+l" },
  { do: "paste",    text: "https://news.ycombinator.com" },
  { do: "key",      keys: "Return" },
]);

await computer.screenshot("state.png"); // -> workspace/state.png on your host
await computer.kill("web-1");
```

## 4. Watch it live

```ts
const feed = await computer.live(); // MJPEG stream on http://localhost:8090
for await (const frame of computer.frames({ fps: 4 })) {
  // JPEG buffers — feed them to a vision model
}
await feed.stop();
```

## Reset

Everything except `./workspace` is disposable:

```bash
docker compose down && docker compose up -d
```

Files you drop into `/workspace` inside the container persist on your host
under `./workspace`.

## Where to next

- [Docker setup](/docs/docker) — ports, env vars, resources, multiple computers.
- [TypeScript SDK](/docs/sdk) — every method explained.
- [Daemon API](/docs/daemon) — talk to the computer over raw HTTP.
