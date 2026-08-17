import { feedStreamUrl } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = await feedStreamUrl();
  if (!url) {
    return new Response("Desktop feed unavailable.", { status: 503 });
  }
  try {
    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return new Response(`Feed upstream responded ${upstream.status}.`, { status: 502 });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(`Feed upstream unreachable: ${(err as Error).message}`, { status: 502 });
  }
}