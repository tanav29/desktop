import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Launch an app on the desktop. Command examples: xfce4-terminal, chromium https://example.com. Give every instance a unique title so you can find and kill it later (kill_app). Returns the title actually used.",
  inputSchema: z.object({
    command: z.string().min(1).describe("Launch command, e.g. xfce4-terminal or chromium <url>"),
    title: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,48}$/)
      .describe("Unique worker id (letters, digits, . _ - only)"),
  }),
  async execute({ command, title }) {
    const used = await computer.create(command, { title });
    return { launched: true, title: used, command };
  },
});