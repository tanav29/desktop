import {
  clearSavedConfig,
  maskToken,
  readSavedConfig,
  resolveSlackCredentials,
  writeSavedConfig,
} from "@/lib/slack-config";

export const dynamic = "force-dynamic";

interface SlackAuthTestResponse {
  ok: boolean;
  team?: string;
  team_id?: string;
  user?: string;
  bot_id?: string;
  error?: string;
}

/** Live-check a bot token against Slack. */
async function authTest(botToken: string): Promise<SlackAuthTestResponse> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${botToken}` },
    });
    return (await res.json()) as SlackAuthTestResponse;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Current Slack config status — masked, never returns full secrets. */
export async function GET() {
  const saved = await readSavedConfig();
  const effective = await resolveSlackCredentials();
  return Response.json({
    source: effective.source,
    saved: {
      botTokenMasked: maskToken(saved.botToken),
      signingSecretSet: Boolean(saved.signingSecret),
    },
    env: {
      botTokenSet: Boolean(process.env.SLACK_BOT_TOKEN),
      signingSecretSet: Boolean(process.env.SLACK_SIGNING_SECRET),
    },
    effective: {
      botTokenMasked: maskToken(effective.botToken),
      signingSecretSet: Boolean(effective.signingSecret),
    },
  });
}

/**
 * Save credentials from the settings dialog. Validates the bot token with
 * `auth.test` before saving; an invalid token is rejected so the UI never
 * silently stores broken credentials. Omitted/empty fields are left
 * unchanged — send `{ botToken: "", signingSecret: "" }` to clear.
 */
export async function POST(request: Request) {
  let body: { botToken?: string; signingSecret?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const nextBotToken = body.botToken?.trim() ?? "";
  const nextSecret = body.signingSecret?.trim() ?? "";

  // Validate the token that will be in effect after this save.
  const candidate = nextBotToken || (await resolveSlackCredentials()).botToken;
  let tested = false;
  let auth: SlackAuthTestResponse | null = null;
  if (candidate) {
    auth = await authTest(candidate);
    tested = true;
    if (!auth.ok) {
      return Response.json(
        { ok: false, tested: true, error: `Slack rejected the token: ${auth.error ?? "unknown error"}` },
        { status: 400 },
      );
    }
  }

  await writeSavedConfig({ botToken: nextBotToken, signingSecret: nextSecret });

  return Response.json({
    ok: true,
    tested,
    team: auth?.team ?? null,
    user: auth?.user ?? null,
    cleared: !nextBotToken && !nextSecret,
  });
}

/** Remove saved credentials; env vars take over again. */
export async function DELETE() {
  await clearSavedConfig();
  return Response.json({ ok: true });
}
