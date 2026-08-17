import { existsSync, mkdirSync, rmSync, cpSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");
const sdkSrc = resolve(webRoot, "..", "sdk");
const sdkLink = resolve(webRoot, "node_modules", "computer-use-sdk");
const sdkNodeModules = resolve(sdkSrc, "node_modules");

mkdirSync(dirname(sdkLink), { recursive: true });

if (existsSync(sdkLink)) {
  const isLink = statSync(sdkLink).isSymbolicLink();
  rmSync(sdkLink, { recursive: !isLink, force: true });
}

// Turbopack does not follow symlinks to directories outside the project, so we
// copy the SDK in as a real directory instead of symlinking it.
cpSync(sdkSrc, sdkLink, {
  recursive: true,
  filter: (src) => !src.startsWith(sdkNodeModules),
});
console.log(`[link-sdk] copied ${sdkSrc} -> ${sdkLink}`);
