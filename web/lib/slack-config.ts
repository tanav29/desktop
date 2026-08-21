import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Slack credential store for the web UI.
 *
 * The settings dialog saves credentials to `.slack-config.json` next to the
 * app (gitignored, 0600). The Slack channel resolves credentials through
 * `resolveSlackCredentials()` on every use, so saving from the UI takes
 * effect immediately — no restart. Saved values override env vars so the UI
 * is authoritative; env vars remain the fallback for headless setups.
 *
 * This is a single-user local tool: the file is plaintext by design, same
 * trust level as `.env`. The API never returns full secrets — only masks.
 */

const CONFIG_PATH = path.join(process.cwd(), ".slack-config.json");

export interface SlackConfig {
  botToken?: string;
  signingSecret?: string;
}

export type SlackConfigSource = "saved" | "env" | "none";

export async function readSavedConfig(): Promise<SlackConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      botToken:
        typeof parsed.botToken === "string" && parsed.botToken.trim()
          ? parsed.botToken.trim()
          : undefined,
      signingSecret:
        typeof parsed.signingSecret === "string" && parsed.signingSecret.trim()
          ? parsed.signingSecret.trim()
          : undefined,
    };
  } catch {
    return {};
  }
}

/** Saves the given fields; saving two empty fields removes the file. */
export async function writeSavedConfig(config: SlackConfig): Promise<void> {
  const clean: SlackConfig = {};
  if (config.botToken?.trim()) clean.botToken = config.botToken.trim();
  if (config.signingSecret?.trim()) clean.signingSecret = config.signingSecret.trim();

  if (!clean.botToken && !clean.signingSecret) {
    await unlink(CONFIG_PATH).catch(() => {});
    return;
  }
  await writeFile(CONFIG_PATH, `${JSON.stringify(clean, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function clearSavedConfig(): Promise<void> {
  await unlink(CONFIG_PATH).catch(() => {});
}

/**
 * Effective credentials right now: saved config first, env vars as fallback.
 * Called on every outbound Slack call and every inbound webhook, so UI
 * changes apply without restarting.
 */
export async function resolveSlackCredentials(): Promise<{
  botToken: string | undefined;
  signingSecret: string | undefined;
  source: SlackConfigSource;
}> {
  const saved = await readSavedConfig();
  const botToken = saved.botToken ?? process.env.SLACK_BOT_TOKEN ?? undefined;
  const signingSecret =
    saved.signingSecret ?? process.env.SLACK_SIGNING_SECRET ?? undefined;
  const source: SlackConfigSource =
    saved.botToken || saved.signingSecret
      ? "saved"
      : process.env.SLACK_BOT_TOKEN || process.env.SLACK_SIGNING_SECRET
        ? "env"
        : "none";
  return { botToken, signingSecret, source };
}

/** `xoxb-123-…-ABcd` → `xoxb-…ABcd` — safe to show in the UI. */
export function maskToken(token: string | undefined): string | null {
  if (!token) return null;
  const head = token.startsWith("xoxb-") ? "xoxb-" : token.slice(0, 4);
  return `${head}…${token.slice(-4)}`;
}
