import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";

// ---------------------------------------------------------------------------
// Options & result types
// ---------------------------------------------------------------------------

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

export interface ExecResult {
  exit: number;
  stdout: string;
  stderr: string;
  durationMs?: number;
}

export interface CreateOptions {
  /** Unique worker id. Defaults to `worker-<random>`. Used by kill(). */
  title?: string;
  /** Wait up to this many ms for the window to appear after launch. Default 0 (no wait). */
  waitMs?: number;
  /** Alias for waitMs */
  waitForMs?: number;
}

export interface CreateResult {
  pid: number;
  log: string;
  title: string;
  command: string;
  startedAt: number;
  windowFound: boolean;
  meta: string;
}

export interface KillOptions {
  /** "auto" (TERM then KILL), "term" only, "kill" immediate. Default "auto". */
  signal?: "auto" | "term" | "kill";
  /** How long to wait after TERM before escalating, ms. Default 2000. */
  waitMs?: number;
  /** Remove the worker's /workspace/.workers/<title> dir after kill. Default false. */
  clean?: boolean;
}

export interface KillResult {
  ok: boolean;
  title: string;
  killed: boolean;
  pidsKilled: number[];
  pidsBefore: number[];
  pidsAfter: number[];
  windowsKilled: number;
  windowsBefore: number;
  windowsAfter: number;
  aliveAfter: boolean;
  signal: string;
  waitMs: number;
  logTail: string;
  cleaned: boolean;
  reason?: string;
}

export interface KillAllOptions {
  /** Only kill workers whose title starts with this prefix. Default "" (all). */
  prefix?: string;
  /** Clean worker dirs after kill. Default false. */
  clean?: boolean;
}

export interface KillAllResult {
  ok: boolean;
  killed: string[];
  failed: Array<{ title: string; reason: string; detail?: any }>;
  count: number;
  total: number;
  cleaned: boolean;
  details: KillResult[];
}

export interface WorkerInfo {
  title: string;
  pid: number;
  pids: number[];
  alive: boolean;
  command: string;
  startedAt: number;
  log: string;
  logBytes: number;
  windowFound: boolean;
  windowIds: string[];
}

export interface InfoResult {
  ok: boolean;
  version: string;
  display: string;
  resolution: string;
  displayOk: boolean;
  uptime: number;
  startedAt: number;
  workers: number;
  workersAlive: number;
  workspace: string;
  pid: number;
  pointer: [number, number];
  focused: string;
  diskFree: number;
  diskTotal: number;
  memTotal: number;
  memAvailable: number;
}

export interface PsResult {
  processes: Array<{ pid: number; ppid: number; etime: string; pcpu: string; pmem: string; cmd: string }>;
  windows: Array<{ id: string; name: string; pid: number; geometry: string }>;
  workers: WorkerInfo[];
  at: number;
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

/**
 * One step in an input sequence. `actions()` runs a whole list of these in a
 * single HTTP round-trip, which is the difference between one network hop per
 * *task* and one per keystroke.
 *
 * Coordinates are absolute pixels on the framebuffer (1600x900 by default).
 */
export type Action =
  /** Move the pointer. */
  | { do: "move"; x: number; y: number }
  /** Click a button (1 left, 2 middle, 3 right), optionally moving there first. */
  | { do: "click"; x?: number; y?: number; button?: number; count?: number }
  /** Press at (x1,y1), move to (x2,y2), release. */
  | { do: "drag"; x1: number; y1: number; x2: number; y2: number; button?: number }
  /** Wheel scroll, optionally over a specific point. */
  | { do: "scroll"; dir: "up" | "down"; amount?: number; x?: number; y?: number }
  /** Type text into the focused window, one keystroke at a time. */
  | { do: "type"; text: string; delayMs?: number }
  /** Send a keysym or combo, e.g. "Return", "ctrl+shift+t". Space-separated for a run of keys. */
  | { do: "key"; keys: string; count?: number }
  /** Put text on the clipboard and press ctrl+v — far faster than typing for long text. */
  | { do: "paste"; text: string }
  /** Activate the first visible window whose title matches (regex). */
  | { do: "focus"; window: string }
  /** Pause. */
  | { do: "wait"; ms: number }
  /** Block until a window title appears, or fail on timeout. */
  | { do: "wait_for"; window: string; timeoutMs?: number };

export interface ActionStep {
  /** Index in the submitted list. */
  i: number;
  do: Action["do"] | null;
  ok: boolean;
  /** Failure reason, or absent on success. */
  note?: string;
}

export interface ActionsResult {
  /** True when every action succeeded. */
  ok: boolean;
  /** How many actions ran — the sequence stops at the first failure. */
  ran: number;
  steps: ActionStep[];
  /** Index of the action that failed. Absent when `ok` is true. */
  failedAt?: number;
  /** Desktop state after the sequence, so a caller can skip a follow-up probe. */
  state: { pointer: [number, number]; focused: string };
}

export interface PointerState {
  x: number;
  y: number;
  /** The most recent click this daemon performed, or null if there hasn't been one. */
  click: { x: number; y: number; button: number; at: number } | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_PORT = 8095;
const IN_CONTAINER_WORKSPACE = "/workspace";
/** Matches MAX_ACTIONS in daemon/daemon.py — rejected client-side for a clearer error. */
const MAX_ACTIONS = 32;
/** The daemon caps a sequence at 120s; leave room for the round-trip itself. */
const ACTIONS_TIMEOUT_MS = 135_000;
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
      const res = await fetchWithTimeout(`${this.baseUrl}/api/health`, {}, 1500);
      return res.ok;
    } catch {
      return false;
    }
  }

  async healthDetailed(): Promise<any> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/info`, {}, 3000);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { ok: res.ok, text };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
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

  async getJson(path: string, timeoutMs = 5_000): Promise<any> {
    const res = await fetchWithTimeout(`${this.baseUrl}${path}`, {}, timeoutMs);
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    if (!res.ok && !json) throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 500)}`);
    return json;
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
 *
 * This is the "best" SDK surface: every daemon capability has a typed helper,
 * kill paths are verified and report what they actually killed, and multi-
 * computer orchestration is built-in without shelling out to docker.
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

  // -------------------------------------------------------------------------
  // Core shell
  // -------------------------------------------------------------------------

  /** Run a shell command inside the computer. Returns trimmed stdout. Throws on non-zero exit. */
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

  /** Structured exec — same as cmd but returns {exit, stdout, stderr} without throwing. */
  async exec(input: string, opts: CmdOptions = {}): Promise<ExecResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { json } = await this.api.post("/api/cmd", { cmd: input, timeoutMs }, timeoutMs);
    return {
      exit: Number(json?.exit ?? -1),
      stdout: String(json?.stdout ?? ""),
      stderr: String(json?.stderr ?? ""),
      durationMs: json?.durationMs,
    };
  }

  // -------------------------------------------------------------------------
  // App lifecycle — create / kill / workers / ps / open
  // -------------------------------------------------------------------------

  /**
   * Launch a detached app on the desktop. Appends a unique CLI flag so the
   * title appears in the process command line and kill(title) can find it:
   * xterm -> -title <t>, chromium -> --user-data-dir (inside the container's
   * /workspace, so it persists on the host), anything else -> --title=<t>.
   * Already-titled commands are used as-is unless a different opts.title
   * forces a new flag. Returns the title.
   */
  async create(command: string, opts: CreateOptions = {}): Promise<string> {
    const result = await this.spawn(command, opts);
    return result.title;
  }

  /**
   * Like create() but returns the full daemon report (pid, log, windowFound...).
   * Use when you need the pid or want to wait for the window.
   */
  async spawn(command: string, opts: CreateOptions = {}): Promise<CreateResult> {
    const existing =
      command.match(/--(?:title|user-data-dir)=([^\s]+)/) ??
      command.match(/^-title\s+([^\s]+)/);
    const title = opts.title ?? existing?.[1] ?? genTitle();
    assertSafeTitle(title);

    const app = command.trim().split(/\s+/)[0];
    let full = command.trim();
    if (!(existing && existing[1] === title)) {
      if (app.includes("chrom")) {
        full += ` --user-data-dir=${IN_CONTAINER_WORKSPACE}/.workers/${title}`;
      } else if (app === "xterm") {
        // xterm's -e swallows every argument after it, so the title flag has
        // to be injected directly after the binary name instead of appended.
        full = full.replace(/^\S+/, (bin) => `${bin} -title ${title}`);
      } else {
        // Generic: append as a bash comment so it appears in `ps` / `pkill -f`
        // but never breaks the real command (e.g. `sleep 5 --title=foo` would
        // fail because sleep doesn't know --title). The daemon's kill() matches
        // both the pgrep pattern and the meta pid, so this is searchable and safe.
        // Use ` # title` — bash ignores everything after `#` on the same line.
        if (full.includes("#")) {
          // avoid nesting comments — use a no-op builtin instead
          full += ` ; : ${title}`;
        } else {
          full += ` # ${title}`;
        }
      }
    }
    const waitMs = opts.waitMs ?? opts.waitForMs ?? 0;
    const { json, status } = await this.api.post(
      "/api/create",
      { command: full, title, waitMs },
      DEFAULT_TIMEOUT_MS
    );
    if (status === 409) {
      throw new Error(`create failed: title '${title}' already running (use kill() first or pick a new title)`);
    }
    if (json?.error) throw new Error(`create failed: ${json.error}`);
    return {
      pid: Number(json?.pid ?? 0),
      log: String(json?.log ?? ""),
      title: String(json?.title ?? title),
      command: String(json?.command ?? full),
      startedAt: Number(json?.startedAt ?? Date.now() / 1000),
      windowFound: Boolean(json?.windowFound),
      meta: String(json?.meta ?? ""),
    };
  }

  /** Launch a URL in Chromium. Shorthand for create(`chromium <url>`, {title}). */
  async open(url: string, opts: CreateOptions = {}): Promise<string> {
    const title = opts.title ?? `web-${randomBytes(2).toString("hex")}`;
    assertSafeTitle(title);
    // ensure url has scheme
    const safeUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return this.create(`chromium ${safeUrl}`, { title, ...opts });
  }

  /**
   * Kill every process whose command line or window title matches `title`.
   * Now verified: TERM then KILL, windowkill sweep, and a report of what died.
   * Returns a KillResult — callers that previously ignored the return value still work.
   */
  async kill(title: string, opts: KillOptions = {}): Promise<KillResult> {
    assertSafeTitle(title);
    const body: any = { title };
    if (opts.signal) body.signal = opts.signal;
    if (opts.waitMs !== undefined) body.waitMs = opts.waitMs;
    if (opts.clean !== undefined) body.clean = opts.clean;
    const { json } = await this.api.post("/api/kill", body, DEFAULT_TIMEOUT_MS);
    if (json?.error) throw new Error(`kill failed: ${json.error}`);
    // daemon returns the detailed report directly
    return json as KillResult;
  }

  /** Alias for kill() — reads better when closing a browser tab. */
  async close(title: string, opts: KillOptions = {}): Promise<KillResult> {
    return this.kill(title, opts);
  }

  /**
   * Kill all workers (or those with a title prefix). The "nuke" for the desktop.
   * Returns which titles were killed and which (if any) survived.
   */
  async killAll(opts: KillAllOptions = {}): Promise<KillAllResult> {
    const body: any = {};
    if (opts.prefix) body.prefix = opts.prefix;
    if (opts.clean !== undefined) body.clean = opts.clean;
    const { json } = await this.api.post("/api/killAll", body, DEFAULT_TIMEOUT_MS);
    if (json?.error) throw new Error(`killAll failed: ${json.error}`);
    return json as KillAllResult;
  }

  /** Kill all workers and clean their dirs — full reset of the app layer. */
  async nuke(opts: { prefix?: string } = {}): Promise<KillAllResult> {
    return this.killAll({ prefix: opts.prefix, clean: true });
  }

  /** Remove dead worker dirs (GC). No effect on running workers. */
  async clean(): Promise<{ ok: boolean; removed: string[]; count: number }> {
    const { json } = await this.api.post("/api/system", { action: "clean" }, DEFAULT_TIMEOUT_MS);
    return json;
  }

  /**
   * Soft-reset the computer: kill all workers (clean) and optionally clear
   * transient workspace files. The container itself stays up.
   */
  async reset(opts: { cleanWorkspace?: boolean } = {}): Promise<any> {
    const { json } = await this.api.post(
      "/api/system",
      { action: "reset", cleanWorkspace: !!opts.cleanWorkspace },
      DEFAULT_TIMEOUT_MS
    );
    return json;
  }

  /** List all workers known to the daemon (alive or dead) with full status. */
  async workers(): Promise<WorkerInfo[]> {
    const json = await this.api.getJson("/api/workers");
    if (Array.isArray(json?.workers)) return json.workers as WorkerInfo[];
    // fallback: POST variant
    const { json: j2 } = await this.api.post("/api/workers", {}, DEFAULT_TIMEOUT_MS);
    return Array.isArray(j2?.workers) ? (j2.workers as WorkerInfo[]) : [];
  }

  /** Alias for workers() */
  async list(): Promise<WorkerInfo[]> {
    return this.workers();
  }

  /** Process + window snapshot — the daemon's `ps` for the desktop. */
  async ps(): Promise<PsResult> {
    try {
      const json = await this.api.getJson("/api/ps");
      if (json?.processes) return json as PsResult;
    } catch {
      /* fallback to POST */
    }
    const { json } = await this.api.post("/api/ps", {}, DEFAULT_TIMEOUT_MS);
    return json as PsResult;
  }

  // -------------------------------------------------------------------------
  // Input — actions is the one true control surface
  // -------------------------------------------------------------------------

  /**
   * Run a sequence of input actions in ONE round-trip. This is the primitive
   * every other input method here is built on, and the one to reach for when
   * driving a desktop over a network: a click-type-Enter flow costs one HTTP
   * hop instead of three.
   *
   * The sequence stops at the first failing action — later actions are not
   * attempted, since they were written assuming the earlier ones worked. The
   * result says which index failed and why, and reports the pointer position
   * and focused window afterwards so the caller usually needs no follow-up probe.
   *
   * ```ts
   * await computer.actions([
   *   { do: "wait_for", window: "Chromium" },
   *   { do: "focus", window: "Chromium" },
   *   { do: "click", x: 640, y: 61 },
   *   { do: "type", text: "example.com" },
   *   { do: "key", keys: "Return" },
   * ]);
   * ```
   */
  async actions(list: Action[], opts: CmdOptions = {}): Promise<ActionsResult> {
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error("actions() needs at least one action");
    }
    if (list.length > MAX_ACTIONS) {
      throw new Error(`actions() takes at most ${MAX_ACTIONS} actions per call (got ${list.length})`);
    }
    const timeoutMs = opts.timeoutMs ?? ACTIONS_TIMEOUT_MS;
    const { json } = await this.api.post("/api/actions", { actions: list }, timeoutMs);
    if (json?.error) throw new Error(`actions failed: ${json.error}`);
    return json as ActionsResult;
  }

  /**
   * actions() that throws on the first failure — the shape the single-action
   * helpers below want, since they have no result worth returning.
   */
  private async act(...list: Action[]): Promise<ActionsResult> {
    const result = await this.actions(list);
    if (!result.ok) {
      const step = result.steps[result.failedAt ?? result.steps.length - 1];
      throw new Error(`${step?.do ?? "action"} failed: ${step?.note ?? "unknown error"}`);
    }
    return result;
  }

  /** Where the pointer is, plus the last click this daemon performed. */
  async pointer(): Promise<PointerState> {
    const json = await this.api.getJson("/api/pointer");
    return {
      x: Number(json?.x ?? 0),
      y: Number(json?.y ?? 0),
      click: json?.click ?? null,
    };
  }

  /** Move the pointer to absolute screen coordinates (x, y). */
  async mouse(x: number, y: number): Promise<void> {
    await this.act({ do: "move", x, y });
  }

  /**
   * Click a mouse button, optionally after moving to (x, y).
   * Buttons: 1 left, 2 middle, 3 right, 4/5 wheel.
   */
  async click(button = 1, x?: number, y?: number): Promise<void> {
    await this.act({ do: "click", button, x, y });
  }

  /** Press at (x1, y1), drag to (x2, y2), release. */
  async drag(x1: number, y1: number, x2: number, y2: number, button = 1): Promise<void> {
    await this.act({ do: "drag", x1, y1, x2, y2, button });
  }

  /** Wheel-scroll `amount` notches, optionally over a specific point. */
  async scroll(dir: "up" | "down", amount = 3, x?: number, y?: number): Promise<void> {
    await this.act({ do: "scroll", dir, amount, x, y });
  }

  /**
   * Type text into the currently focused window. The text travels in an env
   * var, so any character is safe (no shell quoting issues).
   */
  async type(text: string, opts: TypeOptions = {}): Promise<void> {
    const delayMs = Math.min(Math.max(opts.delayMs ?? 30, 0), 500);
    await this.act({ do: "type", text, delayMs });
  }

  /**
   * Put text on the clipboard and press ctrl+v. Near-instant regardless of
   * length, unlike type() — but it needs an app that honours ctrl+v, and it
   * clobbers whatever was on the clipboard.
   */
  async paste(text: string): Promise<void> {
    await this.act({ do: "paste", text });
  }

  /** Send a key or modifier combo, e.g. "Return", "ctrl+shift+t", "Super_L". */
  async key(keys: string): Promise<void> {
    await this.act({ do: "key", keys });
  }

  /** Activate the first visible window whose title matches `window` (a regex). */
  async focus(window: string): Promise<void> {
    await this.act({ do: "focus", window });
  }

  /** Block until a window title appears. Throws on timeout. */
  async waitFor(window: string, timeoutMs = 15_000): Promise<void> {
    await this.act({ do: "wait_for", window, timeoutMs });
  }

  /** List visible window names on the desktop. */
  async windows(opts: { detailed?: boolean } = {}): Promise<string[]> {
    if (opts.detailed) {
      const json = await this.api.getJson("/api/windows?detail=1");
      // return names for backward compat when detailed requested? expose via windowsDetailed()
      return Array.isArray(json?.names) ? json.names.map(String) : Array.isArray(json?.windows) ? json.windows.map((w: any) => String(w.name ?? w)) : [];
    }
    const { json } = await this.api.post("/api/windows", {}, DEFAULT_TIMEOUT_MS);
    return Array.isArray(json?.windows) ? json.windows.map(String) : [];
  }

  /** Detailed windows with id, pid, geometry. */
  async windowsDetailed(): Promise<Array<{ id: string; name: string; pid: number; geometry: string }>> {
    const json = await this.api.getJson("/api/windows?detail=1");
    if (Array.isArray(json?.windows) && json.windows.length && typeof json.windows[0] === "object") {
      return json.windows;
    }
    // fallback via ps
    const snap = await this.ps();
    return snap.windows;
  }

  /** True when the computer's desktop is up. */
  async health(): Promise<boolean> {
    return this.api.health();
  }

  /** Detailed health including version, uptime, workers, mem, disk. */
  async healthDetailed(): Promise<InfoResult> {
    const json = await this.api.getJson("/api/info");
    if (json?.error) throw new Error(json.error);
    return json as InfoResult;
  }

  /** Alias for healthDetailed() — richer than the boolean health(). */
  async info(): Promise<InfoResult> {
    return this.healthDetailed();
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

  // -------------------------------------------------------------------------
  // Multi-computer helpers (port-based orchestration, no docker CLI required)
  // -------------------------------------------------------------------------

  /**
   * Check a list of ports for live computers. Returns a map of port -> alive.
   * Useful when you run several containers on 8095, 8096, ...
   */
  async healthMap(ports: number[]): Promise<Map<number, boolean>> {
    const results = await Promise.all(
      ports.map(async (p) => {
        const c = new Desktop({ host: this.host, port: p, workspace: this.workspace });
        return [p, await c.health()] as const;
      })
    );
    return new Map(results);
  }

  /** Ensure a worker exists — create it only if not already alive. Returns title. */
  async ensure(title: string, command: string, opts: Omit<CreateOptions, "title"> = {}): Promise<string> {
    assertSafeTitle(title);
    const workers = await this.workers();
    const existing = workers.find((w) => w.title === title && w.alive);
    if (existing) return title;
    return this.create(command, { ...opts, title });
  }

  /** Restart a worker: kill (clean false) then create again with same command. */
  async restartWorker(title: string, command?: string): Promise<string> {
    assertSafeTitle(title);
    const workers = await this.workers();
    const meta = workers.find((w) => w.title === title);
    const cmd = command ?? meta?.command;
    if (!cmd) throw new Error(`restartWorker: no command known for '${title}' — pass command explicitly`);
    await this.kill(title, { clean: false });
    // small settle
    await sleep(300);
    return this.create(cmd, { title });
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

/**
 * Multi-computer orchestration without docker. Each computer is just a port
 * (its daemon's publish). This helper probes a range of ports and gives you
 * live Desktop handles.
 */
export class Computers {
  /**
   * Probe ports and return live Desktop instances.
   * Default scans 8095..8099 and returns only those that respond to /api/health.
   */
  static async discover(opts: { host?: string; ports?: number[]; workspace?: string } = {}): Promise<Desktop[]> {
    const host = opts.host ?? "localhost";
    const ports = opts.ports ?? [8095, 8096, 8097, 8098, 8099];
    const workspace = opts.workspace;
    const checks = await Promise.all(
      ports.map(async (port) => {
        const d = new Desktop({ host, port, workspace });
        const alive = await d.health();
        return { d, alive };
      })
    );
    return checks.filter((c) => c.alive).map((c) => c.d);
  }

  /** Kill all workers on each of the given computers (optionally prefix-filtered). */
  static async killAll(
    computers: Desktop[],
    opts: KillAllOptions = {}
  ): Promise<Map<number, KillAllResult>> {
    const results = await Promise.all(
      computers.map(async (c) => {
        const res = await c.killAll(opts);
        return [c.port, res] as const;
      })
    );
    return new Map(results);
  }

  /** Nuke every worker on every discovered computer. */
  static async nukeAll(opts: { host?: string; ports?: number[] } = {}): Promise<Map<number, KillAllResult>> {
    const comps = await Computers.discover(opts);
    return Computers.killAll(comps, { clean: true });
  }
}

// Convenience alias — `Computer` is the same as `Desktop` (one computer = one desktop).
export type Computer = Desktop;
export const Computer = Desktop;

export const computer = new Desktop();
export default computer;
