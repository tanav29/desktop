import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

/** Launch, kill, and list desktop apps — one tool instead of three. */

/**
 * XFCE's own furniture, dropped from `list`. These windows are always there and
 * are never what the model is looking for; the panel alone accounts for four of
 * them. `observe` still shows everything, geometry included.
 */
const FURNITURE = new Set(["Xfwm4", "Desktop", "xfce4-panel", "wrapper-2.0"]);

export default defineTool({
  description:
    "Manage apps on the desktop. do:'launch' starts one (needs command + title; the title is how you kill it later, so make it unique — never a generic name like 'Terminal', XFCE already has one). do:'kill' stops it by title. do:'list' names the visible app windows. After launching, use computer's wait_for to wait for the window instead of sleeping. Note the window TITLE is set by the app, not by your title: a terminal shows your title, but Chromium windows are named '<page> - Google Chrome for Testing'.",
  inputSchema: z.object({
    do: z.enum(["launch", "kill", "list"]),
    command: z
      .string()
      .min(1)
      .optional()
      .describe("For launch: e.g. 'xterm' or 'chromium https://example.com'"),
    title: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,48}$/)
      .optional()
      .describe("Unique id for launch/kill (letters, digits, . _ - only)"),
  }),
  async execute({ do: action, command, title }) {
    try {
      if (action === "list") {
        const windows = (await computer.windows()).filter((w) => !FURNITURE.has(w));
        return { windows, count: windows.length };
      }

      if (action === "launch") {
        if (!command || !title) return { ok: false, why: "launch needs both command and title" };
        const used = await computer.create(command, { title });
        return { ok: true, launched: used, command };
      }

      if (!title) return { ok: false, why: "kill needs a title" };
      await computer.kill(title);
      return { ok: true, killed: title };
    } catch (err) {
      return { ok: false, why: (err as Error).message.slice(0, 300) };
    }
  },
});
