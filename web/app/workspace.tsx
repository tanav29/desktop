"use client";

import { useEffect, useRef, useState } from "react";
import { useEveAgent } from "eve/react";
import { ScreenPane } from "./screen";
import { SlackSettings } from "./slack-settings";
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
  Hash,
  RotateCcw,
  Send,
  Square,
  X,
} from "lucide-react";
import Markdown from 'react-markdown'

const SUGGESTIONS = [
  "Open a terminal and run htop so I can watch it",
  "Open Wikipedia in Chromium and show me the front page",
  "Write a python script that prints the first 20 Fibonacci numbers, then run it in a terminal",
];

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

function Dispatch({ invocation }: { invocation: any }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const name: string = invocation?.toolName ?? "tool";
  const args: unknown = invocation?.args ?? invocation?.input;
  const state: string = invocation?.state ?? "call";
  const result: unknown = invocation?.result;
  const running = state === "call" || state === "partial-call";
  const failed =
    !running &&
    (result == null ||
      (typeof result === "object" && (result as any)?.isError) ||
      (typeof result === "string" && result.startsWith("COMMAND FAILED")));
  const expanded = open ?? (running || failed);
  const argsPreview = (() => {
    const raw = fmt(args);
    return raw.length > 110 ? raw.slice(0, 110) + "…" : raw;
  })();
  const resultRaw = result == null ? "" : fmt(result);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/40",
        running && "border-l-2 border-l-amber-400",
        failed && "border-l-2 border-l-red-500",
        !running && !failed && "border-l-2 border-l-emerald-500/70"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => (o === null ? true : !o))}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left font-mono text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800/50"
      >
        {running ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-amber-400" />
        ) : failed ? (
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
          <div>
            <div className="text-[10px] font-medium text-zinc-500">input</div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-400">
              {fmt(args)}
            </pre>
          </div>
          {!running && result != null && (
            <div>
              <div className="text-[10px] font-medium text-zinc-500">result</div>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
                {resultRaw.length > 400 ? resultRaw.slice(0, 400) + "…" : resultRaw}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Workspace({ model }: { model: string }) {
  const agent = useEveAgent();
  const busy = agent.status === "submitted" || agent.status === "streaming";
  const [draft, setDraft] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [slackOpen, setSlackOpen] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [agent.data.messages, agent.status]);

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

  const statusLabel = busy ? "working" : agent.status === "error" ? "error" : "idle";
  const statusDot = busy
    ? "bg-amber-400 animate-pulse"
    : agent.status === "error"
      ? "bg-red-500"
      : "bg-emerald-400";

  const messages = agent.data.messages as any[];
  const lastMsg = messages[messages.length - 1];

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <main className="flex min-h-0 flex-1">
        {mounted ? (
          <ResizablePanelGroup orientation="horizontal" defaultLayout={{ chat: 34, screen: 66 }}>
            <ResizablePanel
              id="chat"
              minSize="24"
              maxSize="50"
              className="flex min-h-0 flex-col"
            >
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800/80 px-4">
              <span className="font-mono text-[11px] text-zinc-500">chat</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSlackOpen(true)}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
                >
                  <Hash className="size-3" />
                  slack
                </button>
                <button
                  type="button"
                  onClick={() => void agent.reset()}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
                >
                  <RotateCcw className="size-3" />
                  new session
                </button>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 px-4 py-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center gap-5 px-2 py-14 text-center">
                    <div className="grid size-12 place-items-center rounded-2xl bg-zinc-900 font-mono text-lg font-bold text-amber-400 ring-1 ring-zinc-800">
                      e
                    </div>
                    <p className="max-w-[280px] text-sm leading-relaxed text-zinc-400">
                      Tell eve what to do and watch it happen on the desktop —
                      open apps, run commands, click around.
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
                    const txt = m.parts
                      .filter((p: any) => p.type === "text")
                      .map((p: any) => p.text)
                      .join("");
                    if (!txt) return null;
                    return (
                      <div key={m.id} className="flex justify-end">
                        <div className="max-w-[85%] typeset typeset-docs whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-100 px-3.5 py-2 text-sm leading-relaxed text-zinc-900">
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
                            {ts()}
                          </span>
                        </div>
                        <div className="space-y-1 pt-2">
                          {m.parts.map((part: any, i: number) => {
                            switch (part.type) {
                              case "text":
                                return (
                                  <p className="text-xs leading-relaxed text-zinc-200 typeset typeset-docs" key={i}>
                                    <Markdown>
                                      {part.text}
                                    </Markdown>
                                    {isStreaming && i === m.parts.length - 1 && (
                                      <span className="animate-blink ml-0.5 inline-block h-3 w-0.5 translate-y-px rounded-sm bg-zinc-400 align-middle" />
                                    )}
                                  </p>
                                );
                              case "reasoning":
                                return (
                                  <details>
                                    <summary className="text-xs text-zinc-500 cursor-pointer select-none">
                                      Thinking...
                                    </summary>
                                  <pre
                                    className="whitespace-pre-wrap border-l-2 border-zinc-700 pl-2.5 font-mono text-[11px] leading-relaxed text-zinc-500"
                                    key={i}
                                  >
                                    {(part.text ?? part.reasoning ?? "").slice(0, 400)}
                                  </pre>
                                  </details>
                                );
                              case "tool-invocation": {
                                const ti = part.toolInvocation;
                                return (
                                  <Dispatch key={ti?.toolCallId ?? i} invocation={ti} />
                                );
                              }
                              case "dynamic-tool": {
                                const req = part.toolMetadata?.eve?.inputRequest;
                                if (!req) return null;
                                return (
                                  <div
                                    className="space-y-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 px-3 py-2.5"
                                    key={i}
                                  >
                                    <p className="text-xs font-medium text-zinc-200">
                                      {req.prompt}
                                    </p>
                                    {req.options?.length ? (
                                      <div className="flex flex-wrap gap-1.5">
                                        {req.options.map((o: any) => (
                                          <button
                                            key={o.id}
                                            type="button"
                                            onClick={() =>
                                              void agent.respond([
                                                { requestId: req.requestId, optionId: o.id },
                                              ])
                                            }
                                            className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-amber-400/50 hover:text-amber-300"
                                          >
                                            {o.label}
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                    {req.allowFreeform ? (
                                      <form
                                        className="flex gap-2"
                                        onSubmit={(e) => {
                                          e.preventDefault();
                                          const fd = new FormData(e.currentTarget);
                                          const text = String(fd.get("answer") ?? "").trim();
                                          if (text)
                                            void agent.respond([
                                              { requestId: req.requestId, text },
                                            ]);
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
                              default:
                                return null;
                            }
                          })}
                        </div>
                      </div>
                    </article>
                  );
                })}
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
          </ResizablePanel>

          <ResizableHandle
            withHandle
            className="bg-zinc-800/80 data-[orientation=vertical]:w-px"
          />

          <ResizablePanel
            id="screen"
            minSize="30"
            className="min-h-0 bg-black"
          >
            <ScreenPane busy={busy} />
          </ResizablePanel>
        </ResizablePanelGroup>
        ) : (
          <div className="flex min-h-0 w-full min-w-0">
            <div className="flex w-[34%] min-w-0 flex-col border-r border-zinc-800/80">
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800/80 px-4">
                <span className="font-mono text-[11px] text-zinc-500">chat</span>
                <button
                  type="button"
                  onClick={() => void agent.reset()}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
                >
                  <RotateCcw className="size-3" />
                  new session
                </button>
              </div>
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

      <SlackSettings open={slackOpen} onClose={() => setSlackOpen(false)} />
    </div>
  );
}
