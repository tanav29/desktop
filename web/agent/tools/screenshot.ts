import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Save a full-resolution PNG of the desktop into the shared workspace (host: ./workspace). Returns the path for the user. You cannot see the picture yourself; for that, use observe or inspect_desktop.",
  inputSchema: z.object({}),
  async execute() {
    const hostPath = await computer.screenshot(`eve-${Date.now()}.png`);
    return { path: hostPath, note: "Saved to the shared workspace; the user can open it from ./workspace." };
  },
});