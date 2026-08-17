import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description: "Kill an app launched with create_app, by its unique title.",
  inputSchema: z.object({
    title: z.string().regex(/^[A-Za-z0-9._-]{1,48}$/).describe("Title returned by create_app"),
  }),
  async execute({ title }) {
    await computer.kill(title);
    return { killed: title };
  },
});