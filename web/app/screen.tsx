"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Camera, Maximize2, Minimize2, RefreshCw, WifiOff } from "lucide-react";

type Health = { ok: boolean; model?: string; error?: string };

// desktop.html is our own full-bleed viewer (novnc/desktop.html, copied into the
// image): no status bar above the canvas, and it posts its canvas geometry to us
// so PointerOverlay can align without measuring across origins.
const VNC_URL = "http://localhost:6080/desktop.html?autoconnect=true&path=websockify";
const VNC_ORIGIN = "http://localhost:6080";

/** Framebuffer size, fixed by the Xvfb geometry in docker-compose.yml. */
const FB_WIDTH = 1600;
const FB_HEIGHT = 900;

export function ScreenPane({ busy }: { busy: boolean }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const paneRef = useRef<HTMLElement>(null);

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
      ref={paneRef}
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

      <PointerOverlay active={online} paneRef={paneRef} iframeRef={iframeRef} />

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

/* -------------------------------------------------------------------------- */
/* Agent pointer                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Xvfb has no hardware cursor, and x11vnc sends the cursor as a client-side
 * shape — so noVNC draws an arrow wherever the *viewer's* mouse is, never where
 * xdotool actually moved the pointer. The user ends up watching clicks land with
 * no idea what the agent is aiming at. This overlay draws that pointer.
 *
 * It never intercepts input (`pointer-events-none` throughout): clicks in this
 * region must still reach the desktop canvas underneath.
 */

type Geometry = {
  /** Canvas offset within the pane, in CSS pixels. */
  left: number;
  top: number;
  /** Canvas size on screen, i.e. the framebuffer after noVNC's scaling. */
  width: number;
  height: number;
  fbWidth: number;
  fbHeight: number;
};

type PointerPayload = {
  ok?: boolean;
  x?: number;
  y?: number;
  click?: { x: number; y: number; button: number; at: number } | null;
};

const POLL_MS = 100;
/** How long a previous position stays visible behind the ring. */
const TRAIL_MS = 380;
const TRAIL_MAX = 5;
/** Grace period before trusting our own letterbox math over the viewer's report. */
const GEOMETRY_GRACE_MS = 2000;

function PointerOverlay({
  active,
  paneRef,
  iframeRef,
}: {
  active: boolean;
  paneRef: RefObject<HTMLElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
}) {
  const [reported, setReported] = useState<Geometry | null>(null);
  const [fallback, setFallback] = useState<Geometry | null>(null);
  const [graceOver, setGraceOver] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [trail, setTrail] = useState<{ x: number; y: number; at: number }[]>([]);
  const [ripple, setRipple] = useState<{ x: number; y: number; at: number } | null>(null);

  // desktop.html reports its own canvas rect, which is the only reliable
  // source: the iframe is cross-origin, so we cannot measure it from here.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== VNC_ORIGIN) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.type !== "vnc-geometry") return;
      const next: Geometry = {
        left: Number(data.left),
        top: Number(data.top),
        width: Number(data.width),
        height: Number(data.height),
        fbWidth: Number(data.fbWidth) || FB_WIDTH,
        fbHeight: Number(data.fbHeight) || FB_HEIGHT,
      };
      const sane =
        Number.isFinite(next.left) &&
        Number.isFinite(next.top) &&
        next.width > 0 &&
        next.height > 0 &&
        next.fbWidth > 0 &&
        next.fbHeight > 0;
      if (!sane) return;
      setReported((prev) =>
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height &&
        prev.fbWidth === next.fbWidth &&
        prev.fbHeight === next.fbHeight
          ? prev
          : next
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // The frame announces its geometry when it connects and whenever the canvas
  // moves, then stays quiet — so a listener that mounted after that first
  // announcement (StrictMode's double-mount, an HMR swap, a manual reconnect)
  // would wait forever for a message that never comes again. Ask for it until
  // we have it; desktop.html answers "request-geometry" with a forced report.
  useEffect(() => {
    if (reported) return;
    const ask = () =>
      iframeRef.current?.contentWindow?.postMessage({ type: "request-geometry" }, VNC_ORIGIN);
    ask();
    const id = setInterval(ask, 500);
    return () => clearInterval(id);
  }, [reported, iframeRef]);

  // Letterbox math off the pane, for the window between page load and the first
  // report (and if desktop.html is ever replaced by a viewer that stays quiet).
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const measure = () => {
      const rect = pane.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const scale = Math.min(rect.width / FB_WIDTH, rect.height / FB_HEIGHT);
      const width = FB_WIDTH * scale;
      const height = FB_HEIGHT * scale;
      setFallback({
        left: (rect.width - width) / 2,
        top: (rect.height - height) / 2,
        width,
        height,
        fbWidth: FB_WIDTH,
        fbHeight: FB_HEIGHT,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [paneRef]);

  useEffect(() => {
    const id = setTimeout(() => setGraceOver(true), GEOMETRY_GRACE_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!active) {
      setPos(null);
      setTrail([]);
      return;
    }
    let dead = false;
    let inFlight = false;
    // The daemon keeps the last click forever; adopt whatever is there on the
    // first read so a click from a previous turn doesn't ripple on mount.
    let lastClickAt: number | null = null;
    let last: { x: number; y: number } | null = null;

    const tick = async () => {
      if (dead || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const res = await fetch("/api/pointer", { cache: "no-store" });
        const json = (await res.json()) as PointerPayload;
        if (dead || json.ok === false) return;
        if (typeof json.x !== "number" || typeof json.y !== "number") return;

        const { x, y } = json;
        const now = Date.now();
        const previous = last;
        const moved = !previous || previous.x !== x || previous.y !== y;
        if (moved) last = { x, y };

        setPos((prev) => (prev && !moved ? prev : { x, y }));
        setTrail((prev) => {
          const fresh = prev.filter((p) => now - p.at < TRAIL_MS);
          if (moved && previous) return [{ ...previous, at: now }, ...fresh].slice(0, TRAIL_MAX);
          return fresh.length === prev.length ? prev : fresh;
        });

        const click = json.click;
        if (click && typeof click.at === "number") {
          if (lastClickAt !== null && click.at !== lastClickAt) {
            setRipple({ x: click.x, y: click.y, at: click.at });
          }
          lastClickAt = click.at;
        }
      } catch {
        // Container down or restarting — the health poll owns that message.
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [active]);

  const geometry = reported ?? (graceOver ? fallback : null);
  if (!geometry || !pos) return null;

  const project = (x: number, y: number) => ({
    left: geometry.left + (x / geometry.fbWidth) * geometry.width,
    top: geometry.top + (y / geometry.fbHeight) * geometry.height,
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {trail.map((point, i) => (
        <div
          key={`${point.at}-${i}`}
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400"
          style={{ ...project(point.x, point.y), opacity: 0.28 * (1 - i / TRAIL_MAX) }}
        />
      ))}

      {ripple && (
        // Keyed on the click timestamp so React remounts it and the one-shot
        // animation replays. The wrapper does the centering, because the
        // animation owns `transform` on the inner element.
        <div key={ripple.at} className="absolute" style={project(ripple.x, ripple.y)}>
          <div className="animate-vnc-ripple absolute -left-5 -top-5 size-10 rounded-full border-2 border-amber-300 bg-amber-300/20" />
        </div>
      )}

      {/* The agent's pointer. Deliberately NOT a plain arrow: noVNC already
          draws the remote cursor shape under the viewer's own mouse, so an
          unmarked arrow here would be indistinguishable from the user's. Amber
          + halo + label says "this one is eve's". Xvfb has no hardware cursor,
          so without this the desktop shows clicks landing from nowhere. */}
      <div className="absolute" style={project(pos.x, pos.y)}>
        <div className="absolute -left-3.5 -top-3.5 size-7 animate-pulse rounded-full bg-amber-400/20" />
        <div className="absolute -left-2.5 -top-2.5 size-5 rounded-full border border-amber-400/70 shadow-[0_0_12px_rgba(251,191,36,0.6)]" />
        {/* Hotspot is the arrow's tip, so this sits at the raw projected point. */}
        <svg
          viewBox="0 0 12 18"
          className="absolute left-0 top-0 h-[18px] w-[12px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
          aria-hidden
        >
          <path
            d="M1 1 L1 15.2 L4.7 11.6 L7.1 16.8 L9.5 15.7 L7.1 10.6 L11.4 10.2 Z"
            fill="#fbbf24"
            stroke="#1c1206"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
        <span className="absolute left-3.5 top-4 rounded bg-amber-400/90 px-1 py-px font-mono text-[9px] font-medium leading-tight text-amber-950 shadow-sm">
          eve
        </span>
      </div>
    </div>
  );
}

