import { defineAgent } from "eve";
import { MODEL } from "../lib/config";

export default defineAgent({
  model: MODEL,
  build: {
    // The SDK is plain Node ESM; keep it external instead of bundling it.
    externalDependencies: ["computer-use-sdk"],
  },
});