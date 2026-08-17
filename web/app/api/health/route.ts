import { computer } from "@/lib/computer";
import { MODEL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ok = await computer.health();
    return Response.json({ ok, container: computer.container, model: MODEL });
  } catch (err) {
    return Response.json({
      ok: false,
      container: computer.container,
      model: MODEL,
      error: (err as Error).message,
    });
  }
}