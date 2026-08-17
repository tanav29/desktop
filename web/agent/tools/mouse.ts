import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Move the mouse pointer to absolute pixel coordinates on the 1600x900 desktop (x: 0-1599, y: 0-899).",
  inputSchema: z.object({
    x: z.number().int().min(0).max(1599),
    y: z.number().int().min(0).max(899),
  }),
  async execute({ x, y }) {
    await computer.mouse(x, y);
    return { moved: [x, y] };
  },
});