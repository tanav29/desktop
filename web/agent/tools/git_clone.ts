import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Clone a git repository into /workspace inside the desktop. Clones into /workspace/<repo-name> by default. Use this to get a target repo before making changes. Returns the path it cloned into.",
  inputSchema: z.object({
    url: z.string().describe("Git remote URL, e.g. https://github.com/owner/repo.git or git@github.com:owner/repo.git"),
    path: z
      .string()
      .optional()
      .describe("Target dir name inside /workspace. Defaults to the repo name from the URL."),
    branch: z.string().optional().describe("Branch to checkout after cloning"),
  }),
  async execute({ url, path, branch }) {
    const dir = path ?? url.replace(/\.git$/, "").replace(/.*\//, "");
    const target = `/workspace/${dir}`;

    // Remove existing clone if it's there, then fresh clone.
    await computer.cmd(`rm -rf "${target}"`, { timeoutMs: 30_000 });
    const cloneCmd = branch
      ? `git clone --branch "${branch}" "${url}" "${target}"`
      : `git clone "${url}" "${target}"`;
    const out = await computer.cmd(cloneCmd, { timeoutMs: 120_000 });
    return {
      cloned: true,
      path: target,
      branch: branch ?? "default",
      output: (out || "").slice(0, 500),
    };
  },
});
