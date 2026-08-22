import { defineTool, toolOutput } from "eve/tools";
import { z } from "zod";
import { buildRecording } from "@/lib/recording";

export default defineTool({
  description:
    "Compile the desktop frames captured during this session into a timelapse and post it into the chat for the user. The chat renders it automatically as soon as this returns — you do not need to paste a link. Call it once when the work is done, or whenever the user asks to see what happened. Returns ok:false with a reason if no frames were captured.",
  inputSchema: z.object({
    label: z
      .string()
      .max(80)
      .optional()
      .describe("Short caption, e.g. 'session recording — login bug fix'"),
  }),
  async execute({ label }, ctx) {
    const result = await buildRecording(ctx.session.id);

    if (!result.ok) {
      return { ok: false as const, note: `No recording to share: ${result.reason}.` };
    }

    return {
      ok: true as const,
      // The UI keys on `media` to render this as a chat attachment.
      media: {
        kind: "video" as const,
        url: result.url,
        caption: label ?? "Session recording",
      },
      frames: result.frames,
      note: `Timelapse of ${result.frames} frame(s) posted to the chat.`,
    };
  },
  toModelOutput(output) {
    return toolOutput.text(output.note);
  },
});
