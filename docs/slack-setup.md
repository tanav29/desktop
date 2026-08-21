# Slack Integration Setup

This connects your desktop agent to Slack so the CEO can just @mention the bot
in a channel and the agent does the work, posts a summary, opens a PR, and
sends a recording.

There are two ways to configure credentials — pick one:

- **Web UI (easiest):** click **slack** in the app's chat header, paste your
  Bot Token + Signing Secret, hit *save & verify*. Credentials are validated
  against Slack's `auth.test` before saving, stored in `web/.slack-config.json`
  (gitignored), and apply immediately — no restart. Saved values override env
  vars; "remove saved" falls back to env.
- **Environment variables:** set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`
  in `web/.env` (or your deployment's environment) and follow the manual steps
  below.

Either way you still need to create the Slack app once (steps 1–5 below) to
get a token, secret, and webhook subscription.


## How it works

```
CEO types in Slack:
  @eve fix the login bug on github.com/myorg/myrepo

  ↓  Slack Events API → /eve/v1/slack webhook

  ↓  eve slackChannel receives the mention, dispatches a turn

  ↓  Agent runs on the desktop: clone repo → fix → test → commit → PR

  ↓  Recording hook captures desktop frames throughout

  ↓  On session completion:
       - Summary posted to the Slack thread
       - PR link posted to the Slack thread
       - Recording video uploaded to the Slack thread
```

## 1. Create the Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name it `eve` (or whatever you like), pick your workspace

## 2. Configure OAuth scopes

Under **OAuth & Permissions** → **Bot Token Scopes**, add:

| Scope | Why |
|---|---|
| `app_mentions:read` | Bot sees when it's @mentioned |
| `chat:write` | Bot posts replies, summaries, PR links |
| `im:history` | Bot reads DMs (optional: for DM-triggered runs) |
| `files:read` | Bot downloads inbound attachments (optional) |
| `files:write` | Bot uploads recording videos + live progress screenshots |
| `channels:history` | Bot reads thread replies for context in public channels |

Private channels additionally need `groups:history`. Without a history scope
the channel still answers mentions — it just can't load earlier thread
messages as context.

## 3. Enable Event Subscriptions

Under **Event Subscriptions**:

1. Toggle **Enable Events** to On
2. **Request URL**: `https://<your-public-host>/eve/v1/slack`
   - For local dev: use a tunnel like `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`
   - For production: your deployed URL
3. **Subscribe to bot events**:
   - `app_mention` (required — triggers on @mention in channels)
   - `message.im` (optional — triggers on DMs to the bot)

> **Running on localhost?** Slack must be able to reach your app over public
> HTTPS, so a direct `http://localhost:3000` URL will fail verification. Start
> a tunnel first — it gives you a public `https://…` URL that forwards to your
> local port:
>
> ```bash
> ngrok http 3000
> # or
> cloudflared tunnel --url http://localhost:3000
> ```
>
> Then set the Request URL to `<tunnel-url>/eve/v1/slack`. The settings dialog
> detects localhost automatically and shows these commands with your actual
> port; when the app runs on a public host it shows the exact webhook URL with
> click-to-copy instead.

## 4. Enable Interactivity (optional — HITL buttons)

If you want human-in-the-loop prompts rendered as Slack buttons and modals,
under **Interactivity & Shortcuts** toggle On and set the **Request URL** to
the same `https://<your-public-host>/eve/v1/slack`. Without this, approvals
still work through the web UI but not as Slack buttons.

## 5. Install and get tokens

1. Click **Install to Workspace**
2. Copy the **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`
3. Under **Basic Information** → **Signing Secret** → `SLACK_SIGNING_SECRET`

## 6. Set environment variables

```bash
cp .env.example .env
# Fill in:
#   SLACK_BOT_TOKEN=xoxb-...
#   SLACK_SIGNING_SECRET=...
#   GH_TOKEN=ghp_...  (GitHub PAT for GitHub API / git auth in the container)
```

## 7. Invite the bot to a channel

In Slack, go to the channel where you want the agent to work and:
```
/invite @eve
```

## 8. Use it

```
@eve clone github.com/myorg/api and fix the typo in src/handler.py, open a PR
@eve open the dashboard and take a screenshot
@eve write a python script that lists all S3 buckets and run it
```

The agent will:
- Acknowledge in the thread
- Post live progress as it works — every tool action appears in the thread
  (`:terminal: **working** — cmd \`pgrep -f xfce4-session\``), with a fresh
  desktop screenshot attached every ~25 s
- Work visibly on the desktop
- Post a summary + PR link when done
- Upload a recording of the session

## Live progress feed

`web/agent/channels/slack.ts` overrides the channel's `actions.requested`
event to stream eve's actions into the thread while she works:

- Every action batch becomes a progress post — tool name plus its most
  telling argument, e.g. `create_app chromium https://example.com`.
- A desktop screenshot (captured through the daemon's `/api/screenshot`) is
  attached at most once every 25 s so the thread stays light.
- Posts are throttled to one per 5 s; between posts the Slack typing status
  mirrors the latest action instead.
- Everything is best-effort: a failed post or upload logs a warning and
  never fails the agent's turn.

Tune the cadence with env vars:

| Var | Default | What it controls |
|---|---|---|
| `SLACK_PROGRESS_POST_MS` | `5000` | Min time between progress posts |
| `SLACK_PROGRESS_SHOT_MS` | `25000` | Min time between attached screenshots |

## Architecture

The Slack channel is defined in `web/agent/channels/slack.ts` using eve's native
`slackChannel()`. It handles webhook verification, mention dispatch, and event
routing automatically — no custom webhook code needed. An `actions.requested`
override adds the live progress feed (see above).

Credentials resolve at call time through `web/lib/slack-config.ts`: the
UI-managed `.slack-config.json` first, then `SLACK_BOT_TOKEN` /
`SLACK_SIGNING_SECRET`. Inbound webhooks are verified per-request with Slack's
v0 HMAC scheme against the current secret, so saving new credentials in the UI
takes effect without a restart. The settings API (`/api/settings/slack`) never
returns full secrets — only masked previews like `xoxb-…ABcd`.

The recording hook in `web/agent/hooks/recording.ts` captures desktop frames
throughout the session and compiles them into a video on completion, then
shares it to the session's Slack thread via Slack's current upload flow
(`files.getUploadURLExternal` → raw byte POST → `files.completeUploadExternal`
with `channel_id` + `thread_ts`) — the legacy `files.upload` method has been
retired by Slack. It resolves credentials through `resolveSlackCredentials()`,
so UI-saved values apply here too.

The git tools (`git_clone`, `git_commit`) in `web/agent/tools/` run `git`
commands inside the desktop container via the existing `computer.cmd()` daemon
API. The slim image has no `gh` CLI by design — create PRs from the host with
the GitHub web UI or API (`GH_TOKEN` is still injected into the container for
API/`curl` use).
