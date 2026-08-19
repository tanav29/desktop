import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Create a new git branch, stage all changes, and commit. Run this inside a repo you cloned with git_clone. Returns the commit hash and branch name.",
  inputSchema: z.object({
    repoPath: z.string().describe("Absolute path to the repo inside the container, e.g. /workspace/my-repo"),
    branch: z.string().describe("New branch name, e.g. fix/login-bug"),
    message: z.string().describe("Commit message"),
    addAll: z.boolean().default(true).describe("Stage all changes (git add -A). Set false to add manually."),
  }),
  async execute({ repoPath, branch, message, addAll }) {
    const safeMsg = message.replace(/"/g, '\\"');
    const script = `
      cd "${repoPath}" || exit 1
      git checkout -b "${branch}" 2>/dev/null || git checkout "${branch}"
      ${addAll ? "git add -A" : ""}
      git commit -m "${safeMsg}"
      git rev-parse HEAD
      git rev-parse --abbrev-ref HEAD
    `;
    const out = await computer.cmd(script, { timeoutMs: 30_000 });
    const lines = out.trim().split("\n");
    const commitHash = lines[lines.length - 2] ?? "";
    const currentBranch = lines[lines.length - 1] ?? branch;
    return {
      committed: true,
      branch: currentBranch,
      commit: commitHash.slice(0, 12),
      output: out.slice(0, 500),
    };
  },
});
