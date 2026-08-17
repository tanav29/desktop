import path from "node:path";
import { Desktop } from "computer-use-sdk";

export const computer = new Desktop({
  port: Number(process.env.COMPUTER_PORT ?? 8095),
  workspace: path.resolve(process.cwd(), "../workspace"),
});
