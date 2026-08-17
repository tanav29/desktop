import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Type a string of text into the currently focused window, like a keyboard. Any characters are safe. Make sure the right window is focused first (windowactivate --sync via cmd).",
  inputSchema: z.object({
    text: z.string().describe("The exact text to type"),
  }),
  async execute({ text }) {
    await computer.type(text, { delayMs: 20 });
    return { typed: `${text.length} chars` };
  },
});