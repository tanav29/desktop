import { setTimeout as sleep } from "node:timers/promises";
import { Desktop } from "./dist/index.js";

const d = new Desktop({ workspace: "../workspace" });
const t = await d.create("xfce4-terminal");
console.log("created:", t);

let wid = "";
for (let i = 0; i < 30 && !wid; i++) {
  try {
    wid = (await d.cmd(`xdotool search --onlyvisible --name ${t} | head -1`)).trim();
  } catch {
    // container not up or window not mapped yet — retry
  }
  if (!wid && i < 29) await sleep(1000);
}
if (!wid) throw new Error(`window "${t}" never appeared (desktop up?)`);

await d.cmd(
  `xdotool windowactivate --sync ${wid}; ` +
  'xdotool type --delay 40 "echo sdk-ok"; xdotool key Return'
);

const p1 = await d.screenshot("sdk-before.png");
console.log("shot1:", p1);

await d.kill(t);
console.log("killed:", t);

const p2 = await d.screenshot("sdk-after.png");
console.log("shot2:", p2);
console.log("health:", await d.cmd("pgrep -f xfce4-session || echo desktop-down"));