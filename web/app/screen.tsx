"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Camera, ExternalLink, Maximize2, Minimize2, RefreshCw, WifiOff } from "lucide-react";

type Health = { ok: boolean; model?: string; error?: string };

const VNC_URL =
  "http://localhost:6080/vnc_lite.html?autoconnect=true&host=localhost&port=6080&resize=scale&reconnect=true&reconnect_delay=2000";

export function ScreenPane({ busy }: { busy: boolean }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let dead = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const json = (await res.json()) as Health;
        if (!dead) setHealth(json);
      } catch {
        if (!dead) setHealth({ ok: false, error: "web server unreachable" });
      }
    };
    void poll();
    const id = setInterval(poll, 5000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const reload = () => {
    if (!iframeRef.current) return;
    const src = iframeRef.current.src;
    iframeRef.current.src = "about:blank";
    requestAnimationFrame(() => {
      iframeRef.current!.src = src;
    });
  };

  const online = health?.ok ?? false;
  const checking = health === null;

  return (
    <section
      className={cn(
        "relative h-full w-full shrink-0 overflow-hidden bg-black",
        fullscreen && "fixed inset-0 z-50"
      )}
    >
      <iframe
        ref={iframeRef}
        className="absolute inset-0 h-full w-full border-0"
        src={VNC_URL}
        title="Linux desktop"
        allow="fullscreen"
      />

      {/* connection status */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-950/60 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 backdrop-blur-md">
        <span
          className={cn(
            "size-1.5 rounded-full",
            online ? "bg-emerald-400" : checking ? "animate-pulse bg-zinc-500" : "bg-red-500"
          )}
        />
        {checking ? "checking…" : online ? "desktop online" : "desktop offline"}
      </div>

      {/* actions */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-white/10 bg-zinc-950/60 p-1 backdrop-blur-md">
        <IconBtn onClick={reload} label="Reconnect" icon={<RefreshCw className="size-3.5" />} />
        <IconBtn
          onClick={() => setFullscreen((f) => !f)}
          label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          icon={fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        />
      </div>

      {/* telemetry strip */}
      <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-1.5 font-mono text-[11px] text-zinc-400 backdrop-blur-md">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              busy ? "animate-pulse bg-amber-400" : "bg-emerald-400"
            )}
          />
          <span className="truncate">{busy ? "eve is working" : "eve idle"}</span>
          <span className="hidden text-zinc-500 sm:inline">·</span>
          <span className="hidden text-zinc-500 sm:inline">1600 × 900</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <a
            href="/api/screenshot"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Camera className="size-3" />
            screenshot
          </a>
          <a
            href="http://localhost:6080/vnc.html"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ExternalLink className="size-3" />
            full client
          </a>
        </span>
      </div>

      {/* offline overlay */}
      {!online && !checking && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-zinc-950/70 backdrop-blur-sm">
          <div className="mx-6 max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 text-center shadow-2xl">
            <div className="mx-auto grid size-10 place-items-center rounded-xl bg-red-500/10">
              <WifiOff className="size-5 text-red-400" />
            </div>
            <p className="mt-3 text-sm font-medium text-zinc-100">The desktop machine isn't running</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
              Start the container and it will reconnect by itself — no need to
              reload.
            </p>
            <code className="mt-4 block rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left font-mono text-xs text-amber-300">
              docker compose up -d --build
            </code>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 w-full rounded-lg border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              onClick={reload}
            >
              Try again
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function IconBtn({
  onClick,
  label,
  icon,
}: {
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-7 place-items-center rounded-md text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
    >
      {icon}
    </button>
  );
}