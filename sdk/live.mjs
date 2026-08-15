import { computer } from "./dist/index.js";

const feed = await computer.live({ port: 8090 });

console.log("viewer: ", feed.url);
console.log("stream: ", feed.streamUrl);
console.log("press Ctrl+C to stop");

process.on("SIGINT", async () => {
  await feed.stop();
  process.exit(0);
});