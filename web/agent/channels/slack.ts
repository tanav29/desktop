import { slackChannel } from "eve/channels/slack";
import { computer } from "@/lib/computer";
import { readFile } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveSlackCredentials } from "@/lib/slack-config";

/**
 * Slack channel — the CEO's command interface, with a live progress feed.
 *
 * Eve's native slackChannel() handles:
 *   - webhook signature verification (SLACK_SIGNING_SECRET)
 *   - app_mention dispatch (the bot responds when @mentioned in a channel)
 *   - direct message dispatch (DMs to the bot)
 *   - interactive payload handling (buttons, modals for HITL approvals)
 *
 * On top of that, this channel overrides `actions.requested` to post every
 * model action into the thread as it happens — "cmd pgrep -f xfce4-session",
 * "create_app chromium …" — and attaches a fresh desktop screenshot at most
 * once every SHOT_INTERVAL_MS, so the CEO watches the work happen in Slack
 * itself, not just in the web UI's live pane.
 *
 * Posting is throttled (POST_INTERVAL_MS): bursts of tool calls coalesce
 * into the typing status instead of spamming the thread. Everything here is
 * best-effort — a failed post or upload logs a warning and never fails the
 * agent's turn.
 *
 * Slack app setup: see docs/slack-setup.md.
 */

const POST_INTERVAL_MS = Number(process.env.SLACK_PROGRESS_POST_MS ?? 5_000);
const SHOT_INTERVAL_MS = Number(process.env.SLACK_PROGRESS_SHOT_MS ?? 25_000);

// Per-process throttle state. Reset on cold start; fine for the dev runtime.
let lastPostAt = 0;
let lastShotAt = 0;

/** Longest argument string shown per action. */
const MAX_ARG_LEN = 72;

function truncate(text: string, max = MAX_ARG_LEN): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Pick the most telling string out of a tool's input object. */
function describeInput(input: Record<string, unknown>): string {
  const preferred = [
    "cmd", "command", "text", "keys", "name", "title",
    "path", "url", "repoUrl", "query", "pattern", "message",
  ];
  for (const key of preferred) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return truncate(value);
  }
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim()) return truncate(value);
  }
  if (typeof input.x === "number" && typeof input.y === "number") {
    return `(${input.x}, ${input.y})`;
  }
  return "";
}

type ActionLike = {
  kind?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  name?: string;
  description?: string;
};

/** One human-readable line per requested action, e.g. `cmd pgrep -f xfce4-session`. */
function actionLabel(action: ActionLike): string {
  if (action.kind === "tool-call" && action.toolName) {
    const arg = describeInput(action.input ?? {});
    return arg ? `${action.toolName} \`${arg}\`` : `\`${action.toolName}\``;
  }
  const label = action.name ?? action.description ?? "action";
  const detail = action.description ? truncate(action.description) : "";
  return detail ? `${label} — ${detail}` : label;
}

const TOOL_EMOJI: Record<string, string> = {
  cmd: ":terminal:",
  bash: ":terminal:",
  create_app: ":rocket:",
  kill_app: ":skull_and_crossbones:",
  screenshot: ":camera_with_flash:",
  observe: ":eyes:",
  inspect_desktop: ":eyes:",
  click: ":computer_mouse:",
  mouse: ":computer_mouse:",
  type_text: ":keyboard:",
  key: ":keyboard:",
  git_clone: ":arrow_down:",
  git_commit: ":bookmark:",
  read_file: ":page_facing_up:",
  write_file: ":memo:",
  grep: ":magnifying_glass_tilted_left:",
  glob: ":file_folder:",
};

function emojiFor(actions: readonly ActionLike[]): string {
  for (const action of actions) {
    const emoji = action.kind === "tool-call" ? TOOL_EMOJI[action.toolName ?? ""] : undefined;
    if (emoji) return emoji;
  }
  return ":gear:";
}

/**
 * Grab a fresh JPEG of the desktop for attaching to the progress post.
 * Returns null on any failure — screenshots are garnish, not the meal.
 */
async function captureDesktop(): Promise<{ filename: string; data: Uint8Array; title: string } | null> {
  try {
    const filename = `slack-${Date.now()}.jpg`;
    const hostPath = await computer.screenshot(filename);
    const buffer = await readFile(hostPath);
    return { filename, data: new Uint8Array(buffer), title: "Live desktop" };
  } catch (err) {
    console.warn(`[slack-progress] screenshot skipped: ${(err as Error).message}`);
    return null;
  }
}

/** Reject timestamps older/newer than 5 minutes, per Slack's recommendation. */
const SLACK_MAX_SKEW_SECONDS = 60 * 5;

/**
 * Slack's v0 signature scheme against the *current* signing secret. Runs on
 * every inbound webhook, so saving a new secret in the settings UI takes
 * effect immediately.
 */
async function verifySignature(request: Request, body: string): Promise<boolean> {
  const { signingSecret } = await resolveSlackCredentials();
  if (!signingSecret) return false;

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!timestamp || !signature?.startsWith("v0=")) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > SLACK_MAX_SKEW_SECONDS) return false;

  const mac = createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex");
  const expected = Buffer.from(`v0=${mac}`, "utf8");
  const received = Buffer.from(signature, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export default slackChannel({
  // Credentials resolve at call time from the UI-managed store
  // (.slack-config.json), falling back to env vars — so saving in the web
  // UI applies without a restart.
  credentials: {
    // Empty string when unset — outbound calls fail loudly, same as before.
    botToken: async () => (await resolveSlackCredentials()).botToken ?? "",
    webhookVerifier: (request, body) => verifySignature(request, body),
  },

  // Carry earlier thread messages as context so the agent sees the conversation.
  threadContext: {
    since: "thread-root",
  },

  events: {
    /**
     * Live progress feed. Replaces the default typing-indicator-only
     * handler: each action batch becomes a threaded progress post (with a
     * periodic desktop screenshot attached), and the typing status always
     * mirrors the latest action so quiet stretches still feel alive.
     */
    "actions.requested": async (event, channel) => {
      const actions = event.actions as readonly ActionLike[];
      const labels = actions.map((action) => actionLabel(action));
      if (labels.length === 0) return;

      const status = labels.join(" · ");
      // Never let progress posting break the turn.
      try {
        await channel.thread.startTyping(status);
      } catch {
        /* indicator is best-effort */
      }

      const now = Date.now();
      if (now - lastPostAt < POST_INTERVAL_MS) return;
      lastPostAt = now;

      const attachShot = now - lastShotAt >= SHOT_INTERVAL_MS;
      if (attachShot) lastShotAt = now;

      const files = attachShot ? await captureDesktop() : null;
      const shotSuffix = files ? "\n_Desktop screenshot attached ⤵_" : "";

      try {
        await channel.thread.post({
          markdown: `${emojiFor(actions)} **working** — ${status}${shotSuffix}`,
          ...(files ? { files: [files] } : {}),
        });
      } catch (err) {
        console.warn(`[slack-progress] post failed: ${(err as Error).message}`);
      }
    },
  },
});
