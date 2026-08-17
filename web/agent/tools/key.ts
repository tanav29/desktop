import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Press a key or a modifier-combined key sequence, e.g. Return, Escape, alt+Tab, ctrl+shift+t, Super_L, BackSpace.",
  inputSchema: z.object({
    keys: z.string().describe('Key or "+"-joined combo, e.g. "Return" or "ctrl+shift+t"'),
  }),
  async execute({ keys }) {
    await computer.key(keys);
    return { pressed: keys };
  },
});