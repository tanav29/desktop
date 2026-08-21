# desktop — a computer-use environment for agents

<img width="1681" height="1031" alt="image" src="https://github.com/user-attachments/assets/a7186eb8-fce0-4fb5-9ab9-87c14832f80c" />

Most agents live in a chat box. **desktop** gives them an entire computer
instead: a lightweight Linux desktop that runs entirely inside Docker —
XFCE on Xvfb, served through noVNC — with an HTTP daemon + TypeScript SDK
so *any* agent can drive it: shell, GUI apps, browser, keyboard, mouse,
screen. Small, fast, disposable.

An agent, **eve**, ships in this repo as the proof. Give her a task in the
web UI or @mention her in Slack, then watch the desktop live in your browser
while she works — every click, keystroke and window visible in real time.

> 🎬 Demo video: _[add l ink]_ · Jump to [Architecture](#architecture) or
> [Quick start](#quick-start)

## Why

Building computer-use agents means choosing between bad options:

- **Full VMs** (proprietary sandboxes, cloud browsers) — heavy, slow, locked in.
- **Automating your own machine** — fragile and dangerous; one bad `rm` and it's your actual filesystem.
- **API-only agents** — never touch the GUIs where real work actually happens.

`desktop` is the middle path: a real Debian 13 + XFCE + Chromium desktop in a
container capped at **2 CPU / 3 GB**, booted with one command, reset with
`docker compose down`, and driven over **plain HTTP** by anything that can
call an API — Claude, GPT, Gemini, GLM, or a bash script. No vendor lock-in,
no heavyweight runtime, nothing installed on your host but Docker.

## Architecture

```
┌──────────────────── your machine ────────────────────┐
│                                                      │
│   web UI (Next.js) ────── eve agent ────── Slack     │
│     (chat + live      (tools + loop)   (@mention =   │
│      desktop pane)                      a work order)│
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

Three layers, each replaceable:

| Layer | What it does | Swap it with |
|---|---|---|
| **Container** | Real GUI desktop: Xvfb → XFCE → x11vnc → noVNC | Any X11 desktop |
| **Daemon** (`daemon/daemon.py`) | Python-stdlib HTTP API over xdotool/ImageMagick/bash — shell quoting and process cleanup handled for you | Anything that speaks HTTP |
| **SDK** (`sdk/`) | Thin TS client: `cmd`, `create`, `kill`, `screenshot`, `live`, `frames` | Raw `fetch()` calls |

Because every control surface is one HTTP round-trip to a process already
inside the container, calls cost milliseconds — versus ~150 ms+ for spawning
`docker exec` per action. And each computer is just a port: run several
containers on 8095, 8096, … and the SDK addresses them independently.

## Quick start

```bash
docker compose up -d --build
```

Wait for `healthy`, then open **http://localhost:6080/vnc.html** for the desktop.

- 6080 — noVNC desktop · 8095 — HTTP daemon
- `./workspace` persists; `docker compose down && docker compose up -d` resets the rest

## Drive it from code

```bash
cd sdk && npm install && npm run build && node smoke.mjs
```

```ts
import { computer } from "computer-use-sdk";

await computer.cmd("pgrep -f xfce4-session");     // shell — the escape hatch
await computer.create("chromium https://example.com", { title: "web-1" });
await computer.screenshot("state.png");            // → workspace/state.png
const feed = await computer.live();                // MJPEG stream, humans + agents
for await (const frame of computer.frames({ fps: 4 })) { /* vision input */ }
await computer.kill("web-1");
```

Full API in [`sdk/README.md`](sdk/README.md).

## eve — the agent that proves it

[`web/`](web/) contains a complete operator agent built on this stack:

- **19 tools**: `type_text`, `key`, `mouse`, `click`, `create_app`, `kill_app`,
  `inspect_desktop`, `observe`, `screenshot`, `git_clone`, `git_commit`, … plus
  `cmd` as the escape hatch for anything else.
- **Works without vision**: `inspect_desktop` reads window/focus/pointer state
  as text, so text-only models stay effective; point `AI_MODEL` at any
  vision-capable model and `observe()` adds real screen pixels.
- **Watchable by design**: the web UI shows the live desktop next to the chat;
  a recording hook captures frames through the whole session.
- **Slack as the command line**: @mention eve in a channel →

  ```
  @eve fix the login bug on github.com/me/myrepo
    → clone → reproduce → fix → test → commit → open PR
    → summary + PR link + session recording posted back to the thread
  ```

  While she works, a **live progress feed** streams every action into the
  thread — tool calls as they happen, plus periodic desktop screenshots —
  so the CEO watches the job get done without leaving Slack.

- **No-yaml setup**: click **slack** in the app header, paste a bot token +
  signing secret, done — credentials are verified against Slack before
  saving and apply instantly (env vars still work for headless setups).

Setup: [`docs/slack-setup.md`](docs/slack-setup.md)

## Layout

```
├── Dockerfile / docker-compose.yml / entrypoint.sh
├── daemon/daemon.py    # in-container HTTP API (port 8095)
├── sdk/                # TypeScript SDK (computer-use-sdk)
├── web/                # Next.js app + eve agent + Slack channel
├── docs/slack-setup.md # Slack integration guide
├── guide.md            # xdotool automation playbook
└── workspace/          # shared with the container, persists between runs
```

## Tips

- Resolution: `RESOLUTION=1600x900` in `docker-compose.yml`
- Chromium is the memory hog — raise `mem_limit` if needed
- `DISPLAY=:99` for manual `docker exec` GUI commands
- `docker compose logs -f` to watch boot (Xvfb → XFCE → x11vnc → websockify)
