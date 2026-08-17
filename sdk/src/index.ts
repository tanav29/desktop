import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";

export interface DesktopOptions {
  /** Docker container name, default "linux-desktop" */
  container?: string;
  /** X display used inside the container, default ":99" */
  display?: string;
  /** Host path of the mounted workspace, default "./workspace" */
  workspace?: string;
}

export interface CmdOptions {
  /** Kill the docker exec after this many ms. Default 2 min. */
  timeoutMs?: number;
}

export interface CreateOptions {
  /** Unique worker id. Defaults to `worker-<random>`. Used by kill(). */
  title?: string;
}

export interface LiveOptions {
  /** HTTP port for the MJPEG stream, default 8090. 0 picks a free port. */
  port?: number;
  /** Frames per second (1-10), default 4 */
  fps?: number;
  /** JPEG quality (1-95), default 70 */
  quality?: number;
}

export interface TypeOptions {
  /** Keystroke delay in ms (0-500), default 30 */
  delayMs?: number;
}

export interface ObserveOptions {
  /** Target width in px, aspect preserved. Default 1152. */
  width?: number;
  /** JPEG quality 1-95. Default 60. */
  quality?: number;
}

export interface ObserveResult {
  /** Scaled JPEG frame bytes. */
  jpeg: Buffer;
  /** Raw base64 of the JPEG, ready for vision-model file parts. */
  base64: string;
  /** data:image/jpeg;base64,... data URI form of the same frame. */
  dataUri: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const IN_CONTAINER_WORKSPACE = "/workspace";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function captureJpeg(container: string, display: string, quality: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["exec", container, "import", "-window", "root", "-display", display, "-quality", String(quality), "jpg:-"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", () => {});
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`import failed (exit ${code}); is the container up?`));
    });
  });
}

function docker(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const die = (s: string) =>
            reject(new Error(`docker ${args.join(" ")}\n${s}`));
          const code = typeof err.code === "number" ? `exit ${err.code}` : err.code;
          if (stderr.trim()) return die(`[${code}] ${stderr.trim()}`);
          if (stdout.trim()) return die(`[${code}] ${stdout.trim()}`);
          return die(err.message);
        }
        resolve(stdout);
      }
    );
  });
}

function genTitle(): string {
  return `worker-${randomBytes(3).toString("hex")}`;
}

function assertSafeTitle(title: string): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(title)) {
    throw new Error(`unsafe title (letters, digits, '.', '_', '-' only): ${JSON.stringify(title)}`);
  }
}

/** Regex-escape, then wrap the last char in [] so pkill -f can never match its own shell. */
function pidPattern(title: string): string {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return esc.length < 2 ? esc : esc.slice(0, -1) + "[" + esc.at(-1) + "]";
}

export class Desktop {
  readonly container: string;
  readonly display: string;
  readonly workspace: string;

  constructor(opts: DesktopOptions = {}) {
    this.container = opts.container ?? "linux-desktop";
    this.display = opts.display ?? ":99";
    this.workspace = path.resolve(opts.workspace ?? "./workspace");
  }

  /** Run a shell command inside the container. Returns trimmed stdout. */
  async cmd(input: string, opts: CmdOptions = {}): Promise<string> {
    const out = await docker(
      ["exec", this.container, "bash", "-c", input],
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    return out.trim();
  }

  /**
   * Launch a detached app on the desktop. Appends a unique CLI flag so the
   * title appears in the process command line and kill(title) can find it:
   * terminal -> --title, chromium -> --user-data-dir (inside the container's
   * /workspace, so it persists on the host). Already-titled commands are used
   * as-is unless a different opts.title forces a new flag. Returns the title.
   */
  async create(command: string, opts: CreateOptions = {}): Promise<string> {
    const existing = command.match(/--(?:title|user-data-dir)=([^\s]+)/);
    const title = opts.title ?? existing?.[1] ?? genTitle();
    assertSafeTitle(title);

    const flag =
      existing && existing[1] === title
        ? ""
        : command.split(/\s+/)[0].includes("chrom")
          ? `--user-data-dir=${IN_CONTAINER_WORKSPACE}/.workers/${title}`
          : `--title=${title}`;

    await docker(
      [
        "exec",
        "-d",
        this.container,
        "bash",
        "-c",
        `DISPLAY=${this.display} ${command.trim()} ${flag}`.trim(),
      ],
      DEFAULT_TIMEOUT_MS
    );
    return title;
  }

  /** Kill every process whose command line or window title matches `title`. */
  async kill(title: string): Promise<void> {
    assertSafeTitle(title);
    await docker(
      [
        "exec",
        this.container,
        "bash",
        "-c",
        `pkill -f '${pidPattern(title)}' || true; xdotool search --name '${pidPattern(title)}' windowkill 2>/dev/null || true`,
      ],
      DEFAULT_TIMEOUT_MS
    );
  }

  /** Move the pointer to absolute screen coordinates (x, y). */
  async mouse(x: number, y: number): Promise<void> {
    await docker(
      ["exec", this.container, "xdotool", "mousemove", String(x), String(y)],
      DEFAULT_TIMEOUT_MS
    );
  }

  /**
   * Click a mouse button, optionally after moving to (x, y).
   * Buttons: 1 left, 2 middle, 3 right, 4/5 wheel.
   */
  async click(button = 1, x?: number, y?: number): Promise<void> {
    const args = ["exec", this.container, "xdotool"];
    if (x !== undefined && y !== undefined) {
      args.push("mousemove", String(x), String(y));
    }
    args.push("click", String(button));
    await docker(args, DEFAULT_TIMEOUT_MS);
  }

  /**
   * Type text into the currently focused window. The text travels in an env
   * var, so any character is safe (no shell quoting issues).
   */
  async type(text: string, opts: TypeOptions = {}): Promise<void> {
    const delayMs = Math.min(Math.max(opts.delayMs ?? 30, 0), 500);
    await new Promise<void>((resolve, reject) => {
      execFile(
        "docker",
        [
          "exec",
          "-e",
          `TEXT=${text}`,
          "-e",
          `DELAY=${delayMs}`,
          this.container,
          "bash",
          "-c",
          'xdotool type --delay "$DELAY" -- "$TEXT"',
        ],
        { timeout: DEFAULT_TIMEOUT_MS },
        (err) => (err ? reject(new Error(`xdotool type failed: ${err.message}`)) : resolve())
      );
    });
  }

  /** Send a key or modifier combo, e.g. "Return", "ctrl+shift+t", "Super_L". */
  async key(keys: string): Promise<void> {
    await docker(["exec", this.container, "xdotool", "key", keys], DEFAULT_TIMEOUT_MS);
  }

  /** List visible window names on the desktop. */
  async windows(): Promise<string[]> {
    const out = await docker(
      [
        "exec",
        this.container,
        "bash",
        "-c",
        'xdotool search --onlyvisible --name ".*" getwindowname 2>/dev/null || true',
      ],
      DEFAULT_TIMEOUT_MS
    );
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  /** True when the XFCE desktop is running inside the container. */
  async health(): Promise<boolean> {
    try {
      return (await this.cmd("pgrep -f xfce4-session >/dev/null && echo ok")) === "ok";
    } catch {
      return false;
    }
  }

  /**
   * Capture the desktop as PNG. The file is written to the shared /workspace
   * and the returned path is the host-side location. Returns the host path.
   */
  async screenshot(name = `shot-${Date.now()}.png`): Promise<string> {
    const file = path.extname(name) ? path.basename(name) : `${path.basename(name)}.png`;
    const remote = `${IN_CONTAINER_WORKSPACE}/${file}`;
    await docker(
      ["exec", this.container, "import", "-window", "root", "-display", this.display, remote],
      DEFAULT_TIMEOUT_MS
    );
    return path.join(this.workspace, file);
  }

  /**
   * One scaled JPEG frame of the desktop (resize + recompress inside the
   * container in a single pipeline) plus base64 forms — the cheap way to feed
   * the screen to a vision model or stash a thumbnail.
   */
  async observe(opts: ObserveOptions = {}): Promise<ObserveResult> {
    const width = Math.min(Math.max(Math.round(opts.width ?? 1152), 320), 1600);
    const quality = Math.min(Math.max(opts.quality ?? 60, 1), 95);
    const jpeg = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          "exec",
          this.container,
          "bash",
          "-c",
          `import -window root -display ${this.display} jpg:- | convert - -resize ${width}x -quality ${quality} jpg:-`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      const chunks: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.stderr.on("data", () => {});
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`observe failed (exit ${code}); is the container up?`));
      });
    });
    return {
      jpeg,
      base64: jpeg.toString("base64"),
      dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    };
  }

  /**
   * Live JPEG frames of the desktop as an async generator — poll the X
   * framebuffer via `import` and convert to JPEG in the container. Yield
   * a Buffer per frame (~150-300 ms each, so fps above ~4 doesn't gain
   * much). Stops when the generator is returned or closed.
   */
  async *frames(opts: LiveOptions = {}): AsyncGenerator<Buffer> {
    const fps = Math.min(Math.max(opts.fps ?? 4, 1), 10);
    const quality = Math.min(Math.max(opts.quality ?? 70, 1), 95);
    while (true) {
      const frame = await captureJpeg(this.container, this.display, quality);
      yield frame;
      await sleep(1000 / fps);
    }
  }

  /**
   * Serve a live MJPEG view of the desktop over HTTP:
   *   - http://localhost:<port>/      minimal viewer page (works in any browser)
   *   - http://localhost:<port>/feed  raw multipart MJPEG stream (ffplay/agents)
   * The stream is a thin wrapper around frames(); stop it with feed.stop().
   */
  async live(opts: LiveOptions = {}): Promise<LiveFeed> {
    const port = opts.port ?? 8090;
    const server = createServer((req, res) => {
      if (req.url !== "/feed") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><head><meta charset="utf-8"><title>Desktop live feed</title></head>` +
            `<body style="margin:0;background:#111">` +
            `<img src="/feed" style="width:100vw;height:100vh;object-fit:contain;image-rendering:pixelated">` +
            `</body></html>`
        );
        return;
      }
      res.writeHead(200, {
        "Content-Type": "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-store",
      });
      let closed = false;
      const feed = this.frames(opts);
      const onClose = () => {
        closed = true;
        void feed.return(undefined);
      };
      res.on("close", onClose);
      (async () => {
        for await (const frame of feed) {
          if (closed || res.destroyed) return;
          res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
          res.write(frame);
          res.write("\r\n");
        }
      })().catch((err) => {
        if (!closed) {
          console.error("[live] feed stopped:", err.message);
          res.destroy();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, resolve);
    });
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : port;
    return new LiveFeed(server, actualPort);
  }
}

export class LiveFeed {
  readonly port: number;
  /** Viewer page URL — open in any browser. */
  readonly url: string;
  /** Raw MJPEG stream URL — usable from ffplay/curl/agents. */
  readonly streamUrl: string;
  private readonly server: ReturnType<typeof createServer>;

  constructor(server: ReturnType<typeof createServer>, port: number) {
    this.server = server;
    this.port = port;
    this.url = `http://localhost:${port}/`;
    this.streamUrl = `http://localhost:${port}/feed`;
  }

  /** Stop the HTTP server and free the port. */
  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

export const computer = new Desktop();
export default computer;