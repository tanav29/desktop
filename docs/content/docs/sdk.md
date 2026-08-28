---
title: TypeScript SDK
description: computer-use-sdk — a thin client over the daemon. cmd, create, actions, kill, screenshot, live, frames.
---

`computer-use-sdk` is a thin TypeScript wrapper around the in-container HTTP
daemon. The SDK never touches docker — every call is one HTTP round-trip to a
process that is already running, so `cmd()` etc. cost a few ms of overhead
instead of a ~150 ms+ `docker exec` CLI spawn.

```bash
cd sdk
npm install
npm run build
```

Make sure a computer is running first (`docker compose up -d`, see the
[Quickstart](/docs/quickstart)), then:

```bash
curl http://localhost:8095/api/health   # -> {"ok": true, ...}
```

## Connect

Every computer runs its own daemon, and its published host **port is the
computer's id**:

```ts
import { Desktop } from "computer-use-sdk";

const comp1 = new Desktop();               // port 8095 — computer #1
const comp2 = new Desktop({ port: 8096 }); // computer #2

new Desktop({
  port: 8095,                // which computer — its daemon's host port
  host: "localhost",         // where the daemon runs
  workspace: "./workspace",  // host path of the computer's mount (for screenshot paths)
});
```

A ready-to-use singleton is also exported: `import { computer } from "computer-use-sdk"`.
`Desktop.baseUrl` shows where calls go.

## Methods

### `cmd(command, timeoutMs?)` — the escape hatch

Anything inside the computer, run as `bash -c`. Fails loudly (throws with exit
code + stderr) on any non-zero exit.

```ts
await computer.cmd("pgrep -f xfce4-session");                 // desktop health
await computer.cmd("xdotool getactivewindow getwindowname"); // what has focus
```

If you can do it with `cmd`, there is no separate helper — anything else
(keyboard, mouse, windows, cropped screenshots, waiting, health checks) is one
`cmd()` call away.

### `create(command, { title })` — launch an app

Launches a detached app on the desktop with a unique title so it can be found
and killed later.

```ts
await computer.create("xterm", { title: "worker-1" });
await computer.create("chromium https://example.com", { title: "web-1" });
```

- The title is appended as a CLI flag (`--title` for terminals,
  `--user-data-dir` for chromium — stored under `/workspace/.workers/`) so it
  shows up in the process command line and `kill` can find it.
- App stdout/stderr is captured to `/workspace/.workers/<title>/console.log`.
- **Titles are restricted** to letters, digits, `.`, `_`, `-` (max 64 chars) —
  they end up in shell command lines and `pkill` patterns; `create`/`kill`
  throw otherwise.

### `actions(list)` — the main event

A whole input sequence in ONE round-trip. See the [actions vocabulary](/docs/daemon#post-api-actions).

```ts
await computer.actions([
  { do: "wait_for", window: "worker-1", timeoutMs: 15_000 },
  { do: "focus",    window: "worker-1" },
  { do: "type",     text: "echo hello" },
  { do: "key",      keys: "Return" },
]);
```

`actions()` returns the result for you to branch on:

```ts
const result = await computer.actions([{ do: "focus", window: "nope" }]);
result.ok;               // false
result.failedAt;         // 0
result.steps[0].note;    // "no visible window matching: nope"
result.state.focused;    // whatever actually has focus
```

Convenience helpers — `mouse`, `click`, `type`, `key`, `drag`, `scroll`,
`paste`, `focus`, `waitFor` — are one-element calls into the same path and
throw on failure instead of returning a result.

### `kill(title)` — stop an app

Matches the process command line **and** the window title:
runs `pkill -f <title>` then `xdotool search --name <title> windowkill`.

```ts
await computer.kill("web-1");
```

### `screenshot(name?)` — see what happened

Runs ImageMagick `import` on the computer, writes `/workspace/<name>`, and
returns the **host-side path** of the file.

```ts
const png = await computer.screenshot("state.png"); // -> workspace/state.png
```

### `live()` / `frames()` — watch it move

`live()` serves the desktop as a motion-JPEG stream over HTTP from your own
process — humans and agents both get a full-motion view, no VNC client needed.

```bash
cd sdk && npm run build && node live.mjs
# viewer:  http://localhost:8090/
# stream:  http://localhost:8090/feed
```

```ts
const feed = await computer.live();          // default port 8090
// open feed.url in a browser, or play feed.streamUrl with ffplay
await feed.stop();                           // when done
```

For programmatic use, `frames()` is the same feed as an async generator of JPEG
buffers:

```ts
for await (const jpeg of computer.frames({ fps: 4 })) {
  // one Buffer per frame — feed it to a vision model
}
```

Streams are ~2–4 fps at 1600x900 (JPEG q70 ≈ 60–80 KB/frame). Raise `fps` /
`quality` via `live({ fps, quality, port })` at your own CPU cost.

### `pointer()` — where is the mouse?

```ts
await computer.pointer(); // { x, y, click } — position + last click
```

Xvfb has no hardware cursor, so this is the only way to know.

## Full example

```ts
import { computer } from "computer-use-sdk";

await computer.cmd("pgrep -f xfce4-session");      // desktop is up
await computer.create("chromium https://example.com", { title: "web-1" });

await computer.actions([
  { do: "wait_for", window: "Chrome for Testing", timeoutMs: 45_000 },
  { do: "focus",    window: "Chrome for Testing" },
  { do: "key",      keys: "ctrl+l" },
  { do: "paste",    text: "https://news.ycombinator.com" },
  { do: "key",      keys: "Return" },
]);

await computer.screenshot("state.png");            // → workspace/state.png
const feed = await computer.live();                // MJPEG stream
for await (const frame of computer.frames({ fps: 4 })) { /* vision input */ }
await computer.kill("web-1");
```
