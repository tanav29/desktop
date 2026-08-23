"use client";

import * as React from "react";

import type { DocHeading } from "@/lib/docs";
import { cn } from "@/lib/utils";

/**
 * "On this page" rail with scroll-spy. Server components pass the heading
 * outline; the observer tracks which section is in view.
 */
export function Toc({ items }: { items: DocHeading[] }) {
  const [activeId, setActiveId] = React.useState<string | undefined>(
    items[0]?.id
  );

  React.useEffect(() => {
    if (items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );

    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <aside className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] w-56 shrink-0 self-start overflow-y-auto py-8 pl-2 xl:block">
      <p className="mb-3 text-[13px] font-semibold tracking-tight">
        On this page
      </p>
      <ul className="space-y-2 border-l">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                "-ml-px block border-l border-transparent pl-3 text-[13px] leading-snug transition-colors",
                item.level === 3 && "pl-6",
                activeId === item.id
                  ? "border-foreground font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
