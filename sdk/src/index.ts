import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";

export interface DesktopOptions {
  /**
   * Which computer to control. Every computer runs its own daemon
   * (`daemon/daemon.py`) inside its container, published on a distinct host
   * port in docker-compose: 8095 = first, 8096 = second, ... Default 8095.
   */
  port?: number;
  /** Host running the daemon, default "localhost". */
  host?: string;
  /** Host path of the computer's mounted workspace, default "./workspace". */
  workspace?: string;
}

export interface CmdOptions {
  /** Kill the command after this many ms. Default 2 min. */
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
const DEFAULT_PORT = 8095;
const IN_CONTAINER_WORKSPACE = "/workspace";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ApiJson {
  status: number;
  json: any;
  text: string;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** HTTP client for a computer's daemon (daemon/daemon.py). */
class ApiClient {
  constructor(readonly baseUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/health`, {}, 1000);
      return res.ok;
    } catch {
      return false;
    }
  }

  async post(path: string, body: unknown, timeoutMs: number): Promise<ApiJson> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      timeoutMs
    );
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    if (!res.ok && !json) throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 500)}`);
    return { status: res.status, json, text };
  }

  async getBuffer(path: string, timeoutMs = 60_000): Promise<Buffer> {
    const res = await fetchWithTimeout(`${this.baseUrl}${path}`, {}, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${(await res.text()).slice(0, 500)}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

function genTitle(): string {
  return `worker-${randomBytes(3).toString("hex")}`;
}

function assertSafeTitle(title: string): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(title)) {
    throw new Error(`unsafe title (letters, digits, '.', '_', '-' only): ${JSON.stringify(title)}`);
  }
}

/**
 * Wrapper around a computer's in-container daemon. Pick the computer by port:
 * `new Desktop({ port: 8095 })` is computer #1, `{ port: 8096 }` is #2, etc.
 * No docker CLI involved — every call is one HTTP round-trip to the daemon.
 */
export class Desktop {
  /** Host port the computer's daemon is published on. */
  readonly port: number;
  /** Host the daemon runs on, default "localhost". */
  readonly host: string;
  /** Base URL of the computer's daemon, e.g. http://localhost:8095. */
  readonly baseUrl: string;
  /** Host path of the computer's mounted workspace. */
  readonly workspace: string;
  private readonly api: ApiClient;

  constructor(opts: DesktopOptions = {}) {
    this.port = opts.port ?? DEFAULT_PORT;
    this.host = opts.host ?? "localhost";
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.workspace = path.resolve(opts.workspace ?? "./workspace");
    this.api = new ApiClient(this.baseUrl);
  }

  /** POST to the daemon and throw on a non-zero command exit. Returns trimmed stdout. */
  private async postX(route: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    const { json } = await this.api.post(route, body, timeoutMs);
    const exit = json?.exit ?? 0;
    if (exit !== 0) {
      const note = (json?.stderr || json?.stdout || `exit ${exit}`).trim();
      throw new Error(`${route} failed [exit ${exit}]: ${note}`);
    }
    return String(json?.stdout ?? "");
  }

  /** Run a shell command inside the computer. Returns trimmed stdout. */
  async cmd(input: string, opts: CmdOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { json } = await this.api.post("/api/cmd", { cmd: input, timeoutMs }, timeoutMs);
    const exit = json?.exit ?? -1;
    if (exit !== 0) {
      const note = (json?.stderr || json?.stdout || `exit ${exit}`).trim();
      throw new Error(`cmd failed [exit ${exit}]: ${note}`);
    }
    return String(json?.stdout ?? "").trim();
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

    const full = `${command.trim()} ${flag}`.trim();
    const { json } = await this.api.post("/api/create", { command: full, title }, DEFAULT_TIMEOUT_MS);
    if (json?.error) throw new Error(`create failed: ${json.error}`);
    return title;
  }

  /** Kill every process whose command line or window title matches `title`. */
  async kill(title: string): Promise<void> {
    assertSafeTitle(title);
    await this.api.post("/api/kill", { title }, DEFAULT_TIMEOUT_MS);
  }

  /** Move the pointer to absolute screen coordinates (x, y). */
  async mouse(x: number, y: number): Promise<void> {
    await this.postX("/api/mouse", { x, y });
  }

  /**
   * Click a mouse button, optionally after moving to (x, y).
   * Buttons: 1 left, 2 middle, 3 right, 4/5 wheel.
   */
  async click(button = 1, x?: number, y?: number): Promise<void> {
    await this.postX("/api/click", { button, x, y });
  }

  /**
   * Type text into the currently focused window. The text travels in an env
   * var, so any character is safe (no shell quoting issues).
   */
  async type(text: string, opts: TypeOptions = {}): Promise<void> {
    const delayMs = Math.min(Math.max(opts.delayMs ?? 30, 0), 500);
    await this.postX("/api/type", { text, delayMs });
  }

  /** Send a key or modifier combo, e.g. "Return", "ctrl+shift+t", "Super_L". */
  async key(keys: string): Promise<void> {
    await this.postX("/api/key", { keys });
  }

  /** List visible window names on the desktop. */
  async windows(): Promise<string[]> {
    const { json } = await this.api.post("/api/windows", {}, DEFAULT_TIMEOUT_MS);
    return Array.isArray(json?.windows) ? json.windows.map(String) : [];
  }

  /** True when the computer's desktop is up. */
  async health(): Promise<boolean> {
    return this.api.health();
  }

  /**
   * Capture the desktop as PNG. The daemon writes the file into the computer's
   * /workspace; returns the host-side path of the same mounted folder.
   */
  async screenshot(name = `shot-${Date.now()}.png`): Promise<string> {
    const file = path.extname(name) ? path.basename(name) : `${path.basename(name)}.png`;
    const { json } = await this.api.post("/api/screenshot", { name: file }, DEFAULT_TIMEOUT_MS);
    const exit = json?.exit ?? -1;
    if (exit !== 0) {
      throw new Error(`screenshot failed [exit ${exit}]: ${(json?.stderr ?? "").trim()}`);
    }
    return path.join(this.workspace, file);
  }

  /**
   * One scaled JPEG frame of the desktop (resize + recompress in the daemon)
   * plus base64 forms — the cheap way to feed the screen to a vision model.
   */
  async observe(opts: ObserveOptions = {}): Promise<ObserveResult> {
    const width = Math.max(0, Math.round(opts.width ?? 1152));
    const w = width > 0 ? Math.min(Math.max(width, 320), 1600) : 0;
    const quality = Math.min(Math.max(opts.quality ?? 60, 1), 95);
    const jpeg = await this.capture(quality, w);
    return {
      jpeg,
      base64: jpeg.toString("base64"),
      dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    };
  }

  /** One JPEG frame (resized when width>0) from the daemon. */
  private async capture(quality: number, width: number): Promise<Buffer> {
    return this.api.getBuffer(`/api/observe?quality=${quality}&width=${width}`);
  }

  /**
   * Live JPEG frames of the desktop as an async generator — the daemon
   * captures the X framebuffer and recompresses to JPEG per frame
   * (~150-300 ms each, so fps above ~4 doesn't gain much). Stops when the
   * generator is returned or closed.
   */
  async *frames(opts: LiveOptions = {}): AsyncGenerator<Buffer> {
    const fps = Math.min(Math.max(opts.fps ?? 4, 1), 10);
    const quality = Math.min(Math.max(opts.quality ?? 70, 1), 95);
    while (true) {
      const frame = await this.capture(quality, 0);
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