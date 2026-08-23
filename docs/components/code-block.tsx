"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import type { Element } from "hast";

import { Button } from "@/components/ui/button";

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (
    typeof node === "object" &&
    "props" in node &&
    node.props &&
    typeof node.props === "object" &&
    "children" in node.props
  ) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function languageFromClassName(className?: string | string[]) {
  const value = Array.isArray(className) ? className.join(" ") : className;
  return /language-([\w-]+)/.exec(value ?? "")?.[1];
}

/**
 * Language label for a code block. react-markdown hands the `pre` override
 * both the rendered React children and the original hast node; depending on
 * the RSC/serialization path either one may be the reliable source, so try
 * both.
 */
export function extractLanguage(
  children: React.ReactNode,
  node?: Element
): string | undefined {
  if (children && typeof children === "object" && "props" in children) {
    const className = (children.props as { className?: string }).className;
    const fromChildren = languageFromClassName(className);
    if (fromChildren) return fromChildren;
  }
  const first = node?.children?.[0];
  if (first && first.type === "element") {
    return languageFromClassName(first.properties?.className as string[]);
  }
  return undefined;
}

/**
 * Markdown code block: bordered panel with a language label and a copy
 * button. Used as the `pre` override for react-markdown.
 */
export function CodeBlock({
  children,
  node,
}: {
  children?: React.ReactNode;
  node?: Element;
}) {
  const [copied, setCopied] = React.useState(false);
  const preRef = React.useRef<HTMLPreElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const language = extractLanguage(children, node);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onCopy() {
    const text = preRef.current?.innerText ?? extractText(children);
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ""));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  return (
    <div className="group/code relative my-6 overflow-hidden rounded-lg border bg-muted/40 dark:bg-muted/25">
      <div className="flex items-center justify-between border-b bg-background/50 px-3 py-1.5">
        <span className="font-mono text-xs tracking-wide text-muted-foreground">
          {language ?? "text"}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={onCopy}
          className="text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      <pre
        ref={preRef}
        className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed"
      >
        {children}
      </pre>
    </div>
  );
}
