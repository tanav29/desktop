import { computer } from "@/lib/computer";

/**
 * Shared timelapse plumbing for the recording hook and the `share_recording`
 * tool, so both compile frames identically.
 *
 * The desktop image deliberately ships without ffmpeg (~170 MB of codec stack —
 * see the Dockerfile), so recordings are animated GIFs built with ImageMagick,
 * which is already installed and already used for screenshots. GIF also plays
 * inline in the chat with a plain <img>, no player needed.
 */

export const RECORDINGS_DIR = "/workspace/recordings";

/** Below this a "video" is a header and nothing worth showing. */
const MIN_BYTES = 1000;

/** Playback delay per frame, in GIF ticks (100ths of a second). */
const FRAME_DELAY_TICKS = 50;

/** Frames are captured at 1600x900; halve it so the GIF stays sane. */
const OUTPUT_WIDTH = 960;

export type RecordingResult =
  | { ok: true; url: string; path: string; bytes: number; frames: number }
  | { ok: false; reason: string };

/** Zero-padded so a lexicographic glob is also chronological. */
export function frameFilename(index: number): string {
  return `frame_${String(index).padStart(6, "0")}.jpg`;
}

export function recordingUrl(sessionId: string): string {
  return `/api/media/recordings/${sessionId}/session.gif`;
}

/**
 * Compile this session's captured frames into an animated GIF. Safe to call
 * repeatedly — each call rebuilds from whatever frames exist so far.
 */
export async function buildRecording(sessionId: string): Promise<RecordingResult> {
  const dir = `${RECORDINGS_DIR}/${sessionId}`;
  const gifPath = `${dir}/session.gif`;

  let frames = 0;
  try {
    const out = await computer.cmd(
      `ls -1 "${dir}"/frame_*.jpg 2>/dev/null | wc -l`,
      { timeoutMs: 10_000 }
    );
    frames = parseInt(out.trim(), 10) || 0;
  } catch {
    return { ok: false, reason: "the desktop container is unreachable" };
  }

  if (frames === 0) {
    return { ok: false, reason: "no frames have been captured for this session yet" };
  }

  try {
    // -layers Optimize keeps a mostly-static desktop small by storing only the
    // changed region of each frame. Write to a temp name and move it into place
    // so the UI never fetches a half-written GIF.
    //
    // The explicit `gif:` coder is load-bearing: ImageMagick picks the output
    // format from the file extension, and a ".gif.tmp" name makes it fall back
    // to the input format instead — silently producing a single-frame JPEG
    // named .gif. Naming the coder decouples the format from the temp filename.
    await computer.cmd(
      `convert -delay ${FRAME_DELAY_TICKS} -loop 0 "${dir}"/frame_*.jpg ` +
        `-resize ${OUTPUT_WIDTH}x -layers Optimize "gif:${gifPath}.tmp" && ` +
        `mv -f "${gifPath}.tmp" "${gifPath}"`,
      { timeoutMs: 180_000 }
    );
  } catch (err) {
    return { ok: false, reason: `ImageMagick failed: ${(err as Error).message}` };
  }

  let bytes = 0;
  try {
    const out = await computer.cmd(`stat -c '%s' "${gifPath}" 2>/dev/null || echo 0`, {
      timeoutMs: 10_000,
    });
    bytes = parseInt(out.trim(), 10) || 0;
  } catch {
    return { ok: false, reason: "could not stat the compiled recording" };
  }

  if (bytes < MIN_BYTES) {
    return { ok: false, reason: `compiled recording was only ${bytes} bytes` };
  }

  return { ok: true, url: recordingUrl(sessionId), path: gifPath, bytes, frames };
}
