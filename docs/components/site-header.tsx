import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileNav } from "@/components/docs-sidebar";

export function Wordmark() {
  return (
    <Link href="/" className="group flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-[4px] bg-foreground font-mono text-[10px] font-bold text-background transition-opacity group-hover:opacity-80">
        _
      </span>
      <span className="font-semibold tracking-tight">desktop</span>
      <Badge
        variant="outline"
        className="rounded px-1.5 py-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
      >
        docs
      </Badge>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileNav />
        <Wordmark />
        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/docs/introduction">Docs</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/docs/quickstart">Quickstart</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/docs/sdk">SDK</Link>
          </Button>
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
          <Separator orientation="vertical" className="mx-1 hidden !h-4 sm:block" />
          <Button variant="ghost" size="sm" asChild className="hidden sm:flex">
            <Link
              href="https://github.com/tanav29/desktop"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-muted-foreground"
            >
              GitHub ↗
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
