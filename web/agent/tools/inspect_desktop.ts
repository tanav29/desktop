import { defineTool } from "eve/tools";
import { z } from "zod";
import { computer } from "@/lib/computer";

export default defineTool({
  description:
    "Read the current desktop state as TEXT: visible windows (id, title, geometry), the focused window, the pointer position, and running apps. This is your eyes when your model cannot receive images. Call it before acting and after actions that change the screen.",
  inputSchema: z.object({}),
  async execute() {
    const out = await computer.cmd(`
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
      pgrep -af 'xfce4-terminal|/opt/chrome|chromium' 2>/dev/null | head -n 12 || true
    `, { timeoutMs: 30_000 });
    return out.slice(0, 3000) || "(desktop returned nothing — is the container healthy?)";
  },
});