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
await computer.cmd("pgrep -f xfce4-session");            // desktop health
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
```

## Why only four methods

`create`/`kill`/`screenshot` are thin wrappers around the `docker exec`
primitive; anything else (keyboard, mouse, windows, cropped screenshots,
waiting, health checks) is one `cmd()` call. If you can do it with `cmd`, there
is no separate helper.

- `create` appends the title as a CLI flag (`--title` for terminals, `--user-data-dir`
  for chromium) so it shows up in the process command line and `kill` can find it.
- `kill(title)` runs `pkill -f title` then `xdotool search --name title windowkill`.
- `screenshot(name?)` runs ImageMagick `import` and returns the host path
  (e.g. `C:\...\computer\workspace\state.png`).
- `cmd` fails loudly (throws with exit code + stderr) on any non-zero exit.

## Customize

```ts
new Desktop({ container: "linux-desktop", display: ":99", workspace: "./workspace" });
```