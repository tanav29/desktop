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
  /** HTTP port for the MJPEG stream, default 8090 */
  port?: number;
  /** Frames per second (1-10), default 4 */
  fps?: number;
  /** JPEG quality (1-95), default 70 */
  quality?: number;
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
    return new LiveFeed(server, port);
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