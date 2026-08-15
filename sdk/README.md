# computer-use-sdk

Minimal TypeScript SDK for the Docker Linux desktop (see `../guide.md`).
Everything is one `docker exec` away, so the SDK has exactly four methods.

```bash
npm install
npm run build
```

## Usage

```ts
import { computer } from "computer-use-sdk";

// 1. cmd — anything inside the container (bash -c). The escape hatch.
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

// 4. screenshot — written to /workspace on the host side.
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
reuses the same `import` capture as `screenshot()`):

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

## Why only five methods

`create`/`kill`/`screenshot`/`live` are thin wrappers around the `docker exec`
primitive; anything else (keyboard, mouse, windows, cropped screenshots,
waiting, health checks) is one `cmd()` call. If you can do it with `cmd`, there
is no separate helper.

- `create` appends the title as a CLI flag (`--title` for terminals, `--user-data-dir`
  for chromium — stored under `/workspace/.workers/` inside the container, so it
  persists on the host) so it shows up in the process command line and `kill` can find it.
- Titles are restricted to letters, digits, `.`, `_`, `-` (they end up in shell
  command lines and `pkill` patterns) — `create`/`kill` throw otherwise.
- `kill(title)` runs `pkill -f title` then `xdotool search --name title windowkill`.
- `screenshot(name?)` runs ImageMagick `import` and returns the host path
  (e.g. `C:\...\computer\workspace\state.png`).
- `live({ port, fps, quality })` serves an MJPEG stream of the desktop
  (`http://localhost:<port>/` viewer, `/feed` raw stream); `frames()` is the
  same feed as an async generator of JPEG buffers.
- `cmd` fails loudly (throws with exit code + stderr) on any non-zero exit.

## Customize

```ts
new Desktop({ container: "linux-desktop", display: ":99", workspace: "./workspace" });
```