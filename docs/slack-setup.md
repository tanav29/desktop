# Slack Integration Setup

This connects your desktop agent to Slack so the CEO can just @mention the bot
in a channel and the agent does the work, posts a summary, opens a PR, and
sends a recording.

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
| `files:write` | Bot uploads recording videos |
| `im:history` | Bot reads DMs (optional: for DM-triggered runs) |

## 3. Enable Event Subscriptions

Under **Event Subscriptions**:

1. Toggle **Enable Events** to On
2. **Request URL**: `https://<your-public-host>/eve/v1/slack`
   - For local dev: use a tunnel like `ngrok http 3000` or `cloudflared tunnel`
   - For production: your deployed URL
3. **Subscribe to bot events**:
   - `app_mention` (required — triggers on @mention in channels)
   - `message.im` (optional — triggers on DMs to the bot)

## 4. Install and get tokens

1. Click **Install to Workspace**
2. Copy the **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`
3. Under **Basic Information** → **Signing Secret** → `SLACK_SIGNING_SECRET`

## 5. Set environment variables

```bash
cp .env.example .env
# Fill in:
#   SLACK_BOT_TOKEN=xoxb-...
#   SLACK_SIGNING_SECRET=...
#   GH_TOKEN=ghp_...  (GitHub PAT for GitHub API / git auth in the container)
```

## 6. Invite the bot to a channel

In Slack, go to the channel where you want the agent to work and:
```
/invite @eve
```

## 7. Use it

```
@eve clone github.com/myorg/api and fix the typo in src/handler.py, open a PR
@eve open the dashboard and take a screenshot
@eve write a python script that lists all S3 buckets and run it
```

The agent will:
- Acknowledge in the thread
- Work visibly on the desktop
- Post a summary + PR link when done
- Upload a recording of the session

## Architecture

The Slack channel is defined in `web/agent/channels/slack.ts` using eve's native
`slackChannel()`. It handles webhook verification, mention dispatch, and event
routing automatically — no custom webhook code needed.

The recording hook in `web/agent/hooks/recording.ts` captures desktop frames
throughout the session and compiles them into a video on completion, then
uploads it to Slack via `files.upload`.

The git tools (`git_clone`, `git_commit`) in `web/agent/tools/` run `git`
commands inside the desktop container via the existing `computer.cmd()` daemon
API. The slim image has no `gh` CLI by design — create PRs from the host with
the GitHub web UI or API (`GH_TOKEN` is still injected into the container for
API/`curl` use).
