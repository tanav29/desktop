import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Save a full-resolution PNG of the desktop into the shared workspace (host: ./workspace). Returns the file path plus a URL served by this app. You cannot see the picture yourself; for that, use observe or inspect_desktop. To show the picture to the user in chat, use share_screenshot instead.",
  inputSchema: z.object({}),
  async execute() {
    const hostPath = await computer.screenshot(`eve-${Date.now()}.png`);
    const filename = hostPath.split(/[\\/]/).pop() ?? "";
    return {
      path: hostPath,
      url: `/api/media/${filename}`,
      note: "Saved to the shared workspace; also downloadable at the url field.",
    };
  },
});
