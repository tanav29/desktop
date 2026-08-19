import { slackChannel } from "eve/channels/slack";

/**
 * Slack channel — the CEO's command interface.
 *
 * Eve's native slackChannel() handles:
 *   - webhook signature verification (SLACK_SIGNING_SECRET)
 *   - app_mention dispatch (the bot responds when @mentioned in a channel)
 *   - direct message dispatch (DMs to the bot)
 *   - interactive payload handling (buttons, modals for HITL approvals)
 *
 * Slack app setup:
 *   1. Create an app at https://api.slack.com/apps → "From scratch"
 *   2. Bot Token Scopes: app_mentions:read, chat:write, files:write,
 *      im:history, channels:history (if listening in channels)
 *   3. Event Subscriptions → enable → Request URL:
 *        https://<your-host>/eve/v1/slack
 *   4. Subscribe to events: app_mention, message.im
 *   5. Install to workspace → copy Bot User OAuth Token (xoxb-...)
 *   6. Set env vars: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET
 *
 * Usage: the CEO just @mentions the bot in a Slack channel:
 *   "@eve fix the login bug on the auth branch and open a PR"
 *
 * The agent runs on the desktop, does the work, and when done:
 *   - posts a summary back to the Slack thread
 *   - pushes a branch + opens a PR
 *   - posts the session recording (see hooks/recording.ts)
 */
export default slackChannel({
  // credentials come from env vars: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET

  // Respond when @mentioned in channels, and on DMs.
  // The defaults post a "Thinking..." typing indicator then dispatch the turn.
  // Override onAppMention / onDirectMessage only to change pre-dispatch behavior.

  // Carry earlier thread messages as context so the agent sees the conversation.
  threadContext: {
    since: "thread-root",
  },
});
