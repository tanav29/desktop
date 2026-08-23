"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, X } from "lucide-react";

import { nav } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function NavList({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const [query, setQuery] = React.useState("");

  const sections = nav
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        item.title.toLowerCase().includes(query.trim().toLowerCase())
      ),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className={className}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter pages…"
          className="h-8 rounded-md bg-background pl-8 text-sm"
        />
        {query ? (
          <button
            aria-label="Clear filter"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <nav className="mt-5 space-y-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-2 text-[13px] font-semibold tracking-tight text-foreground">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={
                        "block rounded-md px-2 py-1.5 text-sm transition-colors " +
                        (active
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
                      }
                    >
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {sections.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No pages match.</p>
        ) : null}
      </nav>
    </div>
  );
}

/** Desktop sidebar column. */
export function Sidebar() {
  return (
    <aside className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] w-60 shrink-0 self-start overflow-y-auto py-8 pr-4 lg:block">
      <NavList />
    </aside>
  );
}

/** Mobile: hamburger in the docs toolbar opens the same nav in a sheet. */
export function MobileNav() {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          className="lg:hidden"
        >
          <Menu className="size-4.5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 overflow-y-auto p-0">
        <SheetTitle className="sr-only">Documentation navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Browse the documentation pages.
        </SheetDescription>
        <div className="border-b p-4">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2"
          >
            <span className="flex size-5 items-center justify-center rounded-[4px] bg-foreground font-mono text-[10px] font-bold text-background">
              _
            </span>
            <span className="font-semibold tracking-tight">desktop</span>
            <span className="rounded border px-1 py-px font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              docs
            </span>
          </Link>
        </div>
        <NavList className="p-4" onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
