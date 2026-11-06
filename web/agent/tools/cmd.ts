import { defineTool } from "eve/tools";
import { z } from "zod";
import { getComputer } from "@/lib/computer";

export default defineTool({
  description:
    "Run any shell command inside the computer (via the in-container daemon, bash -c) and return its output. Use for xdotool one-liners, file work in /workspace, apt/pip installs, process queries, curl, python. Fails normally and returns the error text so you can read it.",
  inputSchema: z.object({
    desktop: z.string().optional().describe("Configured desktop name. Required when multiple desktops are configured; use the same name for observe and actions."),
    command: z.string().min(1).describe("Shell command to run inside the container"),
  }),
  async execute({ command, desktop }) {
    try {
      const out = await (await getComputer(desktop)).cmd(command, { timeoutMs: 60_000 });
      return (out || "(no output)").slice(0, 2000);
    } catch (err) {
      return `COMMAND FAILED: ${(err as Error).message.slice(0, 800)}`;
    }
  },
});