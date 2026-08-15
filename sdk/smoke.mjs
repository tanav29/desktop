import { Desktop } from "./dist/index.js";

const d = new Desktop();
const t = await d.create("xfce4-terminal");
console.log("created:", t);

await d.cmd(
  'wid=$(xdotool search --onlyvisible --name ' + t + ' | head -1); ' +
  'xdotool windowactivate --sync "$wid"; ' +
  'xdotool type --delay 40 "echo sdk-ok"; xdotool key Return'
);

const p1 = await d.screenshot("sdk-before.png");
console.log("shot1:", p1);

await d.kill(t);
console.log("killed:", t);

const p2 = await d.screenshot("sdk-after.png");
console.log("shot2:", p2);
console.log("health:", await d.cmd("pgrep -f xfce4-session"));