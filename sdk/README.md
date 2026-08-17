# computer-use-sdk

Thin TypeScript wrapper around the in-container HTTP daemon
(`daemon/daemon.py`). The SDK never touches docker — every call is one
HTTP round-trip to a process that is already running, so `cmd()` etc. cost a
few ms of overhead instead of a `docker exec` CLI spawn (~150 ms+).

```bash
npm install
npm run build
```

The daemon ships inside the image; make sure it is running:

```bash
cd .. && docker compose up -d --build
# then:  curl http://localhost:8095/api/health  -> {"ok": true, ...}
```

## Pick a computer by port

Every computer runs its own daemon. In `docker-compose.yml` each one publishes
a distinct host port for it (8095, 8096, ...). That port is the computer's id
from the SDK's point of view:

```ts
import { Desktop } from "computer-use-sdk";

const comp1 = new Desktop();               // port 8095 — computer #1
const comp2 = new Desktop({ port: 8096 }); // computer #2
```

`host` defaults to `localhost`; `workspace` (default `./workspace`) is the host
path of that computer's mounted folder, used for the return value of
`screenshot()`. `Desktop.baseUrl` shows where calls go.

## Usage

```ts
import { computer } from "computer-use-sdk";

// 1. cmd — anything inside the computer (bash -c). The escape hatch.
await computer.cmd("pgrep -f xfce4-session");             // desktop health
await computer.cmd("xdotool getactivewindow getwindowname"); // what has focus

// 2. create — launch a detached, uniquely-titled app on the desktop.
await computer.create("xfce4-terminal", { title: "worker-1" });
await computer.create("chromium https://example.com", { title: "web-1" });

// focus + type into the terminal (search -> activate --sync -> type)
await computer.cmd(
  'wid=$(xdotool search --onlyvisible --name worker-1 | head -1); ' +
  'xdotool windowactivate --sync "$wid"; ' +
  'xdotool type --delay 40 "echo hello"; xdotool key Return'
);

// 3. kill — matches process command line AND window title.
await computer.kill("web-1");

// 4. screenshot — written to /workspace, returned as the host-side path.
const png = await computer.screenshot("state.png");

// 5. live — full-motion view of the desktop over HTTP.
const feed = await computer.live();               // port 8090
// open feed.url in a browser, or read feed.streamUrl from ffplay/agents;
// programmatic use: for await (const jpeg of computer.frames({ fps: 4 })) ...
await feed.stop();                                 // when done
```

## Watch the desktop live

`live()` serves the desktop as a motion-JPEG stream over HTTP, so humans and
agents see it as it moves — no VNC client needed and no image changes (it
reuses the daemon's `import` capture that `screenshot()` uses):

```bash
cd sdk && npm run build && node live.mjs
# viewer:  http://localhost:8090/
# stream:  http://localhost:8090/feed
```

- Browser: open `http://localhost:8090/` — auto-updating viewer page.
- `ffplay http://localhost:8090/feed` — plays the raw stream.
- Agents: `for await (const jpeg of computer.frames({ fps: 4 }))` yields one
  JPEG `Buffer` per frame for vision models; feed it, don't fight it.

Streams are ~2-4 fps (one `import` per frame at 1600x900, JPEG q70 ≈ 60-80 KB);
raise `fps`/`quality` in `live({ fps, quality })` at your own CPU cost. The
`port` for the HTTP server defaults to 8090 (`live({ port: 8091 })`).

## The daemon

`daemon/daemon.py` (Python stdlib only) runs inside the container, started by
`entrypoint.sh`, listening on `0.0.0.0:8095` (override with `API_PORT`). It is
a root shell over the network — keep it reachable only from your machine. It
handles the shell quoting and process-group cleanup; endpoints:

```
GET  /api/health
POST /api/cmd       {"cmd", "timeoutMs?}
POST /api/create    {"command", "title?}
POST /api/kill      {"title"}
POST /api/type      {"text", "delayMs?}
POST /api/key       {"keys"}
POST /api/mouse     {"x", "y"}
POST /api/click     {"button?", "x?", "y?"}
POST /api/windows
POST /api/screenshot {"name?"}
GET  /api/observe   ?width=&quality=   -> image/jpeg
```

## Why these methods

`create`/`kill`/`screenshot`/`live` are thin wrappers around the command
primitive; anything else (keyboard, mouse, windows, cropped screenshots,
waiting, health checks) is one `cmd()` call. If you can do it with `cmd`, there
is no separate helper.

- `create` appends the title as a CLI flag (`--title` for terminals, `--user-data-dir`
  for chromium — stored under `/workspace/.workers/`, so it
  persists on the host) so it shows up in the process command line and `kill` can find it;
  the daemon also writes the app's stdout/stderr to `/workspace/.workers/<title>/console.log`.
- Titles are restricted to letters, digits, `.`, `_`, `-` (they end up in shell
  command lines and `pkill` patterns) — `create`/`kill` throw otherwise.
- `kill(title)` runs `pkill -f title` then `xdotool search --name title windowkill`.
- `screenshot(name?)` runs ImageMagick `import` on the computer and returns the
  host path of the mounted workspace.
- `live({ port, fps, quality })` serves an MJPEG stream of the desktop
  (`http://localhost:<port>/` viewer, `/feed` raw stream); `frames()` is the
  same feed as an async generator of JPEG buffers.
- `cmd` fails loudly (throws with exit code + stderr) on any non-zero exit.

## Customize

```ts
new Desktop({
  port: 8095,                    // which computer — its daemon's host port
  host: "localhost",             // where the daemon runs
  workspace: "./workspace",      // host path of the computer's mount
});
```