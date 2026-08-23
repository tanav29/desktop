import { defineTool, toolOutput } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";
import { buildRecording } from "@/lib/recording";

/**
 * Post something visual into the chat.
 *
 * Merges the old share_screenshot / share_recording pair. The chat renders
 * whatever comes back on the `media` key as an attachment, so the model never
 * needs to paste a link or markdown — and `toModelOutput` deliberately hands
 * the model only the note, never the image, since it cannot see its own
 * screenshot and the bytes would sit in history for nothing.
 */

/** Workspace subfolder for chat screenshots, so they don't bury the user's files. */
const SHOTS_DIR = "shots";

export default defineTool({
  description:
    "Show the user something. what:'screenshot' posts a full-resolution picture of the desktop right now; what:'recording' compiles this session's captured frames into a timelapse. Both appear in the chat by themselves as soon as this returns — do not paste a link or markdown. Use a screenshot when the user asks to see something or to show a result; use a recording once at the end, or when asked what happened. This does not let YOU see the screen — use observe for that.",
  inputSchema: z.object({
    what: z.enum(["screenshot", "recording"]),
    label: z
      .string()
      .max(80)
      .optional()
      .describe("Short caption, e.g. 'login page after the fix'"),
  }),
  async execute({ what, label }, ctx) {
    if (what === "recording") {
      const result = await buildRecording(ctx.session.id);
      if (!result.ok) {
        return { ok: false as const, note: `No recording to share: ${result.reason}.` };
      }
      return {
        ok: true as const,
        media: {
          kind: "video" as const,
          url: result.url,
          caption: label ?? "Session recording",
        },
        frames: result.frames,
        note: `Timelapse of ${result.frames} frame(s) posted to the chat.`,
      };
    }

    try {
      // computer.screenshot() writes to the workspace root, so capture there
      // and move it into shots/.
      const filename = `shot-${Date.now()}.png`;
      await computer.screenshot(filename);
      await computer.cmd(
        `mkdir -p "/workspace/${SHOTS_DIR}" && mv -f "/workspace/${filename}" "/workspace/${SHOTS_DIR}/${filename}"`,
        { timeoutMs: 15_000 }
      );

      const caption = label ?? "Desktop screenshot";
      return {
        ok: true as const,
        media: {
          kind: "image" as const,
          url: `/api/media/${SHOTS_DIR}/${filename}`,
          caption,
        },
        path: `/workspace/${SHOTS_DIR}/${filename}`,
        note: `Screenshot posted to the chat (${caption}).`,
      };
    } catch (err) {
      return {
        ok: false as const,
        note: `Could not capture a screenshot: ${(err as Error).message.slice(0, 300)}`,
      };
    }
  },
  toModelOutput(output) {
    return toolOutput.text(output.note);
  },
});
