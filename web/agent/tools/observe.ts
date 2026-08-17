import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";
import { VISION_CAPABLE } from "@/lib/config";

export default defineTool({
  description:
    "Capture the current desktop screen. If your model supports images, the screenshot is handed to you directly — use it before acting and after every action that changes the screen. If not, it tells you so (then use inspect_desktop instead). Captured frames stay in session history, so capture sparingly.",
  inputSchema: z.object({}),
  async execute() {
    const frame = await computer.observe({ width: 1024, quality: 55 });
    if (VISION_CAPABLE) {
      return { got: "image", base64: frame.base64, note: "Screen captured." };
    }
    return {
      got: "none",
      note: "This model cannot receive images. Use inspect_desktop to read the screen as text.",
    };
  },
  toModelOutput(output) {
    if (output.got === "image") {
      return toolOutput.content([
        toolOutputPart.text("Current screen:"),
        toolOutputPart.file(output.base64 ?? "", { mediaType: "image/jpeg" }),
      ]);
    }
    return toolOutput.text(output.note);
  },
});