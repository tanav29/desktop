import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * Media server for the chat — exposes files from the shared workspace
 * (./workspace on the host) under /api/media/**.
 *
 *   /api/media/recordings/<sessionId>/session.gif   session timelapse
 *   /api/media/shots/<file>.png                     desktop screenshots
 *
 * Path segments are sanitized and resolved against the workspace root, so
 * nothing outside ./workspace can be reached. Range requests are honored so
 * <video> players can seek.
 *
 * The paths read here are pure runtime values, so Next's build-time file tracer
 * can't prove what they are and would otherwise pull the whole project into
 * this route's bundle. Hence the turbopackIgnore comments on each fs call —
 * everything read lives in ./workspace, which is a runtime bind mount anyway.
 */

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../workspace");

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function safeJoin(segments: string[]): string | null {
  const target = path.resolve(WORKSPACE_ROOT, ...segments);
  // The resolved path must stay inside the workspace root.
  if (target !== WORKSPACE_ROOT && !target.startsWith(WORKSPACE_ROOT + path.sep)) {
    return null;
  }
  return target;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ media: string[] }> }
) {
  const { media } = await params;
  const target = safeJoin(media ?? []);
  if (!target) return new Response("Forbidden", { status: 403 });

  let info;
  try {
    info = await stat(/*turbopackIgnore: true*/ target);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!info.isFile()) return new Response("Not found", { status: 404 });

  const type =
    MIME_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream";
  const range = request.headers.get("range");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? Math.min(parseInt(match[2], 10), info.size - 1) : info.size - 1;
      if (start <= end && start < info.size) {
        const stream = createReadStream(/*turbopackIgnore: true*/ target, { start, end });
        return new Response(stream as unknown as ReadableStream, {
          status: 206,
          headers: {
            "Content-Type": type,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${info.size}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
          },
        });
      }
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    }
  }

  const stream = createReadStream(/*turbopackIgnore: true*/ target);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(info.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}

/** Cheap existence/size probe used by the UI before embedding a recording. */
export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ media: string[] }> }
) {
  const { media } = await params;
  const target = safeJoin(media ?? []);
  if (!target) return new Response(null, { status: 403 });

  try {
    const info = await stat(/*turbopackIgnore: true*/ target);
    if (!info.isFile()) return new Response(null, { status: 404 });
    return new Response(null, {
      headers: {
        "Content-Length": String(info.size),
        "Content-Type":
          MIME_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
