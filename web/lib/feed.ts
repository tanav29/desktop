import { computer } from "@/lib/computer";

let streamUrl: string | null = null;
let pending: Promise<string | null> | null = null;

/**
 * Lazily start the SDK's MJPEG live feed on an ephemeral port and proxy it.
 * live() doesn't touch Docker until a client actually requests a frame, so
 * starting it is safe even while the container is down.
 */
export function feedStreamUrl(): Promise<string | null> {
  if (streamUrl) return Promise.resolve(streamUrl);
  if (!pending) {
    pending = computer
      .live({ port: 0, fps: 4, quality: 60 })
      .then((feed) => (streamUrl = feed.streamUrl))
      .catch((err: unknown) => {
        pending = null;
        console.error(
          "[feed] failed to start:",
          err instanceof Error ? err.message : String(err)
        );
        return null;
      });
  }
  return pending;
}