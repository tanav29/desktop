import { defineHook } from "eve/hooks";
import { computer } from "@/lib/computer";
import { callSlackApi } from "eve/channels/slack";
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
 *     uploads the video to Slack and posts a summary.
 *
 * The recording lives in the shared workspace so it's also accessible
 * from the host's ./workspace/recordings/ directory.
 */

const FRAME_INTERVAL_MS = 2000;
const RECORDINGS_DIR = "/workspace/recordings";

// Per-process map of session IDs to their capture interval timers.
const captureTimers = new Map<string, ReturnType<typeof setInterval>>();

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

        // Try to upload to Slack if we have a bot token.
        const botToken = process.env.SLACK_BOT_TOKEN;
        if (botToken) {
          try {
            const videoBuffer = await readFile(hostVideoPath);
            const base64Video = videoBuffer.toString("base64");

            // Upload via Slack's files API.
            const uploadRes = await callSlackApi({
              botToken,
              operation: "files.upload",
              body: {
                content: base64Video,
                filename: `session-${sessionId}.mp4`,
                title: `Agent session recording — ${sessionId}`,
                filetype: "mp4",
              },
            });

            if (uploadRes.ok) {
              const fileId = (uploadRes as Record<string, any>)?.file?.id ?? "unknown";
              console.log(`[recording] uploaded to Slack: ${fileId}`);
            } else {
              console.warn(`[recording] Slack upload failed:`, uploadRes.error);
            }
          } catch (err) {
            console.warn(`[recording] upload error:`, (err as Error).message);
          }
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
