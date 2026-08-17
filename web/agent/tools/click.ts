import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Click a mouse button. Optionally pass x/y to move the pointer first (1=left, 2=middle, 3=right, 4=wheel up, 5=wheel down).",
  inputSchema: z.object({
    button: z.number().int().min(1).max(5).default(1),
    x: z.number().int().min(0).max(1599).optional(),
    y: z.number().int().min(0).max(899).optional(),
  }),
  async execute({ button, x, y }) {
    await computer.click(button, x, y);
    return { clicked: `button ${button}${x !== undefined && y !== undefined ? ` at (${x}, ${y})` : ""}` };
  },
});