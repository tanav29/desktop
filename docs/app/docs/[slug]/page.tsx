import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { getAllSlugs, getDoc, getNeighbors } from "@/lib/docs";
import { sectionOf } from "@/lib/nav";
import { Markdown } from "@/components/markdown";
import { Pager } from "@/components/pager";
import { Sidebar } from "@/components/docs-sidebar";
import { Toc } from "@/components/toc";
import { Badge } from "@/components/ui/badge";

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return {};
  return { title: doc.title, description: doc.description };
}

export default async function DocPage(props: PageProps<"/docs/[slug]">) {
  const { slug } = await props.params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  const { prev, next } = getNeighbors(slug);
  const section = sectionOf(slug);

  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-screen-2xl gap-2 px-4 sm:px-6 lg:px-8">
        <Sidebar />

        <main className="min-w-0 flex-1 py-8 lg:py-10">
          <div className="mx-auto max-w-3xl">
            {/* Breadcrumb */}
            <nav className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground">
                desktop
              </Link>
              <ChevronRight className="size-3.5" />
              <span>docs</span>
              {section ? (
                <>
                  <ChevronRight className="size-3.5" />
                  <span>{section.title}</span>
                </>
              ) : null}
            </nav>

            <Badge
              variant="outline"
              className="mb-3 rounded px-1.5 py-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              guide
            </Badge>
            <h1 className="text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
              {doc.title}
            </h1>
            {doc.description ? (
              <p className="mt-4 border-l-2 pl-4 text-lg leading-7 text-muted-foreground">
                {doc.description}
              </p>
            ) : null}

            <div className="mt-10">
              <Markdown content={doc.content} />
            </div>

            <Pager prev={prev} next={next} />
          </div>
        </main>

        <Toc items={doc.headings} />
      </div>
    </div>
  );
}
