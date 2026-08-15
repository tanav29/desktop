import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
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

const DEFAULT_TIMEOUT_MS = 120_000;
const IN_CONTAINER_WORKSPACE = "/workspace";

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
  if (!title || /['"\\`$;]/.test(title)) {
    throw new Error(`unsafe title: ${JSON.stringify(title)}`);
  }
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
   * terminal -> --title, chromium -> --user-data-dir, others -> --title.
   * Already-titled commands are used as-is. Returns the title.
   */
  async create(command: string, opts: CreateOptions = {}): Promise<string> {
    const existing = command.match(/--(?:title|user-data-dir)=([^\s]+)/);
    const title = opts.title ?? existing?.[1] ?? genTitle();
    assertSafeTitle(title);

    const flag = existing
      ? ""
      : command.split(/\s+/)[0].includes("chrom")
        ? `--user-data-dir=${this.workspace}/.workers/${title}`
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
        `pkill -f '${title}' || true; xdotool search --name '${title}' windowkill 2>/dev/null || true`,
      ],
      DEFAULT_TIMEOUT_MS
    );
  }

  /**
   * Capture the desktop as PNG. The file is written to the shared /workspace
   * and the returned path is the host-side location. Returns the host path.
   */
  async screenshot(name = `shot-${Date.now()}.png`): Promise<string> {
    if (!path.extname(name)) name += ".png";
    const remote = `${IN_CONTAINER_WORKSPACE}/${path.basename(name)}`;
    await docker(
      ["exec", this.container, "import", "-window", "root", "-display", this.display, remote],
      DEFAULT_TIMEOUT_MS
    );
    return path.join(this.workspace, name);
  }
}

export const computer = new Desktop();
export default computer;