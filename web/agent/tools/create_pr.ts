import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Push the current branch to the remote and open a Pull Request via the GitHub CLI (gh). Requires gh to be authenticated inside the container (GH_TOKEN env var or gh auth login). Returns the PR URL.",
  inputSchema: z.object({
    repoPath: z.string().describe("Absolute path to the repo, e.g. /workspace/my-repo"),
    title: z.string().describe("PR title"),
    body: z.string().optional().describe("PR description (markdown). Defaults to a generated summary."),
    base: z.string().optional().describe("Base branch to merge into. Defaults to the repo default."),
  }),
  async execute({ repoPath, title, body, base }) {
    const safeTitle = title.replace(/"/g, '\\"');
    const safeBody = (body ?? "Changes made by the desktop agent.").replace(/"/g, '\\"');

    // Push the branch, then open a PR.
    const baseFlag = base ? `--base "${base}"` : "";
    const script = `
      cd "${repoPath}" || exit 1
      git push -u origin HEAD 2>&1
      gh pr create --title "${safeTitle}" --body "${safeBody}" ${baseFlag} 2>&1
    `;
    const out = await computer.cmd(script, { timeoutMs: 60_000 });

    // Extract the PR URL from gh output (it's the last URL-looking line).
    const prUrlMatch = out.match(/https:\/\/github\.com\/[^\s]+/);
    return {
      pushed: true,
      prUrl: prUrlMatch?.[0] ?? null,
      output: out.slice(0, 800),
    };
  },
});
