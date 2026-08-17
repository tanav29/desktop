import path from "node:path";
import { Desktop } from "computer-use-sdk";

/**
 * The single handle to the desktop container. All eve tools and app routes go
 * through this. The workspace is ../workspace relative to the web app root
 * (the project root's ./workspace, mounted at /workspace in the container).
 */
export const computer = new Desktop({
  container: "linux-desktop",
  workspace: path.resolve(process.cwd(), "../workspace"),
});