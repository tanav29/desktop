import path from "node:path";
import { Desktop } from "computer-use-sdk";

export const computer = new Desktop({
  port: Number(process.env.COMPUTER_PORT ?? 8095),
  workspace: path.resolve(process.cwd(), "../workspace"),
});

/** Discover named daemons on the configured local ports on every selection. */
export async function getComputer(name?: string): Promise<Desktop> {
  const ports = (process.env.COMPUTER_DISCOVERY_PORTS ?? `${process.env.COMPUTER_PORT ?? 8095},8096,8097,8098,8099`)
    .split(",").map((p) => Number(p.trim()));
  if (ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535))
    throw new Error("Invalid COMPUTER_DISCOVERY_PORTS");
  const candidates = await Promise.all([...new Set(ports)].map(async (port) => {
    try {
      const res = await fetch(`http://localhost:${port}/api/identity`, { signal: AbortSignal.timeout(1000) });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.name === "string" ? { name: data.name as string, port } : null;
    } catch { return null; }
  }));
  const available = candidates.filter((item): item is { name: string; port: number } => item !== null);
  if (!name && available.length === 1) name = available[0].name;
  if (!name) throw new Error(`Choose a desktop: ${available.map((item) => item.name).join(", ") || "none found"}`);
  const matches = available.filter((item) => item.name === name);
  if (matches.length !== 1) throw new Error(matches.length ? `Duplicate desktop name '${name}'` : `Desktop '${name}' not found. Available: ${available.map((item) => item.name).join(", ") || "none"}`);
  return new Desktop({ port: matches[0].port });
}
