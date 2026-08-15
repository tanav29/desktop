# Browser Control Guide — Docker Linux Desktop

Everything you need to build an SDK that creates, kills, and controls the
Chromium browser running inside the Docker desktop container.

---

## 1. Architecture at a glance

| Piece | What it is | Where |
|---|---|---|
| Container | Ubuntu 24.04 + XFCE desktop | Docker image `computer-desktop` |
| Display | Xvfb virtual X server on `:99` | inside container |
| VNC | x11vnc on port `5900` | inside container (not exposed) |
| noVNC | websockify + noVNC, **port `6080`** | exposed to host |
| Browser | Chromium (Chrome-for-Testing build) at `/opt/chrome/chrome` | inside container |
| CDP | Chromium DevTools Protocol, **port `9222`** | exposed to host |
| Working dir | `/workspace` (host folder `./workspace` mounted in) | host ↔ container |

Files:

```
computer/
├── Dockerfile          # image definition (XFCE, tools, Chromium, noVNC)
├── docker-compose.yml  # ports 6080 + 9222, /workspace volume, resource caps
├── entrypoint.sh       # starts Xvfb → XFCE → x11vnc → websockify
└── workspace/          # created on first run, persists between restarts
```

Start / stop / status:

```bash
docker compose up -d --build   # build + start
docker compose down            # stop and remove container (image kept)
docker compose logs -f         # watch logs
docker ps --filter name=linux-desktop
```

The desktop is reachable at <http://localhost:6080/vnc.html>.

## 2. How the browser is launched

### 2.1 The desktop browser (the one you see in noVNC)

When you open Chromium from the XFCE menu, it runs the desktop entry written in
the Dockerfile:

```
/opt/chrome/chrome --no-sandbox --disable-dev-shm-usage --no-first-run \
    --remote-debugging-port=9222
```

Flags explained:

| Flag | Why |
|---|---|
| `--no-sandbox` | user namespaces aren't available inside Docker; sandbox would crash |
| `--disable-dev-shm-usage` | container `/dev/shm` is only 64 MB; write to `/tmp` instead |
| `--no-first-run` | skip first-run wizard in the desktop |

Its profile lives at `/root/.config/chromium` — inside the container image, so
it does **not** survive `docker compose down`. Keep data you care about under
`/workspace`.

### 2.2 CDP is always on

`--remote-debugging-port=9222` means the desktop Chromium answers the DevTools
Protocol on `9222`. Because compose maps `9222:9222`, the host can reach it:

```bash
curl -s http://localhost:9222/json/version      # {"Browser":"Chrome/...","webSocketDebuggerUrl":...}
curl -s http://localhost:9222/json/list          # open tabs as JSON
```

> Security note: this exposes **full browser control on localhost** (cookies,
> page content, file reads inside the container). No auth between host and
> container. Fine for a local disposable machine; add a token now that the box
> is exposed to other networks.

## 3. Creating browser instances (your SDK's "create")

Two lifecycles to manage:

### 3.1 The desktop instance (persistent, visible)

```bash
docker exec -d linux-desktop bash -c 'DISPLAY=:99 /opt/chrome/chrome \
  --no-sandbox --disable-dev-shm-usage --no-first-run \
  --remote-debugging-port=9222 \
  --user-data-dir=/workspace/.chromium \
  about:blank'
```

- `DISPLAY=:99` must be set for headed mode.
- `--user-data-dir` stores profile on the persisted volume so it survives
  container recreation.
- Keep the same `--remote-debugging-port` for all instances that share a
  profile — Chromium delegates to the running instance instead of starting a
  second one.

### 3.2 Ephemeral SDK "worker" instances (headless, parallel)

For automation you usually don't want a window on the desktop. One worker per
port + profile:

```bash
docker exec -d linux-desktop bash -c '
  /opt/chrome/chrome --no-sandbox --disable-dev-shm-usage \
    --headless=new \
    --remote-debugging-port=9223 \
    --user-data-dir=/tmp/worker-9223 \
    --no-first-run \
    about:blank'
```

Rules of thumb:

- `--headless=new` = no X server needed, lightest resource use
  (`--headless` old-style works too).
- Ports must be unique per running instance; `9222` belongs to the desktop.
- Each new `--user-data-dir` = fresh clean profile (no cookies/history).
- Headed instances need `DISPLAY=:99`; headless ones don't.
- If you want to *see* a worker in the desktop, drop `--headless=new`.

To expose additional ports to the host, extend the compose `ports:` list
(`9223:9223`, …) or skip host access and talk to `9223` from inside the
container (SDK runs in the container instead of on the host).

### 3.3 Lifecycle from one shell (suggested wrapper)

```bash
# create
docker exec -d linux-desktop bash -c 'DISPLAY=:99 /opt/chrome/chrome \
  --no-sandbox --disable-dev-shm-usage --no-first-run \
  --remote-debugging-port="${1}" --user-data-dir="/tmp/worker-${1}" about:blank' _ 9223
```

An SDK can wrap this in one `docker exec` per instance and keep a
`port → instance` registry.

## 4. Killing browser instances (your SDK's "kill")

```bash
# kill one instance by port (its debugger process holds the port):
docker exec linux-desktop bash -c 'fuser -k 9223/tcp 2>/dev/null; pkill -f "user-data-dir=/tmp/worker-9223"'

# kill every Chromium process (including the desktop one):
docker exec linux-desktop bash -c 'pkill -f "opt/chrome/chrome"'

# nuke everything and restart the whole environment:
docker compose down && docker compose up -d
```

`pkill -f` matches the full command line — that's why instance command lines
carry the port/profile name. PID 1 inside the container is `tini`
(compose `init: true`), which reaps children, so kills are clean.

## 5. Controlling the browser (CDP - your SDK's "control")

Two layers: the HTTP surface (discovery) and the WebSocket surface (driving).

### 5.1 Discovery (HTTP, no libraries)

```bash
curl -s http://localhost:9222/json/version   # browser version + debugger ws url
curl -s http://localhost:9222/json/list      # targets: pages, workers, etc.
```

Create a new tab (200 returns `webSocketDebuggerUrl`):

```bash
curl -s -X PUT 'http://localhost:9222/json/new?about:blank'
```

### 5.2 Drive (WebSocket, any language)

Every target from `/json/list` has a `webSocketDebuggerUrl`. Send
`{"id":1,"method":"Page.navigate","params":{"url":"https://example.com"}}`
and read `{"id":1,"result":...}` replies. Event messages arrive unsolicited
(`Page.loadEventFired`, etc.).

Node (no deps — Node 22 has a global `WebSocket`):

```js
const tab = (await (await fetch('http://localhost:9222/json/list')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: 'https://example.com' } }));
ws.onmessage = (e) => console.log(e.data.slice(0, 120));
```

Python (stdlib only, no `websockets` package):

```python
import json, urllib.request
from websocket import create_connection  # or: pip install websocket-client

targets = json.load(urllib.request.urlopen('http://localhost:9222/json/list'))
ws = create_connection([t for t in targets if t['type'] == 'page'][0]['webSocketDebuggerUrl'])
ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": "https://example.com"}}))
print(ws.recv()[:200])
```

Useful first commands: `Runtime.evaluate`, `Page.captureScreenshot`,
`Page.navigate`, `Emulation.setDeviceMetricsOverride`,
`Browser.close` (kills the instance remotely).

## 6. agent-browser (installed CLI, `v0.28.0`)

`agent-browser` is a native CLI that drives Chrome/Chromium over CDP. It's
installed on the host and works against this container in two ways.

### 6.1 Drive the browser inside the container (mode B — recommended for SDK work)

The container's Chromium already listens on `9222`, so attach directly:

```bash
agent-browser --cdp 9222 open https://example.com   # new tab in the container's browser
agent-browser --cdp 9222 snapshot -i                # accessibility snapshot with @eN refs
agent-browser --cdp 9222 click @e1
agent-browser --cdp 9222 screenshot page.png
```

All agent-browser commands work this way (snapshot, click, fill, eval, tab,
record video…). See `agent-browser skills get core --full` for the full
reference. Pass `--cdp <port>` on every command or export
`AGENT_BROWSER_CDP=9222`. The browser stays alive between commands.

### 6.2 Drive the web page served by noVNC (mode A — end-to-end desktop checks)

http://localhost:6080/vnc.html is a normal web page, so you can automate it
with agent-browser's own Chrome:

```bash
agent-browser open http://localhost:6080/vnc.html
agent-browser snapshot -i
agent-browser screenshot desktop.png
```

Useful to verify the desktop boots and renders, not for day-to-day control.

### 6.3 Running agent-browser inside the container

All control traffic can stay local if you hide `9222` from the host:

```bash
docker exec linux-desktop bash -c 'npm i -g agent-browser && agent-browser install'
docker exec linux-desktop agent-browser --cdp 9222 open https://example.com
```

That's the cleanest isolation model for an SDK: host never touches browser
ports, everything goes through `docker exec`.

## 7. SDK blueprint (from the pieces above)

Minimum viable control plane:

1. **Instance registry** — table of `name → port → user-data-dir → headed?`.
   Ports `9222` (desktop) + `9223+` (workers). Persist it in `/workspace`.
2. **Create** — one `docker exec -d` with the flags from §3; register the port.
3. **Kill** — `pkill -f "user-data-dir=/tmp/worker-<port>"` via §4; unregister.
4. **Control** — hit `http://<host>:<port>/json/*` for discovery, WebSocket
   for commands (raw CDP), or wrap `agent-browser --cdp <port> <cmd>` for a
   higher-level API (snapshots, clicks, screenshots, video).
5. **Wait for ready** — poll `curl -s http://localhost:<port>/json/version`
   until it answers (a few seconds after launch).
6. **Health of the desktop itself** — `curl -sf http://localhost:6080/vnc.html`
   for the environment; `docker exec linux-desktop pgrep -f xfce4-session`
   for the desktop.

Failure modes to expect:

| Symptom | Cause / fix |
|---|---|
| Browser won't start | port already bound by another instance → unique ports |
| `DevToolsActivePort file doesn't exist` | instance already running for that profile → reuse port or new profile |
| Headed instance invisible | missing `DISPLAY=:99` |
| Tab HTTP 404 | debugging port not enabled on that instance |
| Container OOM | Chromium is the heavy process; `mem_limit: 3g` in compose |

## 8. Reference

```bash
# environment
docker compose up -d --build
docker compose down
docker compose logs -f

# desktop health
curl -sI http://localhost:6080/vnc.html
docker exec linux-desktop pgrep -f xfce4-session

# browser health
curl -s http://localhost:9222/json/version

# attached automation (host)
agent-browser --cdp 9222 snapshot -i
agent-browser --cdp 9222 screenshot /workspace/shot.png

# inside-container automation
docker exec -d linux-desktop bash -c 'DISPLAY=:99 /opt/chrome/chrome --no-sandbox --disable-dev-shm-usage --no-first-run --remote-debugging-port=9222 about:blank'
docker exec linux-desktop pkill -f "opt/chrome/chrome"
```