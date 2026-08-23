import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-32">
        <div className="text-center">
          <p className="font-mono text-sm text-muted-foreground">404</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tighter">
            This page doesn&apos;t exist.
          </h1>
          <p className="mt-3 text-muted-foreground">
            The doc you&apos;re looking for was moved or never existed.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild>
              <Link href="/docs/introduction">Back to the docs</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">Home</Link>
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}
