---
title: Automation Playbook
description: Patterns for driving the desktop — batched actions, verify-before-type, windows, screenshots, launching and killing apps.
---

The primitive under everything is `xdotool` (X11 automation) on `DISPLAY=:99`.
You rarely need it directly: the daemon wraps it in the [batched actions
API](/docs/daemon#post-api-actions), and the SDK wraps that in helpers. This
page is the playbook — the patterns that make automation reliable.

## Rule 1: batch, don't trickle

One request per **task**, not per keystroke. `POST /api/actions` runs a whole
sequence in-container and answers once:

```ts
await computer.actions([
  { do: "wait_for", window: "Chromium", timeoutMs: 20_000 },
  { do: "focus",    window: "Chromium" },
  { do: "key",      keys: "ctrl+l" },
  { do: "paste",    text: "https://example.com" },
  { do: "key",      keys: "Return" },
  { do: "wait",     ms: 2500 },
]);
```

Round-trips are the expensive part — especially when a language model is the
caller and every call costs a turn of context.

## Rule 2: verify before you type

xdotool is fire-and-forget; a window may not exist when keys arrive. The
reliable pattern is **search → activate (sync) → type**:

```bash
docker exec linux-desktop bash -c '
  wid=$(xdotool search --onlyvisible --name "Terminal" | head -1)
  xdotool windowactivate --sync "$wid"
  xdotool type --delay 40 "ls -la" && xdotool key Return'
```

`windowactivate --sync` waits until the window actually has focus. In the
actions API, `wait_for` + `focus` is the same pattern, polled inside the
container instead of over the wire.

## Keyboard

```bash
docker exec linux-desktop xdotool type --delay 50 'echo hello world'
docker exec linux-desktop xdotool key ctrl+c
```

Notable key names: `Return`, `Tab`, `Escape`, `BackSpace`, `Delete`,
`Left/Right/Up/Down`, `Home`, `End`, `Page_Up/Page_Down`, `F1`–`F12`,
`Super_L`. Modifiers combine with `+`: `ctrl+shift+t`.

Prefer **paste** over `type` for anything long — clipboard plus one `ctrl+v`
is length-independent.

## Mouse

```bash
docker exec linux-desktop xdotool mousemove 800 450            # absolute move
docker exec linux-desktop xdotool click 1                      # left click
docker exec linux-desktop xdotool click --repeat 2 1           # double-click
```

Drags hop through the midpoint so motion-watching apps see them — use the
`drag` action rather than hand-rolling mousedown/move/up.

Because Xvfb has no hardware cursor, verify positions with the pointer API:

```ts
await computer.pointer(); // { x, y, click }
```

## Windows

```bash
docker exec linux-desktop bash -c 'xdotool search --name -- "Terminal" windowactivate --sync'
docker exec linux-desktop xdotool search --onlyvisible --class chromium windowmove 0 0 windowsize 800 600
docker exec linux-desktop xdotool search --name "Terminal" windowminimize
docker exec linux-desktop bash -c 'xdotool getactivewindow getwindowname'
```

`--onlyvisible` ignores hidden/minimized windows. List what's open via
`POST /api/windows` or `computer.windows()`.

## Screenshots

ImageMagick is preinstalled — grab the whole desktop or a crop:

```bash
docker exec linux-desktop import -window root -display :99 /workspace/desktop.png
docker exec linux-desktop convert /workspace/desktop.png \
  -crop 400x300+600+200 /workspace/crop.png
```

Write to `/workspace` so files land on your host disk. From the SDK,
`screenshot("state.png")` returns the host path directly.

For motion instead of stills, see [`live()` and `frames()`](/docs/sdk#live-frames-watch-it-move).

## Launching apps

**Visible** (for humans watching the noVNC view):

```bash
docker exec -d linux-desktop bash -c 'DISPLAY=:99 xterm -title worker-1 -e bash'
docker exec -d linux-desktop bash -c 'DISPLAY=:99 chromium https://example.com'
```

From the SDK, `create()` handles the title flag for you:

```ts
await computer.create("chromium https://example.com", { title: "web-1" });
```

Tips:

- Always pass `DISPLAY=:99` when shelling in manually.
- `--no-first-run` keeps Chromium's setup wizard away.
- No visible window needed? Skip the desktop entirely — run headless with
  `--headless=new` and no `DISPLAY`.

## Killing apps

```bash
docker exec linux-desktop bash -c 'pkill -f "xterm.*worker-1"'  # by command line
docker exec linux-desktop xdotool search --name "worker-1" windowkill    # by window
docker compose down && docker compose up -d                              # reset the whole box
```

Keep titles unique per worker (`pkill -f` matches the full command line).
PID 1 is `tini`, which reaps children, so kills are clean.
