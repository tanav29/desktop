# computer-use-sdk — the best way to drive a computer

Thin, fast, *complete* TypeScript wrapper around the in-container HTTP daemon
(`daemon/daemon.py`). The SDK never touches `docker` — every call is one HTTP
round-trip to a process already inside the container, so `cmd()` etc. cost a few
ms instead of a `docker exec` spawn (~150 ms+).

```bash
npm install
npm run build
```

The daemon ships inside the image; make sure it is running:

```bash
cd .. && docker compose up -d --build
curl http://localhost:8095/api/health  # -> {"ok": true, "version": "2.0.0", ...}
```

## Pick a computer by port

Every computer runs its own daemon. In `docker-compose.yml` each one publishes
a distinct host port (8095, 8096, ...). That port **is** the computer's id:

```ts
import { Desktop, Computers } from "computer-use-sdk";

const comp1 = new Desktop();               // 8095 — computer #1
const comp2 = new Desktop({ port: 8096 }); // computer #2

// discover what's actually up
const live = await Computers.discover({ ports: [8095, 8096, 8097] });
```

`host` defaults to `localhost`; `workspace` (default `./workspace`) is the host
path of that computer's mounted folder, used for `screenshot()` return values.
`Desktop.baseUrl` shows where calls go.

## Usage — controlling *and* killing

```ts
import { computer } from "computer-use-sdk";

// 1. cmd — anything inside the computer (bash -c). The escape hatch.
await computer.cmd("pgrep -f xfce4-session");
await computer.exec("ls -la /workspace"); // structured {exit, stdout, stderr}

// 2. create / spawn — launch a detached, uniquely-titled app
await computer.create("xterm", { title: "worker-1" });
await computer.create("chromium https://example.com", { title: "web-1" });
await computer.open("https://example.com", { title: "web-2" }); // sugar for chromium
const { pid, windowFound } = await computer.spawn("xterm", { title: "term-1", waitMs: 2000 });

// 3. actions — a whole input sequence in ONE round-trip. The main event.
await computer.actions([
  { do: "wait_for", window: "worker-1", timeoutMs: 15_000 },
  { do: "focus", window: "worker-1" },
  { do: "type", text: "echo hello" },
  { do: "key", keys: "Return" },
]);

// 4. kill — verified, phased (TERM → KILL + windowkill), with a report
await computer.kill("web-1"); // { ok, killed, pidsKilled, windowsKilled, logTail, ... }
await computer.kill("web-1", { signal: "kill", clean: true }); // immediate + rmdir
await computer.close("web-1"); // alias

// 5. kill everything — the nuke
await computer.killAll();                 // all workers
await computer.killAll({ prefix: "tmp-" }); // only tmp-*
await computer.nuke();                    // killAll({clean:true})
await computer.clean();                   // GC dead worker dirs
await computer.reset({ cleanWorkspace: false }); // soft reset

// 6. inspect — workers, processes, windows, health
await computer.workers();  // [{title, pid, alive, command, windowFound, logBytes, ...}]
await computer.list();     // alias
await computer.ps();       // {processes:[...], windows:[...], workers:[...]}
await computer.windows();  // ["Xfwm4", "Desktop", "term-1", ...]
await computer.windowsDetailed(); // [{id, name, pid, geometry}, ...]
await computer.info();     // {version, uptime, displayOk, workers, mem, disk, ...}
await computer.health();   // boolean
await computer.healthDetailed(); // same as info()

// 7. observe & screenshot
const png = await computer.screenshot("state.png"); // -> ./workspace/state.png
const { jpeg, base64, dataUri } = await computer.observe({ width: 1152, quality: 60 });

// 8. live — full-motion view over HTTP
const feed = await computer.live();               // http://localhost:8090/
for await (const jpeg of computer.frames({ fps: 4 })) { /* vision */ }
await feed.stop();
```

`Computers` helper for multi-computer orchestration (no docker CLI):

```ts
import { Computers } from "computer-use-sdk";

const comps = await Computers.discover(); // scans 8095..8099
await Computers.killAll(comps, { clean: true });
await Computers.nukeAll(); // discover + nuke every computer
```

## Actions

`actions(list)` is the primary way to drive the desktop: the daemon executes the
whole list in-container and answers once. `mouse`/`click`/`type`/`key`/`drag`/
`scroll`/`paste`/`focus`/`waitFor` are one-element calls into the same path.

| `do` | args |
|---|---|
| `move` | `x, y` |
| `click` | `button?=1, x?, y?, count?=1` |
| `drag` | `x1, y1, x2, y2` |
| `scroll` | `dir: "up" \| "down", amount?=3` |
| `type` | `text, delayMs?` |
| `key` | `keys, count?=1` |
| `paste` | `text` |
| `focus` | `window` |
| `wait` | `ms` |
| `wait_for` | `window, timeoutMs?=15000` |

Max 32 actions per call. Execution stops at the first failure; the result carries
`ok`, `ran`, `failedAt`, a per-step log, and `state` (`pointer`, `focused`).

```ts
const result = await computer.actions([{ do: "focus", window: "nope" }]);
result.ok; result.failedAt; result.steps[0].note; result.state.focused;
```

`pointer()` returns `{x,y,click}` — Xvfb has no hardware cursor, so this is the
only way to know where the pointer really is.

## Killing — why it actually works

Old `kill(title)` was `pkill -f title` + `windowkill` fire-and-forget. The new
daemon is verified:

* **Phased** — `TERM` → wait 2s → `KILL` + `windowkill` sweep.
* **PID-aware** — also kills the pid stored in `/workspace/.workers/<title>/meta.json`
  via `kill -- -pgid` so `sleep 30 # title` comment-style titles still die.
* **Reported** — returns `{killed, pidsKilled, pidsBefore/After, windowsKilled,
  aliveAfter, logTail, cleaned}` so you know it worked.
* **Clean** — `clean:true` removes `/workspace/.workers/<title>` (chromium
  profile included) after a successful kill.
* **Bulk** — `killAll({prefix, clean})` and `nuke()` iterate workers with the
  same phased logic and aggregate `{killed, failed, count, details}`.

Titles are `^[A-Za-z0-9._-]{1,64}$` — safe for `pkill` regex and shell.

## Workers & inspection

Workers are filesystem-backed (`/workspace/.workers/<title>/meta.json` + `console.log`)
so they survive daemon restarts:

```ts
await computer.workers();
// [{title:"term-1", pid:951, pids:[951], alive:true, command:"xterm -title term-1",
//   windowFound:true, windowIds:["29360140"], logBytes:0, ...}]

await computer.ps();
// {processes: [{pid, ppid, etime, pcpu, pmem, cmd}, ...],
//  windows: [{id, name, pid, geometry}, ...], workers: [...]}

await computer.info();
// {version:"2.0.0", display:":99", resolution:"1600x900", displayOk:true,
//  uptime:123, workers:2, workersAlive:2, memTotal, diskFree, pointer, focused, ...}
```

`spawn()` vs `create()`: `create()` returns just the title (backward compat);
`spawn()` returns the full `{pid, log, windowFound, meta, ...}` and accepts
`waitMs` to block until the window appears.

## Watch the desktop live

```bash
cd sdk && npm run build && node live.mjs
# viewer:  http://localhost:8090/
# stream:  http://localhost:8090/feed
```

* Browser: `http://localhost:8090/` auto-updating viewer.
* `ffplay http://localhost:8090/feed` raw MJPEG.
* Agents: `for await (const jpeg of computer.frames({ fps: 4 }))` → JPEG `Buffer`.

~2-4 fps at 1600x900 q70 ≈ 60-80 KB per frame; raise `fps`/`quality` at CPU cost.
Port defaults to 8090 (`live({port:8091})`).

## The daemon — now the best

`daemon/daemon.py` (Python stdlib only, `v2.0.0`) is no longer a thin shim. It is a
complete control plane with CORS, proper timeout handling, and a worker registry:

```
GET  /api/health              -> {ok, display, resolution, version, uptime, workers}
GET  /api/info                -> extended health + mem/disk/pointer/focused
GET  /api/workers             -> {workers:[...], count}
GET  /api/ps                  -> {processes:[...], windows:[...], workers:[...]}
POST /api/cmd   {"cmd", "timeoutMs"} -> {exit, stdout, stderr, durationMs}
POST /api/exec  alias
POST /api/create {"command","title","waitMs"} -> {pid, log, title, windowFound, ...} (409 if title busy)
POST /api/kill  {"title","signal","waitMs","clean"} -> KillResult
POST /api/killAll {"prefix","clean"} -> KillAllResult
POST /api/system {"action":"killAll"|"clean"|"reset"|"info"} -> ...
POST /api/actions {"actions":[...]} -> {ok, ran, failedAt, steps, state}
POST /api/type  {"text","delayMs"}
POST /api/key   {"keys"}
POST /api/mouse {"x","y"}
POST /api/click {"button","x","y"}
POST /api/windows {"detail"?} -> {windows:["Name",...]} or detailed
POST /api/screenshot {"name"} -> {path, exit, ...}
GET  /api/observe ?width=&quality= -> image/jpeg
GET  /api/pointer             -> {x,y,click}
GET  /api/windows?detail=1    -> {windows:[{id,name,pid,geometry}], names:[...]}
```

Recording / sharing (no ffmpeg):

```
POST /api/record/capture {"sessionId","quality"} -> {ok, frame, path, frames}
POST /api/record/build   {"sessionId"} -> {ok, url, path, bytes, frames}
GET  /api/record?sessionId=xxx -> same
POST /api/share {"what":"screenshot"|"recording","sessionId","label"} -> {ok, media,...}
```

* Every free-text field reaches the shell via env vars — `$(…)` and backticks are
  typed literally, never executed.
* `/api/cmd` `timeoutMs` is now correctly ms → seconds, with `durationMs` echoed.
* `CORS: *` + `OPTIONS` so browser clients work.
* Request logging with ms, body-size guard (1 MB), and `Access-Control-*` headers.

Start with `API_PORT` env (default 8095). Keep it on `localhost` — it is a root
shell over HTTP.

## Why these methods

`create`/`kill`/`killAll`/`nuke`/`workers`/`ps`/`info`/`open`/`exec`/`screenshot`/
`live` are the curated surface; everything else (cropped screenshots, waiting,
health) is `cmd()` or `actions()`. If you can do it with `cmd`, there is no
separate helper — but the curated ones handle quoting, process groups, and
`--user-data-dir` / `-title` / `# title` injection so you don't have to.

* Chromium: `--user-data-dir=/workspace/.workers/<title>` (persists on host,
  isolated per worker, so `kill --clean` truly wipes the profile).
* xterm: `-title <title>` injected before `-e` so it survives the `xterm -e` swallowing.
* Generic: ` # <title>` bash comment — searchable via `pkill -f`, never breaks the
  real command (e.g. `sleep 30 # myapp` runs as `sleep 30`).
* `kill(title, {clean})` does `pkill -TERM -f` + direct `kill -- -pgid`, waits,
  escalates to `KILL`, sweeps `windowkill`, then optionally `rm -rf` the worker dir.

## Customize

```ts
new Desktop({
  port: 8095,                    // which computer — its daemon's host port
  host: "localhost",
  workspace: "./workspace",      // host path of the mount
});
```
