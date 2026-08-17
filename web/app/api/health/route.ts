import { computer } from "@/lib/computer";
import { MODEL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ok = await computer.health();
    return Response.json({ ok, port: computer.port, model: MODEL });
  } catch (err) {
    return Response.json({
      ok: false,
      port: computer.port,
      model: MODEL,
      error: (err as Error).message,
    });
  }
}