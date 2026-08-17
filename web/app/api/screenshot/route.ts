import { readFile } from "node:fs/promises";
import { computer } from "@/lib/computer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const hostPath = await computer.screenshot(`capture-${Date.now()}.png`);
    const png = await readFile(hostPath);
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Capture-Path": encodeURIComponent(hostPath),
      },
    });
  } catch (err) {
    return new Response(`Screenshot failed: ${(err as Error).message}`, { status: 500 });
  }
}