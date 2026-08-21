import { defineHook } from "eve/hooks";
import { computer } from "@/lib/computer";
import { callSlackApi } from "eve/channels/slack";
import { resolveSlackCredentials } from "@/lib/slack-config";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Recording hook — captures desktop screenshots during the agent's work
 * and compiles them into a video on session completion.
 *
 * How it works:
 *   - On session.started: starts a background frame capturer that grabs a
 *     JPEG of the desktop every 2s into /workspace/recordings/<sessionId>/.
 *   - On session.completed: runs ffmpeg to compile frames → mp4, then
 *     shares the video to the session's Slack thread.
 *
 * The recording lives in the shared workspace so it's also accessible
 * from the host's ./workspace/recordings/ directory.
 */

const FRAME_INTERVAL_MS = 2000;
const RECORDINGS_DIR = "/workspace/recordings";

// Per-process map of session IDs to their capture interval timers.
const captureTimers = new Map<string, ReturnType<typeof setInterval>>();

/** `files.getUploadURLExternal` response — the fields this hook consumes. */
interface SlackUploadUrlResponse {
  ok: boolean;
  error?: string;
  upload_url?: string;
  file_id?: string;
}

/**
 * Parse the Slack thread a session is bound to from its continuation token
 * (`…:<channelId>:<threadTs>`, e.g. `slack:C0123ABC:1712345678.000100`).
 * Returns null for non-Slack sessions and threadless ones.
 */
function slackThreadFromContinuation(
  token: string | undefined,
): { channelId: string; threadTs: string } | null {
  if (!token) return null;
  const parts = token.split(":");
  const threadTs = parts.at(-1) ?? "";
  const channelId = parts.at(-2) ?? "";
  return /^[CDG]/.test(channelId) && /^\d+\.\d+$/.test(threadTs)
    ? { channelId, threadTs }
    : null;
}

/**
 * Share the finished recording into the session's Slack thread.
 *
 * Uses Slack's current upload flow — `files.getUploadURLExternal` → raw
 * byte POST → `files.completeUploadExternal` — because the legacy
 * `files.upload` method has been retired by Slack and rejects new apps
 * outright. Credentials resolve through `resolveSlackCredentials()` so
 * UI-saved values apply here too. Best-effort: failures log, never throw.
 */
async function shareRecordingToSlack(
  sessionId: string,
  hostVideoPath: string,
  target: { channelId: string; threadTs: string } | null,
): Promise<void> {
  const { botToken } = await resolveSlackCredentials();
  if (!botToken) {
    console.warn("[recording] no Slack credentials — recording kept locally only");
    return;
  }

  const videoBuffer = await readFile(hostVideoPath);
  const filename = `session-${sessionId}.mp4`;
  const title = `Agent session recording — ${sessionId}`;

  // 1. Request a one-time upload URL sized to the file.
  const urlRes = (await callSlackApi({
    botToken,
    operation: "files.getUploadURLExternal",
    body: { filename, length: videoBuffer.byteLength, alt_txt: title },
  })) as SlackUploadUrlResponse;
  if (!urlRes.ok || !urlRes.upload_url || !urlRes.file_id) {
    console.warn(`[recording] Slack upload URL failed: ${urlRes.error ?? "no upload_url"}`);
    return;
  }

  // 2. POST the raw bytes to the signed URL.
  const push = await fetch(urlRes.upload_url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/octet-stream",
    },
    body: new Uint8Array(videoBuffer),
  });
  if (!push.ok) {
    console.warn(`[recording] Slack byte upload failed: HTTP ${push.status}`);
    return;
  }

  // 3. Complete the upload, sharing it into the session's thread when known.
  const complete = await callSlackApi({
    botToken,
    operation: "files.completeUploadExternal",
    body: {
      files: [{ id: urlRes.file_id, title }],
      ...(target ? { channel_id: target.channelId, thread_ts: target.threadTs } : {}),
    },
  });
  if (complete.ok) {
    console.log(
      `[recording] shared recording ${urlRes.file_id}${target ? ` in ${target.channelId}` : " (unshared)"}`
    );
  } else {
    console.warn(`[recording] Slack completeUploadExternal failed: ${complete.error}`);
  }
}

export default defineHook({
  events: {
    "session.started": async (_event, ctx) => {
      const sessionId = ctx.session.id;
      const dir = `${RECORDINGS_DIR}/${sessionId}`;
      await computer.cmd(`mkdir -p "${dir}"`, { timeoutMs: 10_000 });

      // Don't start double-capturers for the same session.
      if (captureTimers.has(sessionId)) return;

      let frameNum = 0;
      const timer = setInterval(async () => {
        try {
          const padded = String(frameNum).padStart(6, "0");
          // Capture a JPEG frame directly to the recordings dir.
          await computer.cmd(
            `import -window root -display :99 -quality 70 "${dir}/frame_${padded}.jpg" 2>/dev/null || true`,
            { timeoutMs: 10_000 }
          );
          frameNum++;
        } catch {
          // Container may be mid-restart; skip silently.
        }
      }, FRAME_INTERVAL_MS);

      captureTimers.set(sessionId, timer);
      console.log(`[recording] capture started for session ${sessionId}`);
    },

    "session.completed": async (_event, ctx) => {
      const sessionId = ctx.session.id;

      // Stop the frame capturer.
      const timer = captureTimers.get(sessionId);
      if (timer) {
        clearInterval(timer);
        captureTimers.delete(sessionId);
      }

      // Give the last frame a moment to land.
      await new Promise((r) => setTimeout(r, 500));

      const dir = `${RECORDINGS_DIR}/${sessionId}`;
      const videoPath = `${dir}/session.mp4`;

      try {
        // Compile frames into an MP4 video using ffmpeg.
        // 0.5 fps playback (2s between frames) → smooth timelapse.
        await computer.cmd(
          `ffmpeg -y -framerate 0.5 -pattern_type glob -i '${dir}/frame_*.jpg' -c:v libx264 -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${videoPath}" 2>&1 | tail -5`,
          { timeoutMs: 120_000 }
        );

        // Check the video was created and has a reasonable size.
        const statOut = await computer.cmd(
          `stat -c '%s' "${videoPath}" 2>/dev/null || echo 0`,
          { timeoutMs: 5_000 }
        );
        const sizeBytes = parseInt(statOut.trim(), 10) || 0;

        if (sizeBytes < 1000) {
          console.warn(`[recording] video too small (${sizeBytes} bytes), skipping upload`);
          return;
        }

        console.log(`[recording] video ready: ${videoPath} (${sizeBytes} bytes)`);

        // Read the video from the host-side workspace path.
        const hostVideoPath = path.resolve(
          process.cwd(),
          "../workspace/recordings",
          sessionId,
          "session.mp4"
        );

        // Share the finished recording into the session's Slack thread.
        try {
          await shareRecordingToSlack(
            sessionId,
            hostVideoPath,
            slackThreadFromContinuation(ctx.channel.continuationToken)
          );
        } catch (err) {
          console.warn(`[recording] Slack upload error:`, (err as Error).message);
        }
      } catch (err) {
        console.error(`[recording] failed:`, (err as Error).message);
      }
    },

    "session.failed": async (event, ctx) => {
      const sessionId = ctx.session.id;
      const timer = captureTimers.get(sessionId);
      if (timer) {
        clearInterval(timer);
        captureTimers.delete(sessionId);
      }
      console.warn(
        `[recording] session ${sessionId} failed — partial recording kept in ${RECORDINGS_DIR}/${sessionId}`
      );
    },
  },
});
