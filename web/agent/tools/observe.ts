import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { getComputer } from "@/lib/computer";
import { VISION_CAPABLE } from "@/lib/config";

/**
 * One "look" at the desktop: the text state always, plus the pixels when the
 * model can actually receive images.
 *
 * This used to be two tools (`observe` for the picture, `inspect_desktop` for
 * the text), which meant two round-trips for one glance and a note in the
 * instructions telling the model which one its model supported. Text state is
 * cheap and useful even to a vision model — window titles and geometry are
 * exact where reading them off a screenshot is a guess.
 */

/** Windows with geometry, focus, pointer, and the apps we care about. */
const STATE_SCRIPT = `
  printf 'windows:\\n'
  xdotool search --onlyvisible --name ".*" 2>/dev/null | while read -r w; do
    n=$(xdotool getwindowname "$w" 2>/dev/null) || continue
    [ -z "$n" ] && continue
    g=$(xdotool getwindowgeometry --shell "$w" 2>/dev/null | grep -E '^(X=|Y=|WIDTH=|HEIGHT=)' | tr '\\n' ' ')
    echo "  [$w] $n -- $g"
  done
  printf 'focused: '
  xdotool getactivewindow 2>/dev/null | xargs -r -I{} sh -c 'echo "{} $(xdotool getwindowname {} 2>/dev/null)"'
  printf 'pointer: '
  xdotool getmouselocation 2>/dev/null | grep -oE 'x:[0-9]+ y:[0-9]+'
  printf 'apps:\\n'
  pgrep -af 'xterm|/opt/chrome|chromium' 2>/dev/null | head -n 8 || true
`;

export default defineTool({
  description:
    "Look at the desktop. Always returns the state as text — visible windows with their geometry, which one is focused, the pointer position, running apps — and, if your model can see images, the screen itself. Call it before acting on an unfamiliar screen and after a step that changed it. Use detail:'full' when you need to read small text. Screens stay in the session history, so don't call it between every keystroke.",
  inputSchema: z.object({
    desktop: z.string().optional().describe("Configured desktop name. Required when multiple desktops are configured; use the same name for observe and actions."),
    detail: z
      .enum(["normal", "full"])
      .optional()
      .describe("'full' captures at full resolution for reading small text. Default 'normal'."),
  }),
  async execute({ detail, desktop }) {
    const full = detail === "full";

    let state: string;
    try {
      const computer = await getComputer(desktop);
      const framePromise = VISION_CAPABLE ? computer.observe({ width: full ? 1600 : 1024, quality: full ? 75 : 55 }).catch(() => null) : Promise.resolve(null);
      const out = await computer.cmd(STATE_SCRIPT, { timeoutMs: 30_000 });
      state = `Desktop: ${desktop ?? "only discovered desktop"}\n` + (out.slice(0, 1600) || "(no desktop state)");
      const frame = await framePromise;
      return { state, base64: frame?.base64 ?? null };
    } catch (err) {
      return { state: `could not read the desktop: ${(err as Error).message.slice(0, 300)}`, base64: null };
    }
  },
  toModelOutput(output) {
    if (!output.base64) return toolOutput.text(output.state);
    return toolOutput.content([
      toolOutputPart.text(output.state),
      toolOutputPart.file(output.base64, { mediaType: "image/jpeg" }),
    ]);
  },
});
