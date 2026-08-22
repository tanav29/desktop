"use client";

import { useEffect, useRef, useState } from "react";
import { useEveAgent } from "eve/react";
import { ScreenPane } from "./screen";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  Send,
  Square,
  X,
} from "lucide-react";
import Markdown from "react-markdown";

const SUGGESTIONS = [
  "Open Wikipedia in Chromium and send me a screenshot of the front page",
  "Open a terminal and run htop so I can watch it",
  "Write a python script that prints the first 20 Fibonacci numbers, run it in a terminal, then show me the output",
];

/** Files this app serves out of the shared workspace via /api/media. */
function isMediaUrl(url: unknown): url is string {
  return typeof url === "string" && url.startsWith("/api/media/");
}

/** Videos need a player; stills (including GIF timelapses) are just images. */
function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm)(\?|$)/i.test(url);
}

type Media = { url: string; caption?: string };

/**
 * Media the agent posted into the chat. `share_screenshot` and
 * `share_recording` return a `media` field for exactly this purpose, so the
 * attachment renders whether or not the model remembers to mention it.
 */
function mediaFromOutput(output: unknown): Media | null {
  if (!output || typeof output !== "object") return null;
  const raw = (output as { media?: unknown }).media;
  if (!raw || typeof raw !== "object") return null;
  const { url, caption } = raw as { url?: unknown; caption?: unknown };
  if (!isMediaUrl(url)) return null;
  return { url, caption: typeof caption === "string" ? caption : undefined };
}

/** One image or video posted into the conversation, with a download link. */
function MediaCard({ url, caption }: Media) {
  return (
    <figure className="my-2 max-w-[460px] overflow-hidden rounded-lg border border-zinc-800 bg-black">
      {isVideoUrl(url) ? (
        <video controls preload="metadata" className="block w-full" src={url} />
      ) : (
        <img src={url} alt={caption ?? "desktop capture"} className="block w-full" />
      )}
      <figcaption className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[10px] font-mono text-zinc-500">
        <span className="truncate">{caption ?? "desktop capture"}</span>
        <a
          href={url}
          download
          className="shrink-0 rounded px-1.5 py-0.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-amber-300"
        >
          download ↓
        </a>
      </figcaption>
    </figure>
  );
}

function ts(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 1);
  } catch {
    return String(v);
  }
}

type ToolStatus = "running" | "waiting" | "done" | "failed";

/**
 * eve projects every tool call as a `dynamic-tool` part whose `state` walks the
 * call lifecycle. Map that to the three things the UI cares about.
 */
function toolStatus(part: any): ToolStatus {
  switch (part?.state) {
    case "output-available":
      return part.partial ? "running" : "done";
    case "output-error":
    case "output-denied":
      return "failed";
    case "approval-requested":
      return "waiting";
    default:
      // input-streaming, input-available, approval-responded
      return "running";
  }
}

/** Collapsible record of one tool call: name, input, and result. */
function Dispatch({ part }: { part: any }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const name: string = part?.toolMetadata?.eve?.name ?? part?.toolName ?? "tool";
  const status = toolStatus(part);
  const settled = status === "done" || status === "failed";

  // Failures and in-flight calls open themselves; successes stay tucked away.
  const expanded = open ?? status !== "done";

  const argsPreview = (() => {
    if (part?.input === undefined) return "";
    const raw = fmt(part.input);
    return raw.length > 110 ? raw.slice(0, 110) + "…" : raw;
  })();

  const resultText = (() => {
    if (status === "failed") return part?.errorText ?? fmt(part?.output) ?? "failed";
    if (part?.output === undefined) return "";
    return fmt(part.output);
  })();

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/40",
        status === "running" && "border-l-2 border-l-amber-400",
        status === "waiting" && "border-l-2 border-l-sky-400",
        status === "failed" && "border-l-2 border-l-red-500",
        status === "done" && "border-l-2 border-l-emerald-500/70"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => (o === null ? status === "done" : !o))}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left font-mono text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800/50"
      >
        {status === "running" || status === "waiting" ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-amber-400" />
        ) : status === "failed" ? (
          <X className="size-3 shrink-0 text-red-400" />
        ) : (
          <Check className="size-3 shrink-0 text-emerald-400" />
        )}
        <span className="shrink-0 font-medium text-zinc-200">{name}</span>
        <span className="min-w-0 flex-1 truncate text-zinc-500">{argsPreview}</span>
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-zinc-500" />
        )}
      </button>
      {expanded && (
        <div className="space-y-2.5 border-t border-zinc-800/80 px-2.5 py-2.5">
          {part?.input !== undefined && (
            <div>
              <div className="text-[10px] font-medium text-zinc-500">input</div>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-400">
                {fmt(part.input)}
              </pre>
            </div>
          )}
          {settled && resultText && (
            <div>
              <div className="text-[10px] font-medium text-zinc-500">
                {status === "failed" ? "error" : "result"}
              </div>
              <pre
                className={cn(
                  "mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed",
                  status === "failed" ? "text-red-300" : "text-zinc-300"
                )}
              >
                {resultText.length > 400 ? resultText.slice(0, 400) + "…" : resultText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The HITL prompt eve raises when a tool needs a person to answer. */
function InputRequest({
  request,
  onRespond,
}: {
  request: any;
  onRespond: (response: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 px-3 py-2.5">
      <p className="text-xs font-medium text-zinc-200">{request.prompt}</p>
      {request.options?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {request.options.map((o: any) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onRespond({ requestId: request.requestId, optionId: o.id })}
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-amber-400/50 hover:text-amber-300"
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
      {request.allowFreeform ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const text = String(fd.get("answer") ?? "").trim();
            if (text) onRespond({ requestId: request.requestId, text });
          }}
        >
          <input
            name="answer"
            placeholder="Type an answer…"
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-amber-400/50 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-white"
          >
            answer
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Fallback for when the agent never called `share_recording`: the hook compiles
 * a timelapse at the end of every turn, so probe for it and show it once it
 * lands. Silent while waiting — no spinner noise if there's no recording.
 */
function SessionRecordingCard({ sessionId }: { sessionId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let dead = false;
    setSrc(null);
    const url = `/api/media/recordings/${sessionId}/session.gif`;
    let timer: ReturnType<typeof setTimeout>;

    // ImageMagick needs a moment after the turn ends; poll quietly for ~2 min.
    let tries = 0;
    const tick = async () => {
      if (dead || tries++ > 30) return;
      try {
        const res = await fetch(url, { method: "HEAD", cache: "no-store" });
        if (dead) return;
        if (res.ok && Number(res.headers.get("content-length") ?? 0) > 1000) {
          setSrc(url);
          return;
        }
      } catch {
        /* server hiccup — keep trying */
      }
      if (!dead) timer = setTimeout(tick, 4000);
    };

    timer = setTimeout(tick, 2000);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  if (!src) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left font-mono text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800/50"
      >
        <span className="text-amber-400">▶</span>
        <span className="shrink-0 font-medium text-zinc-200">session recording</span>
        <span className="min-w-0 flex-1 truncate text-zinc-500">desktop timelapse</span>
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-zinc-500" />
        )}
      </button>
      {open && (
        <div className="border-t border-zinc-800/80 p-2">
          <MediaCard url={src} caption="session timelapse" />
        </div>
      )}
    </div>
  );
}

/** Markdown renderers shared by every assistant text block. */
const MARKDOWN_COMPONENTS = {
  // Screenshots the agent linked in prose render inline.
  img: ({ alt, src }: any) =>
    isMediaUrl(src) ? (
      <MediaCard url={src} caption={alt ?? undefined} />
    ) : (
      <img
        src={typeof src === "string" ? src : undefined}
        alt={alt ?? ""}
        className="my-2 max-h-72 rounded-lg border border-zinc-800"
      />
    ),
  // Links to media become players/images; everything else stays a link.
  a: ({ href, children }: any) => {
    const h = typeof href === "string" ? href : "";
    if (isMediaUrl(h)) return <MediaCard url={h} />;
    return (
      <a
        href={h}
        target="_blank"
        rel="noreferrer"
        className="text-amber-300 underline decoration-zinc-700 underline-offset-2 hover:decoration-amber-300"
      >
        {children}
      </a>
    );
  },
};

export function Workspace({ model }: { model: string }) {
  const agent = useEveAgent();
  const busy = agent.status === "submitted" || agent.status === "streaming";
  const [draft, setDraft] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const messages = agent.data.messages as any[];
  const lastMsg = messages[messages.length - 1];

  // Stamp each message the first time we see it. Calling ts() inline made every
  // message show the current clock and re-label itself on each render.
  const clock = useRef(new Map<string, string>());
  for (const m of messages) {
    if (!clock.current.has(m.id)) clock.current.set(m.id, ts());
  }

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, agent.status]);

  useEffect(() => {
    setBanner(agent.error ? agent.error.message : null);
  }, [agent.error]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setDraft("");
    if (textRef.current) textRef.current.style.height = "auto";
    void agent.send(t);
  };

  // The agent already posted a recording, so don't also show the auto fallback.
  const sharedRecording = messages.some((m: any) =>
    m.parts?.some(
      (p: any) =>
        p.type === "dynamic-tool" &&
        p.state === "output-available" &&
        isVideoUrlOrGif(mediaFromOutput(p.output)?.url)
    )
  );

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const chatHeader = (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800/80 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-[11px] text-zinc-500">chat</span>
        <span className="truncate font-mono text-[10px] text-zinc-600" title={model}>
          {model}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void agent.reset()}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
      >
        <RotateCcw className="size-3" />
        new session
      </button>
    </div>
  );

  const chat = (
    <>
      {chatHeader}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-4 py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-5 px-2 py-14 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-zinc-900 font-mono text-lg font-bold text-amber-400 ring-1 ring-zinc-800">
                e
              </div>
              <p className="max-w-[280px] text-sm leading-relaxed text-zinc-400">
                Tell eve what to do and watch it happen on the desktop — open
                apps, run commands, click around. Ask for a screenshot and it
                lands right here in the chat.
              </p>
              <div className="flex w-full max-w-[360px] flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3.5 py-2.5 text-left text-[13px] leading-relaxed text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                  >
                    <span className="flex-1">{s}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-zinc-600 transition-colors group-hover:text-amber-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {banner && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {banner}
            </div>
          )}

          {messages.map((m: any) => {
            if (m.role === "user") {
              const txt = (m.parts ?? [])
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("");
              if (!txt) return null;
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="typeset typeset-docs max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-100 px-3.5 py-2 text-sm leading-relaxed text-zinc-900">
                    {txt}
                  </div>
                </div>
              );
            }

            const isStreaming = busy && m.id === lastMsg?.id;
            return (
              <article key={m.id} className="flex justify-start">
                <div className="w-full max-w-full">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-200">eve</span>
                    <span className="text-[10px] tabular-nums text-zinc-500">
                      {clock.current.get(m.id)}
                    </span>
                  </div>
                  <div className="space-y-1 pt-2">
                    {(m.parts ?? []).map((part: any, i: number) => {
                      switch (part.type) {
                        case "text": {
                          if (!part.text) return null;
                          return (
                            <div
                              key={i}
                              className="typeset typeset-docs text-xs leading-relaxed text-zinc-200"
                            >
                              <Markdown components={MARKDOWN_COMPONENTS}>
                                {part.text}
                              </Markdown>
                              {isStreaming && i === m.parts.length - 1 && (
                                <span className="animate-blink ml-0.5 inline-block h-3 w-0.5 translate-y-px rounded-sm bg-zinc-400 align-middle" />
                              )}
                            </div>
                          );
                        }

                        case "reasoning": {
                          const text = part.text ?? "";
                          if (!text) return null;
                          return (
                            <details key={i}>
                              <summary className="cursor-pointer select-none text-xs text-zinc-500">
                                Thinking…
                              </summary>
                              <pre className="whitespace-pre-wrap border-l-2 border-zinc-700 pl-2.5 font-mono text-[11px] leading-relaxed text-zinc-500">
                                {text.slice(0, 400)}
                              </pre>
                            </details>
                          );
                        }

                        // Every tool call arrives as `dynamic-tool`; the old
                        // code looked for a `tool-invocation` type that eve
                        // never emits, so nothing rendered at all.
                        case "dynamic-tool": {
                          const request = part.toolMetadata?.eve?.inputRequest;
                          const media =
                            part.state === "output-available"
                              ? mediaFromOutput(part.output)
                              : null;
                          return (
                            <div key={part.toolCallId ?? i} className="space-y-1">
                              <Dispatch part={part} />
                              {media && <MediaCard {...media} />}
                              {request && part.state === "approval-requested" && (
                                <InputRequest
                                  request={request}
                                  onRespond={(r) => void agent.respond([r as any])}
                                />
                              )}
                            </div>
                          );
                        }

                        case "file": {
                          if (!isMediaUrl(part.url)) return null;
                          return (
                            <MediaCard key={i} url={part.url} caption={part.filename} />
                          );
                        }

                        default:
                          // step-start, authorization, …
                          return null;
                      }
                    })}
                  </div>
                </div>
              </article>
            );
          })}

          {/* Compiled desktop timelapse, unless the agent already posted one. */}
          {!busy && !sharedRecording && agent.session?.sessionId && messages.length > 0 && (
            <SessionRecordingCard
              key={`${agent.session.sessionId}:${messages.length}`}
              sessionId={agent.session.sessionId}
            />
          )}
          <div ref={tailRef} />
        </div>
      </ScrollArea>

      {/* ── composer ─────────────────────────────────── */}
      <div className="shrink-0 border-t border-zinc-800/80 p-3.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <div className="relative">
            <textarea
              ref={textRef}
              rows={1}
              value={draft}
              placeholder="What should eve do next?"
              disabled={busy}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              className="min-h-[48px] w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/60 pb-10 pl-3.5 pr-12 pt-2.5 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-zinc-700 focus:outline-none disabled:opacity-60"
            />
            {busy ? (
              <button
                type="button"
                title="Stop"
                aria-label="Stop"
                onClick={() => void agent.cancel()}
                className="absolute bottom-4 right-2 grid size-8 place-items-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
              >
                <Square className="size-3.5" />
              </button>
            ) : (
              <button
                type="submit"
                title="Send"
                aria-label="Send"
                disabled={!draft.trim()}
                className="absolute bottom-4 right-2 grid size-8 place-items-center rounded-lg bg-amber-400 text-zinc-950 transition-all hover:bg-amber-300 disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                <Send className="size-3.5" />
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <main className="flex min-h-0 flex-1">
        {mounted ? (
          <ResizablePanelGroup
            orientation="horizontal"
            defaultLayout={{ chat: 34, screen: 66 }}
          >
            <ResizablePanel id="chat" minSize="24" maxSize="50" className="flex min-h-0 flex-col">
              {chat}
            </ResizablePanel>

            <ResizableHandle
              withHandle
              className="bg-zinc-800/80 data-[orientation=vertical]:w-px"
            />

            <ResizablePanel id="screen" minSize="30" className="min-h-0 bg-black">
              <ScreenPane busy={busy} />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex min-h-0 w-full min-w-0">
            <div className="flex w-[34%] min-w-0 flex-col border-r border-zinc-800/80">
              {chatHeader}
              <div className="flex min-h-0 flex-1 items-center justify-center font-mono text-[11px] text-zinc-600">
                eve desktop operator
              </div>
              <div className="shrink-0 border-t border-zinc-800/80 p-3.5" />
            </div>
            <div className="min-h-0 flex-1 bg-black">
              <ScreenPane busy={busy} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** True for any timelapse the agent may have posted (GIF today, MP4 if swapped). */
function isVideoUrlOrGif(url: string | undefined): boolean {
  return !!url && /\.(gif|mp4|webm)(\?|$)/i.test(url);
}
