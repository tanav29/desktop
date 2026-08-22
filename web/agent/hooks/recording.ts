import { defineHook } from "eve/hooks";
import { computer } from "@/lib/computer";
import {
  RECORDINGS_DIR,
  buildRecording,
  frameFilename,
} from "@/lib/recording";

/**
 * Recording hook — captures desktop frames while the agent works and compiles
 * them into a timelapse the chat can play inline.
 *
 * Capture runs for the duration of a turn (`turn.started` → `turn.completed`),
 * not the session: an eve session stays open for days, so anchoring capture to
 * the session meant the 2s timer never stopped and the video was only compiled
 * at session expiry — i.e. never, in a normal chat.
 *
 * Frames accumulate across every turn of a session, so the compiled recording
 * is the whole session's story and grows each turn. It lands in the shared
 * workspace (host: ./workspace/recordings/<sessionId>/session.gif) and is
 * served to the chat by /api/media/recordings/<sessionId>/session.gif.
 */

const FRAME_INTERVAL_MS = 2000;

/** Stop capturing past this many frames per session — the disk is not free. */
const MAX_FRAMES_PER_SESSION = 300;

type Capture = {
  timer: ReturnType<typeof setInterval>;
  frames: number;
  warned: boolean;
};

const captures = new Map<string, Capture>();

function stopCapture(sessionId: string): void {
  const capture = captures.get(sessionId);
  if (!capture) return;
  clearInterval(capture.timer);
  captures.delete(sessionId);
}

async function startCapture(sessionId: string): Promise<void> {
  if (captures.has(sessionId)) return;

  const dir = `${RECORDINGS_DIR}/${sessionId}`;
  await computer.cmd(`mkdir -p "${dir}"`, { timeoutMs: 10_000 });

  // Frames from earlier turns already live here; count them so numbering keeps
  // climbing instead of overwriting the first turn's work.
  let existing = 0;
  try {
    const out = await computer.cmd(
      `ls -1 "${dir}"/frame_*.jpg 2>/dev/null | wc -l`,
      { timeoutMs: 10_000 }
    );
    existing = parseInt(out.trim(), 10) || 0;
  } catch {
    // Fresh session, or the container is mid-restart — start from zero.
  }

  const capture: Capture = {
    frames: existing,
    warned: false,
    timer: setInterval(() => {
      const current = captures.get(sessionId);
      if (!current) return;

      if (current.frames >= MAX_FRAMES_PER_SESSION) {
        if (!current.warned) {
          current.warned = true;
          console.warn(
            `[recording] session ${sessionId} hit ${MAX_FRAMES_PER_SESSION} frames — capture stopped`
          );
        }
        return;
      }

      const name = frameFilename(current.frames);
      current.frames++;
      // Fire and forget: a dropped frame is a cosmetic loss, and awaiting here
      // would let slow captures pile up behind each other.
      void computer
        .cmd(`import -window root -display :99 -quality 70 "${dir}/${name}"`, {
          timeoutMs: 10_000,
        })
        .catch(() => {
          // Container mid-restart or display gone; skip this frame.
        });
    }, FRAME_INTERVAL_MS),
  };

  captures.set(sessionId, capture);
  console.log(`[recording] capture started for session ${sessionId}`);
}

export default defineHook({
  events: {
    "turn.started": async (_event, ctx) => {
      try {
        await startCapture(ctx.session.id);
      } catch (err) {
        console.error("[recording] could not start capture:", (err as Error).message);
      }
    },

    "turn.completed": async (_event, ctx) => {
      const sessionId = ctx.session.id;
      stopCapture(sessionId);

      // Let the in-flight frame finish landing before we read the directory.
      await new Promise((r) => setTimeout(r, 600));

      const result = await buildRecording(sessionId);
      if (result.ok) {
        console.log(
          `[recording] ready: ${result.path} (${result.bytes} bytes, ${result.frames} frames) — served at ${result.url}`
        );
      } else {
        console.log(`[recording] nothing compiled: ${result.reason}`);
      }
    },

    "turn.failed": async (_event, ctx) => {
      stopCapture(ctx.session.id);
      console.warn(
        `[recording] turn failed — partial frames kept in ${RECORDINGS_DIR}/${ctx.session.id}`
      );
    },

    "turn.cancelled": async (_event, ctx) => {
      const sessionId = ctx.session.id;
      stopCapture(sessionId);
      // A cancelled turn still did visible work; compile what we captured.
      await buildRecording(sessionId).catch(() => undefined);
    },

    "session.completed": async (_event, ctx) => {
      stopCapture(ctx.session.id);
    },

    "session.failed": async (_event, ctx) => {
      stopCapture(ctx.session.id);
    },
  },
});
