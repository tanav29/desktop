import { defineTool, toolOutput } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

/** Shared-workspace subfolder for screenshots posted into the chat. */
const SHOTS_DIR = "shots";

export default defineTool({
  description:
    "Post a full-resolution screenshot of the current desktop into the chat for the user. The chat renders the image automatically as soon as this returns — you do not need to paste a link or markdown. Use it whenever you want to show the user what the desktop looks like: mid-task progress, proof a fix worked, or something interesting you found. You cannot see the picture yourself; use observe or inspect_desktop for that.",
  inputSchema: z.object({
    label: z
      .string()
      .max(80)
      .optional()
      .describe("Short caption, e.g. 'login page after fix'"),
  }),
  async execute({ label }) {
    // Keep chat screenshots out of the workspace root so they don't bury the
    // user's actual files. computer.screenshot() writes to the workspace root,
    // so capture there and move it into shots/.
    const filename = `shot-${Date.now()}.png`;
    await computer.screenshot(filename);
    await computer.cmd(
      `mkdir -p "/workspace/${SHOTS_DIR}" && mv -f "/workspace/${filename}" "/workspace/${SHOTS_DIR}/${filename}"`,
      { timeoutMs: 15_000 }
    );

    const caption = label ?? "Desktop screenshot";
    return {
      // The UI keys on `media` to render this as a chat attachment.
      media: {
        kind: "image" as const,
        url: `/api/media/${SHOTS_DIR}/${filename}`,
        caption,
      },
      path: `/workspace/${SHOTS_DIR}/${filename}`,
      note: `Screenshot posted to the chat (${caption}).`,
    };
  },
  toModelOutput(output) {
    return toolOutput.text(output.note);
  },
});
