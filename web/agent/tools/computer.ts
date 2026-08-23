import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";
import type { Action } from "computer-use-sdk";

/**
 * The one input tool.
 *
 * It replaces mouse/click/key/type_text/sleep, which were one primitive per
 * call. Round-trips are what actually cost context here: every call appends an
 * assistant message plus a tool result to the session forever, so "click the
 * address bar, type a URL, press Enter" used to cost three of them. Batched, it
 * is one — and the daemon runs the sequence in-container with no network hop
 * between steps, so it is faster too.
 */

const move = z.object({
  do: z.literal("move"),
  x: z.number().int(),
  y: z.number().int(),
});

const click = z.object({
  do: z.literal("click"),
  x: z.number().int().optional().describe("Omit to click wherever the pointer already is"),
  y: z.number().int().optional(),
  button: z.number().int().min(1).max(9).optional().describe("1 left (default), 2 middle, 3 right"),
  count: z.number().int().min(1).max(10).optional().describe("2 for a double-click"),
});

const drag = z.object({
  do: z.literal("drag"),
  x1: z.number().int(),
  y1: z.number().int(),
  x2: z.number().int(),
  y2: z.number().int(),
  button: z.number().int().min(1).max(3).optional(),
});

const scroll = z.object({
  do: z.literal("scroll"),
  dir: z.enum(["up", "down"]),
  amount: z.number().int().min(1).max(25).optional().describe("Wheel notches, default 3"),
  x: z.number().int().optional().describe("Scroll over this point instead of the current one"),
  y: z.number().int().optional(),
});

const type = z.object({
  do: z.literal("type"),
  text: z.string().min(1),
  delayMs: z.number().int().min(0).max(500).optional().describe("Per-keystroke delay, default 12"),
});

const key = z.object({
  do: z.literal("key"),
  keys: z
    .string()
    .min(1)
    .describe('Keysym or combo: "Return", "Escape", "Tab", "ctrl+shift+t", "alt+Tab", "Super_L". Space-separate for a run of keys.'),
  count: z.number().int().min(1).max(50).optional().describe("Repeat the key this many times"),
});

const paste = z.object({
  do: z.literal("paste"),
  text: z.string().min(1),
});

const focus = z.object({
  do: z.literal("focus"),
  window: z.string().min(1).max(128).describe("Window title, matched as a regex"),
});

const wait = z.object({
  do: z.literal("wait"),
  ms: z.number().int().min(0).max(30_000),
});

const waitFor = z.object({
  do: z.literal("wait_for"),
  window: z.string().min(1).max(128).describe("Window title to wait for, matched as a regex"),
  timeoutMs: z.number().int().min(250).max(60_000).optional().describe("Default 15000"),
});

const action = z.discriminatedUnion("do", [
  move, click, drag, scroll, type, key, paste, focus, wait, waitFor,
]);

export default defineTool({
  description: [
    "Drive the desktop's keyboard and mouse. Pass the WHOLE sequence of steps in one call — that is the point of this tool.",
    "Steps run in order and stop at the first failure, so later steps can assume earlier ones worked.",
    "Actions: move, click, drag, scroll, type, key, paste (clipboard + ctrl+v, use for long text), focus (activate a window by title), wait, wait_for (block until a window appears).",
    "Always focus a window before typing into it. After launching an app, wait_for its title rather than guessing a delay.",
    "Coordinates are absolute pixels on the 1600x900 screen. Returns the pointer position and focused window afterwards.",
  ].join(" "),
  inputSchema: z.object({
    actions: z
      .array(action)
      .min(1)
      .max(32)
      .describe("Steps to run in order, e.g. [{do:'wait_for',window:'Chromium'},{do:'focus',window:'Chromium'},{do:'click',x:640,y:61},{do:'type',text:'example.com'},{do:'key',keys:'Return'}]"),
  }),
  async execute({ actions }) {
    try {
      const result = await computer.actions(actions as Action[]);
      const failed = result.failedAt !== undefined ? result.steps[result.failedAt] : null;
      return {
        ok: result.ok,
        ran: result.ran,
        of: actions.length,
        pointer: result.state.pointer,
        focused: result.state.focused || "(nothing focused)",
        ...(failed
          ? {
              failedAt: result.failedAt,
              failedAction: failed.do,
              why: failed.note ?? "unknown error",
            }
          : {}),
      };
    } catch (err) {
      return { ok: false, why: `could not reach the desktop: ${(err as Error).message.slice(0, 300)}` };
    }
  },
});
