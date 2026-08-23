"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

/**
 * The fake terminal on the landing page hero. Static lines + a copy button
 * for the boot command.
 */
export function HeroTerminal() {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText("docker compose up -d --build");
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  return (
    <div className="relative mx-auto mt-12 w-full max-w-2xl overflow-hidden rounded-xl border bg-muted/40 text-left shadow-sm">
      <div className="flex items-center gap-1.5 border-b bg-background/60 px-4 py-2.5">
        <span className="size-2.5 rounded-full border" />
        <span className="size-2.5 rounded-full border" />
        <span className="size-2.5 rounded-full border" />
        <span className="ml-3 font-mono text-xs text-muted-foreground">
          your-machine
        </span>
        <button
          onClick={onCopy}
          aria-label={copied ? "Copied" : "Copy command"}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="size-3.5" /> copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-7 sm:text-sm">
        <code>
          <span className="text-muted-foreground">$</span> git clone{"\n"}
          {"  "}https://github.com/tanav29/desktop && cd desktop{"\n"}
          <span className="text-muted-foreground">$</span> docker compose up -d
          --build{"\n"}
          <span className="text-muted-foreground"># wait for healthy…</span>
          {"\n"}
          <span className="text-muted-foreground">$</span> open
          http://localhost:6080/vnc.html
        </code>
      </pre>
    </div>
  );
}
