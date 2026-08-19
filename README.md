# Linux Desktop in Docker + TypeScript SDK

A lightweight Linux desktop that runs **entirely inside Docker** and is driven
from your machine — open the desktop in your browser, automate it with
`xdotool` one-liners, or use the tiny TypeScript SDK.

Debian 13 (trixie) + XFCE on Xvfb, served through noVNC, preloaded with
Chromium, a terminal, and a full agent toolchain. Designed to be small, fast,
and disposable.

## Features

- **Everything in a browser** — noVNC at `http://localhost:6080/vnc.html`; no VNC client needed
- **Small image** — Debian slim base, one apt layer with `--no-install-recommends`, docs/man purged, no snap stubs (real Chrome-for-Testing build)
- **Fast** — boots in seconds; Xvfb + XFCE on a slim base instead of a heavyweight install
- **Automatable** — every GUI action is a CLI one-liner (`xdotool`, `import`, `pkill`) over `docker exec`
- **Disposable** — `docker compose down && docker compose up -d` is a factory reset (your `./workspace` files persist)
- **Capped** — 2 CPUs / 3 GB RAM limit in `docker-compose.yml` so it never eats your machine

Included: Chromium, xfce4-terminal, xdotool, ImageMagick (`import`/`convert`),
git, curl, ripgrep, nano, python3 (minimal). Slim by design — no ffmpeg, gh, or
build-essential; run `apt-get install -y --no-install-recommends build-essential`
(etc.) from inside the container if a task needs them.

## Requirements

- **Docker** with the Compose plugin (Docker Desktop works on Windows/macOS; `docker compose version` must succeed)
- **Node.js 18+** — only needed for the SDK part
- ~1.3 GB free disk for the image (image is ~1.1 GB on disk, ~0.3 GB when pulled)

## 1 · Try the desktop (image only)

```bash
docker compose up -d --build
```

First build takes a few minutes (installs packages + downloads Chromium); later
builds are cached. Wait until it's healthy:

```bash
docker compose ps          # STATUS should become "healthy"
```

Then open **http://localhost:6080/vnc.html** in your browser. You get the
remote desktop directly — a full XFCE desktop with a panel, whisker menu and
desktop icons; terminals via the menu.

Sanity-check the automation from your terminal:

```bash
# screenshot the desktop → lands in ./workspace/shot.png on your machine
docker exec linux-desktop import -window root /workspace/shot.png

# open a terminal window on the desktop
docker exec -d linux-desktop bash -c 'DISPLAY=:99 xfce4-terminal --title=Demo'

# focus it and type into it
docker exec linux-desktop bash -c 'wid=$(xdotool search --onlyvisible --name Demo | head -1); xdotool windowactivate --sync "$wid"; xdotool type "echo hello from docker"; xdotool key Return'

# browse in Chromium
docker exec -d linux-desktop bash -c 'DISPLAY=:99 /opt/chrome/chrome --no-sandbox --disable-dev-shm-usage --no-first-run https://example.com'
```

Stop / restart:

```bash
docker compose down        # stop (image kept, ./workspace kept)
docker compose up -d       # start again instantly
docker compose logs -f     # entrypoint log (Xvfb → XFCE → x11vnc → websockify)
```

## 2 · Try the SDK

The SDK in `sdk/` is a thin TypeScript wrapper around the in-container HTTP
daemon (`daemon/daemon.py`, published on port 8095). Pick a computer by its
port — `new Desktop({ port: 8095 })` is computer #1, `8096` is #2, etc. No
`docker exec` in the hot path: every call is one HTTP round-trip to a process
that is already running.

```bash
cd sdk
npm install
npm run build
node smoke.mjs
```

`smoke.mjs` drives a real end-to-end cycle and writes before/after screenshots
to `workspace/`: launch terminal → focus → type → screenshot → kill → screenshot.

Your own script:

```ts
import { Desktop, computer } from "computer-use-sdk";
// computer = new Desktop() — computer #1 (daemon on port 8095); the
// second computer in your compose file is new Desktop({ port: 8096 })

const d = computer;

await d.cmd("pgrep -f xfce4-session");                  // desktop health
await d.create("xfce4-terminal", { title: "worker-1" });  // launch an app

// focus → type → screenshot → kill, all via the daemon
await d.cmd(
  'wid=$(xdotool search --onlyvisible --name worker-1 | head -1); ' +
  'xdotool windowactivate --sync "$wid"; ' +
  'xdotool type --delay 40 "ls -la"; xdotool key Return'
);
await d.screenshot("state.png");                       // → workspace/state.png
await d.kill("worker-1");
```

API (see [`sdk/README.md`](sdk/README.md) for details):

| Method | What it does |
|---|---|
| `cmd(input)` | run any shell command inside the computer, return stdout |
| `create(command, {title})` | launch a detached app with a unique title (terminal `--title`, chromium `--user-data-dir`) |
| `kill(title)` | kill by process command line **and** window title |
| `screenshot(name?)` | capture desktop PNG into the shared `./workspace` |
| `live({port?,fps?,quality?})` | MJPEG stream of the desktop over HTTP (browser viewer at `http://localhost:8090/`, raw stream at `/feed`) |
| `frames({fps?,quality?})` | async generator of JPEG Buffers — a live feed for agents |

## 3 · The agent (eve + Slack)

The `web/` directory is a Next.js app with an [eve](https://eve.sh) agent that
operates the desktop autonomously. It has 15+ tools for desktop control (click,
type, screenshot, inspect), file operations, and code work (clone, commit, PR).

### Web UI (chat + live desktop)

```bash
cd web
bun install
bun run dev    # http://localhost:3000 — chat on the left, live desktop on the right
```

### Slack (CEO command interface)

Connect the agent to Slack so the CEO can @mention it in any channel:

```
@eve fix the login bug on github.com/myorg/api and open a PR
```

The agent clones the repo, makes the fix on the desktop, commits, pushes,
opens a PR, and posts the summary + recording back to the Slack thread.

Full setup: [`docs/slack-setup.md`](docs/slack-setup.md)

Quick start:
```bash
cp .env.example .env
# Fill in SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, GH_TOKEN
docker compose up -d --build
cd web && bun install && bun run dev
# Expose port 3000 publicly (ngrok/cloudflared) for Slack webhooks
```

## Project layout

```
desktop/
├── Dockerfile          # Debian 13 slim + XFCE + Xvfb + noVNC + Chromium + slim toolchain
├── docker-compose.yml  # port 6080 + 8095, ./workspace mount, 2 CPU / 3 GB caps, healthcheck
├── .env.example        # GitHub + Slack + AI model env vars
├── entrypoint.sh       # starts Xvfb → XFCE → x11vnc → websockify → HTTP API daemon
├── daemon/
│   └── daemon.py       # in-container HTTP API (COPY'd into the image, port 8095)
├── guide.md            # full xdotool automation reference (keyboard/mouse/windows)
├── docs/
│   └── slack-setup.md  # how to wire up Slack as the CEO's command interface
├── workspace/          # shared folder: screenshots, recordings, files (persists between runs)
├── sdk/
│   ├── src/index.ts    # wrapper over the daemon (Desktop class; pick computer by port)
│   ├── smoke.mjs       # end-to-end demo against a running computer
│   ├── live.mjs        # `node live.mjs` → desktop live view in the browser
│   └── README.md       # SDK usage guide
├── web/                # Next.js app + eve agent
│   ├── agent/
│   │   ├── agent.ts           # defineAgent (model config)
│   │   ├── instructions.md     # agent system prompt (desktop operator)
│   │   ├── channels/
│   │   │   └── slack.ts       # Slack channel (@mention → agent run)
│   │   ├── hooks/
│   │   │   └── recording.ts   # captures desktop frames → video → Slack
│   │   └── tools/
│   │       ├── cmd.ts, inspect_desktop.ts, screenshot.ts, observe.ts
│   │       ├── type_text.ts, key.ts, mouse.ts, click.ts
│   │       ├── create_app.ts, kill_app.ts, sleep.ts
│   │       ├── git_clone.ts   # clone a repo into the desktop
│   │       └── git_commit.ts  # branch + commit changes
│   ├── app/                   # Next.js pages (chat UI + desktop view)
│   ├── lib/                   # config, computer instance, feed helpers
│   └── package.json
└── README.md
```

## Tips

- **Resolution** — change `RESOLUTION=1600x900` in `docker-compose.yml` before `up`.
- **Memory** — the container is capped at 3 GB; Chromium is the hungry one. Raise `mem_limit` if you open many tabs.
- **Windows (Docker Desktop)** — everything above works as-is; `./workspace` mounts transparently.
- **Reset everything** — `docker compose down && docker compose up -d`; for a clean rebuild add `--build --force-recreate`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker compose ps` stuck on "starting" | first build is slow (Chromium download); wait, or `docker compose logs -f` |
| 6080 refused / VNC won't load | container still booting; `docker compose ps` must show `healthy` |
| Port 6080 already in use | another service owns it — change the port mapping in `docker-compose.yml` |
| Screenshots come out empty/black | desktop not ready yet; wait for `healthy` and retry |
| `Can't open display` | your `docker exec` lost env — write `DISPLAY=:99` explicitly |
| Container OOM-killed | Chromium > 3 GB — raise `mem_limit` in compose |

More depth: the complete automation playbook (keyboard, mouse, windows,
screenshots, worker patterns, failure modes) is in [`guide.md`](guide.md).