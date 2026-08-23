import { computer } from "@/lib/computer";

/**
 * Where the agent's pointer is right now, for the overlay on the live pane.
 *
 * Polled at ~10Hz by a single client, so it must stay cheap: the daemon caches
 * its xdotool read for ~60ms and this route adds nothing but a hop. Errors come
 * back as 200 with `ok:false` rather than a 5xx, because the overlay polls
 * continuously and a dead container is a normal state, not an exception.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pointer = await computer.pointer();
    return Response.json({ ok: true, ...pointer });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message });
  }
}
