import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

import type { NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

function PagerLink({
  item,
  direction,
}: {
  item: NavItem;
  direction: "prev" | "next";
}) {
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex min-w-0 flex-1 flex-col gap-1 rounded-lg border p-4 transition-colors hover:bg-muted/50",
        direction === "prev" ? "items-start" : "items-end text-right"
      )}
    >
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {direction === "prev" && (
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
        )}
        {direction === "prev" ? "Previous" : "Next"}
        {direction === "next" && (
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        )}
      </span>
      <span className="truncate text-sm font-medium">{item.title}</span>
    </Link>
  );
}

export function Pager({
  prev,
  next,
}: {
  prev?: NavItem;
  next?: NavItem;
}) {
  if (!prev && !next) return null;

  return (
    <div className="mt-16 flex gap-4 border-t pt-8">
      {prev ? <PagerLink item={prev} direction="prev" /> : <span className="flex-1" />}
      {next ? <PagerLink item={next} direction="next" /> : <span className="flex-1" />}
    </div>
  );
}
