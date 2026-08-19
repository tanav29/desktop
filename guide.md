# Desktop Control Guide — Docker Linux Desktop

Everything you need to build an SDK that starts, kills, and controls the
desktop (and apps on it) inside the Docker container — using `xdotool` for
keyboard/mouse/window automation over plain CLI commands.

---

## 1. Architecture at a glance

| Piece | What it is | Where |
|---|---|---|
| Container | Debian 13 (trixie) + XFCE | Docker image `computer-desktop` |
| Display | Xvfb virtual X server on `:99` | inside container |
| VNC | x11vnc on port `5900` | inside container (not exposed) |
| noVNC | websockify + noVNC, **port `6080`** | exposed to host |
| Desktop control | `xdotool` (X11 automation CLI) | inside container |
| Screenshots | ImageMagick (`import` / `convert`) | inside container |
| Browser | Chromium (Chrome-for-Testing build) at `/opt/chrome/chrome` | inside container |
| Working dir | `/workspace` (host folder `./workspace` mounted in) | host ↔ container |

Files:

```
computer/
├── Dockerfile          # image definition (XFCE, tools, xdotool, Chromium, noVNC)
├── docker-compose.yml  # port 6080, /workspace volume, resource caps
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

### 1.1 Preinstalled toolchain (agent's workbench)

| Category | Tools |
|---|---|
| Build | not preinstalled — `apt-get install -y --no-install-recommends build-essential` if a task must compile |
| Languages | python 3 |
| Editor / shell | `nano`, `bash` (terminal: xfce4-terminal) |
| VCS | `git` |
| Network | `curl`, `ca-certificates` |
| Search | `ripgrep` |
| Images | ImageMagick: `import` (screenshot), `convert` |
| X11 control | `xdotool`, `xvfb`, `x11vnc` |
| Browser | Chromium via `/opt/chrome/chrome` (alias `chromium`) |

No `node`/`npm` (kept out for size). If you need them later:

```bash
docker exec -d linux-desktop bash -c 'apt-get update && apt-get install -y --no-install-recommends nodejs npm'
```

## 2. Controlling the desktop (xdotool)

`xdotool` talks to the X server (`DISPLAY=:99`) and simulates keyboard, mouse,
and window actions. Every call is a one-liner, so it's trivial to wrap in
`docker exec` from the host or inside the container.

### 2.1 Keyboard

```bash
docker exec -d linux-desktop bash -c 'DISPLAY=:99 xfce4-terminal --title=Demo --command=bash'   # open terminal
docker exec linux-desktop xdotool key --window "$(xdotool getactivewindow)" ctrl+c
docker exec linux-desktop xdotool type --delay 50 'echo hello world'
```

Notable key names: `Return`, `Tab`, `Escape`, `BackSpace`, `Delete`,
`Left/Right/Up/Down`, `Home`, `End`, `Page_Up/Page_Down`, `F1`–`F12`,
`Super_L` (Windows key). Modifiers combine with `+` (`ctrl+shift+t`).

### 2.2 Mouse

```bash
docker exec linux-desktop xdotool mousemove 800 450            # absolute move
docker exec linux-desktop xdotool mousemove_relative 20 -10    # relative move
docker exec linux-desktop xdotool click 1                      # left click
docker exec linux-desktop xdotool click --repeat 2 5           # double-click (button 5 = wheel down)
docker exec linux-desktop xdotool mousedown 1; xdotool mousemove_relative 50 50; xdotool mouseup 1  # drag
```

`DISPLAY` defaults to `:99` via the container env, so plain `xdotool` works
inside the container; from the host wrap in `docker exec linux-desktop ...`.

### 2.3 Windows

```bash
docker exec linux-desktop bash -c 'xdotool search --name -- "Terminal" windowactivate --sync'
docker exec linux-desktop xdotool search --onlyvisible --class chromium windowmove 0 0 windowsize 800 600
docker exec linux-desktop xdotool search --name "Terminal" windowminimize
docker exec linux-desktop bash -c 'xdotool getactivewindow getwindowname'   # what has focus
docker exec linux-desktop xdotool search --onlyvisible --class "" getactivewindow 2>/dev/null
```

`windowactivate --sync` waits until the window is actually focused — important
before typing. `search --onlyvisible` ignores hidden/minimized windows.

### 2.4 Verify before you type (race-free pattern)

xdotool is fire-and-forget; a window may not exist yet when you send keys. The
reliable pattern is: search → activate (sync) → type:

```bash
docker exec linux-desktop bash -c '
  wid=$(xdotool search --onlyvisible --name "Terminal" | head -1)
  xdotool windowactivate --sync "$wid"
  xdotool type --delay 40 "ls -la" && xdotool key Return'
```

Poll with `xdotool search` in a retry loop while an app is starting
(`--timeout`/`--sync` combinations plus a few `sleep 1` rounds work well).

### 2.5 Screenshots

ImageMagick is preinstalled — grab the whole desktop, or a crop of it:

```bash
docker exec linux-desktop import -window root -display :99 /workspace/desktop.png
docker exec linux-desktop bash -c 'import -window root -display :99 /workspace/desktop.png && convert /workspace/desktop.png -crop 400x300+600+200 /workspace/crop.png'
```

Run screenshots from the host side with `docker exec`; write to `/workspace` so
they land on the host disk. This is how the agent *sees* the state of the UI
before/after xdotool actions.

## 3. Launching apps on the desktop

### 3.1 Visible app for humans / demo

```bash
docker exec -d linux-desktop bash -c 'DISPLAY=:99 xfce4-terminal --title=Demo --command=bash'
docker exec -d linux-desktop bash -c 'DISPLAY=:99 /opt/chrome/chrome --no-sandbox --disable-dev-shm-usage --no-first-run https://example.com'
```

The Chromium desktop entry (XFCE menu) uses the same flags without the
debugging port — the 9222/CDP surface has been removed.

### 3.2 Ephemeral SDK "worker" windows (parallel, disposable)

One window per worker; kill by window title:

```bash
docker exec -d linux-desktop bash -c 'DISPLAY=:99 xfce4-terminal --title=worker-1 --command=bash'
docker exec linux-desktop xdotool search --name "worker-1" windowkill
```

Rules of thumb:

- Always pass `DISPLAY=:99` (exported by the entrypoint, but `docker exec`
  shells get the container env anyway; being explicit never hurts).
- `--no-first-run` keeps Chromium from showing the setup wizard.
- If you don't need a visible window, skip the desktop entirely — run
  headless with `--headless=new` and no `DISPLAY`.

## 4. Killing apps

```bash
docker exec linux-desktop bash -c 'pkill -f "xfce4-terminal.*worker-1"'  # by command line
docker exec linux-desktop xdotool search --name "worker-1" windowkill    # by window
docker exec -d linux-desktop bash -c 'killall chromium'                  # everything
docker compose down && docker compose up -d                              # reset the whole box
```

`pkill -f` matches the full command line — keep titles/flags unique per
instance. PID 1 inside the container is `tini` (compose `init: true`), which
reaps children, so kills are clean.

## 5. SDK blueprint

Minimum viable control plane for a desktop-automation SDK:

1. **Instance registry** — table of `name → window title → command line`.
   Persist it in `/workspace`.
2. **Create** — one `docker exec -d` with a unique `--title`/`--user-data-dir`;
   register the entry.
3. **Kill** — `pkill -f "worker-1"` or `xdotool search --name worker-1 windowkill`;
   unregister.
4. **Control** — one `docker exec linux-desktop xdotool ...` per action:
   `key`, `type`, `mousemove`, `click`, `search`, `windowactivate`, …
   plus `import` for before/after screenshots. Host wrapper → container = no
   extra ports, everything over the Docker API.
5. **Wait for ready** — poll `xdotool search --name <title>` until found,
   then `windowactivate --sync` before the first keystroke.
6. **Health of the desktop itself** — `curl -sf http://localhost:6080/vnc.html`
   for the environment; `docker exec linux-desktop pgrep -f xfce4-session`
   for the desktop.

Failure modes to expect:

| Symptom | Cause / fix |
|---|---|
| Typing goes nowhere | window not focused → `windowactivate --sync` first |
| `windowkill` kills the wrong thing | title too generic → make titles unique per worker |
| App invisible | missing `DISPLAY=:99`, or minimised → `windowactivate` |
| Nothing on screen at all | Xvfb crashed → `docker compose logs`; desktop health check §6 |
| `Can't open display` | env lost → pass `DISPLAY=:99` explicitly |
| Container OOM | Chromium is the heavy process; `mem_limit: 3g` in compose |

## 6. Reference

```bash
# environment
docker compose up -d --build
docker compose down
docker compose logs -f

# desktop health
curl -sI http://localhost:6080/vnc.html
docker exec linux-desktop pgrep -f xfce4-session

# xdotool quick reference
docker exec -d linux-desktop bash -c 'DISPLAY=:99 xfce4-terminal --title=Demo --command=bash'
docker exec linux-desktop xdotool type --delay 50 "text"
docker exec linux-desktop xdotool mousemove 800 450 click 1
docker exec linux-desktop bash -c 'xdotool search --name "Terminal" windowactivate --sync'

# screenshot
docker exec linux-desktop import -window root -display :99 /workspace/shot.png

# compile a quick C file (build-essential is NOT preinstalled; install on demand)
docker exec linux-desktop bash -c 'apt-get install -y --no-install-recommends build-essential && printf "int main(){return 0;}" > /workspace/t.c && gcc /workspace/t.c -o /workspace/t'

# launch / kill an app by title
docker exec -d linux-desktop bash -c 'DISPLAY=:99 xfce4-terminal --title=worker-1'
docker exec linux-desktop bash -c 'pkill -f "worker-1"'
```