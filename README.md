# Desktop

<img width="1681" height="1031" alt="image" src="https://github.com/user-attachments/assets/a7186eb8-fce0-4fb5-9ab9-87c14832f80c" />

A lightweight Linux desktop that runs entirely inside Docker. XFCE on Xvfb,
served through noVNC, with an HTTP daemon + TypeScript SDK so agents (eve) can
drive it. Small, fast, disposable.

## Quick start

```bash
docker compose up -d --build
```

Wait for `healthy`, then open **http://localhost:6080/vnc.html** for the desktop.

- 6080 — noVNC desktop · 8095 — HTTP daemon
- `./workspace` persists; `docker compose down && docker compose up -d` resets the rest

## Parts

| Part | What it is | Run it |
|---|---|---|
| **Desktop** | Debian 13 + XFCE + Chromium, capped at 2 CPU / 3 GB | `docker compose up -d --build` |
| **SDK** | TS wrapper over the daemon (`sdk/`) | `cd sdk && npm install && npm run build && node smoke.mjs` |
| **Agent** | eve agent + chat UI + Slack (`web/`) | `cd web && bun install && bun run dev` |

```ts
import { computer } from "computer-use-sdk";
await computer.cmd("pgrep -f xfce4-session");   // shell
await computer.create("xfce4-terminal");         // launch app
await computer.screenshot("state.png");          // → workspace/state.png
await computer.kill("worker-1");
```

API: `cmd`, `create`, `kill`, `screenshot`, `live`, `frames` — details in [`sdk/README.md`](sdk/README.md).

Agent setup (Slack as CEO command interface): [`docs/slack-setup.md`](docs/slack-setup.md)

## Layout

```
├── Dockerfile / docker-compose.yml / entrypoint.sh
├── daemon/daemon.py    # in-container HTTP API (port 8095)
├── sdk/                # TypeScript SDK
├── web/                # Next.js app + eve agent
├── docs/               # slack-setup.md
├── guide.md            # xdotool automation playbook
└── workspace/          # shared, persists between runs
```

## Tips

- Resolution: `RESOLUTION=1600x900` in `docker-compose.yml`
- Chromium is the memory hog — raise `mem_limit` if needed
- `DISPLAY=:99` for manual `docker exec` GUI commands
- `docker compose logs -f` to watch boot (Xvfb → XFCE → x11vnc → websockify)
