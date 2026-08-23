import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Braces,
  Eye,
  Monitor,
  RotateCcw,
  Server,
} from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { HeroTerminal } from "@/components/hero-terminal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const features = [
  {
    icon: Monitor,
    title: "A real desktop",
    body: "Debian 13 + XFCE + Chromium in one container, capped at 2 CPU / 3 GB. Xvfb on :99, noVNC in your browser.",
    href: "/docs/image",
    link: "The computer image",
  },
  {
    icon: Server,
    title: "One HTTP daemon",
    body: "xdotool, ImageMagick and bash behind a clean API on port 8095. Shell quoting and process cleanup handled for you.",
    href: "/docs/daemon",
    link: "Daemon API",
  },
  {
    icon: Braces,
    title: "TypeScript SDK",
    body: "actions, cmd, create, kill, screenshot, live, frames — every call is one millisecond-level round-trip.",
    href: "/docs/sdk",
    link: "SDK reference",
  },
  {
    icon: Eye,
    title: "Watch it work",
    body: "noVNC viewer for humans, MJPEG stream + JPEG frame generator for agents and vision models.",
    href: "/docs/sdk#live-frames-watch-it-move",
    link: "live() and frames()",
  },
  {
    icon: RotateCcw,
    title: "Disposable by design",
    body: "Boot with one command, reset with docker compose down. Only ./workspace persists — nothing to clean up.",
    href: "/docs/docker",
    link: "Docker setup",
  },
  {
    icon: Boxes,
    title: "Model-agnostic",
    body: "Plain HTTP end to end. Claude, GPT, Gemini, GLM or a bash script — if it can call an API, it can drive the computer.",
    href: "/docs/architecture",
    link: "Architecture",
  },
];

const architecture = `┌──────────────────── your machine ────────────────────┐
│                                                      │
│   web UI (Next.js) ────── eve agent                  │
│     (chat + live        (tools + loop)               │
│      desktop pane)                                   │
│                           │                          │
│                    computer-use-sdk                  │
│                           │ HTTP                     │
│                           ▼                          │
│   ┌──────────── Docker container ─────────────┐      │
│   │  daemon :8095   every call = 1 round-trip │      │
│   │    │                                      │      │
│   │  XFCE on Xvfb :99  ·  xdotool             │      │
│   │  x11vnc → websockify → noVNC :6080        │      │
│   │  Chromium · xfce4-terminal · ImageMagick  │      │
│   └───────────────────────────────────────────┘      │
│                           │                          │
│              ./workspace persists on host            │
└──────────────────────────────────────────────────────┘`;

const sdkExample = `import { computer } from "computer-use-sdk";

// launch an app with a unique title
await computer.create("chromium https://example.com", {
  title: "web-1",
});

// a whole input sequence in ONE round-trip
await computer.actions([
  { do: "wait_for", window: "Chromium", timeoutMs: 45_000 },
  { do: "focus",    window: "Chromium" },
  { do: "key",      keys: "ctrl+l" },
  { do: "paste",    text: "https://news.ycombinator.com" },
  { do: "key",      keys: "Return" },
]);

await computer.screenshot("state.png"); // → workspace/state.png
const feed = await computer.live();     // watch it move
await computer.kill("web-1");           // dispose`;

export default function LandingPage() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b">
          <div
            aria-hidden
            className="bg-dots absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black_20%,transparent)]"
          />
          <div className="relative mx-auto max-w-5xl px-4 py-24 text-center sm:px-6 lg:px-8 lg:py-32">
            <Badge
              variant="outline"
              className="mb-6 rounded-full bg-background px-3 py-1 font-mono text-xs font-normal tracking-wide text-muted-foreground"
            >
              computer-use environment for agents
            </Badge>
            <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tighter sm:text-6xl">
              Give your agent{" "}
              <span className="text-muted-foreground">a real computer.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
              A lightweight Linux desktop that runs entirely inside Docker —
              with an HTTP daemon and TypeScript SDK so any model can drive it:
              shell, GUI apps, browser, keyboard, mouse, screen.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/docs/introduction">
                  Read the docs
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/docs/quickstart">Quickstart</Link>
              </Button>
            </div>

            <HeroTerminal />

            <p className="mt-8 font-mono text-xs text-muted-foreground">
              :6080 noVNC viewer&nbsp;&nbsp;·&nbsp;&nbsp;:8095 HTTP
              daemon&nbsp;&nbsp;·&nbsp;&nbsp;:8090 live stream
            </p>
          </div>
        </section>

        {/* Features */}
        <section className="border-b">
          <div className="mx-auto max-w-screen-2xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <Link
                  key={feature.title}
                  href={feature.href}
                  className="group relative flex flex-col gap-3 bg-background p-6 transition-colors hover:bg-muted/40"
                >
                  <feature.icon className="size-5 text-foreground" />
                  <div>
                    <p className="font-medium">{feature.title}</p>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      {feature.body}
                    </p>
                  </div>
                  <span className="mt-auto pt-1 font-mono text-xs text-muted-foreground underline-offset-4 group-hover:underline">
                    {feature.link} →
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Architecture */}
        <section className="border-b">
          <div className="mx-auto grid max-w-screen-2xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-24">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Architecture
              </p>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
                Three layers, each replaceable.
              </h2>
              <p className="mt-4 max-w-md text-pretty leading-7 text-muted-foreground">
                Every control surface is one HTTP round-trip to a process inside
                the container — milliseconds per call instead of ~150 ms+
                spawning <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">docker exec</code> per action.
                And each computer is just a port.
              </p>
              <ul className="mt-8 space-y-5">
                {[
                  ["Container", "Real GUI desktop: Xvfb → XFCE → x11vnc → noVNC.", "Swap with any X11 desktop"],
                  ["Daemon", "Python-stdlib HTTP API over xdotool / ImageMagick / bash.", "Swap with anything that speaks HTTP"],
                  ["SDK", "Thin TS client: actions, cmd, create, kill, screenshot, live, frames.", "Swap with raw fetch() calls"],
                ].map(([title, body, swap]) => (
                  <li key={title} className="flex gap-4">
                    <Separator orientation="vertical" className="!h-auto" />
                    <div>
                      <p className="text-sm font-medium">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {body}{" "}
                        <span className="text-foreground/70">— {swap}.</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="overflow-x-auto rounded-xl border bg-muted/30 p-4 dark:bg-muted/20">
              <pre className="min-w-max p-2 font-mono text-[10.5px] leading-[1.55] sm:text-xs">
                {architecture}
              </pre>
            </div>
          </div>
        </section>

        {/* SDK example */}
        <section className="border-b">
          <div className="mx-auto grid max-w-screen-2xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-24">
            <div className="order-last overflow-hidden rounded-xl border lg:order-first">
              <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                <span className="font-mono text-xs text-muted-foreground">
                  drive.ts
                </span>
                <Link
                  href="/docs/sdk"
                  className="font-mono text-xs text-muted-foreground hover:text-foreground"
                >
                  full API →
                </Link>
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-xs leading-6 sm:text-[13px]">
                {sdkExample}
              </pre>
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Drive it from code
              </p>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
                Batched actions. One round-trip.
              </h2>
              <p className="mt-4 max-w-md text-pretty leading-7 text-muted-foreground">
                Wait for a window, focus it, paste a URL, hit enter — in a
                single request. When a language model is the caller, one call
                per task beats one call per keystroke every time.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button variant="outline" asChild>
                  <Link href="/docs/quickstart">
                    Run the smoke test
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section>
          <div className="mx-auto max-w-5xl px-4 py-24 text-center sm:px-6 lg:py-32">
            <h2 className="text-balance text-3xl font-semibold tracking-tighter sm:text-5xl">
              Boot your first computer.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-pretty leading-7 text-muted-foreground">
              One command, two minutes, zero host dependencies beyond Docker.
              Reset whenever you like.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/docs/quickstart">
                  Get started
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button size="lg" variant="ghost" asChild>
                <Link href="/docs/troubleshooting">Troubleshooting</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <p>
            <span className="font-medium text-foreground">desktop</span> — a
            computer-use environment for agents.
          </p>
          <div className="flex items-center gap-6">
            <Link href="/docs/introduction" className="hover:text-foreground">
              Docs
            </Link>
            <Link href="/docs/docker" className="hover:text-foreground">
              Docker
            </Link>
            <Link href="/docs/sdk" className="hover:text-foreground">
              SDK
            </Link>
            <Link href="/docs/daemon" className="hover:text-foreground">
              Daemon
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
