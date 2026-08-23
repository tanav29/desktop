import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";

import { CodeBlock } from "@/components/code-block";

function Anchor({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
  const external = href?.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      {...props}
      className="font-medium underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
    >
      {children}
    </a>
  );
}

/**
 * Renders one of the .md files from content/docs with shadcn-flavored,
 * strictly monochrome styling.
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug, [rehypeHighlight, { ignoreMissing: true }]]}
        components={{
          h2: ({ children, ...props }) => (
            <h2
              {...props}
              className="mt-12 scroll-mt-24 border-b pb-2 text-xl font-semibold tracking-tight first:mt-0"
            >
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3
              {...props}
              className="mt-8 scroll-mt-24 text-base font-semibold tracking-tight"
            >
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4
              {...props}
              className="mt-6 scroll-mt-24 text-sm font-semibold tracking-tight"
            >
              {children}
            </h4>
          ),
          p: ({ children, ...props }) => (
            <p {...props} className="my-4 leading-7 text-foreground/90">
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul
              {...props}
              className="my-4 ml-6 list-disc space-y-2 leading-7 marker:text-muted-foreground"
            >
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol
              {...props}
              className="my-4 ml-6 list-decimal space-y-2 leading-7 marker:text-muted-foreground"
            >
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li {...props} className="pl-1 text-foreground/90">
              {children}
            </li>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote
              {...props}
              className="my-6 border-l-2 border-foreground/30 pl-4 italic text-muted-foreground [&>p]:my-2"
            >
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-10 border-border" />,
          a: Anchor,
          strong: ({ children, ...props }) => (
            <strong {...props} className="font-semibold text-foreground">
              {children}
            </strong>
          ),
          img: ({ alt, src }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === "string" ? src : ""}
              alt={alt ?? ""}
              className="my-6 rounded-lg border"
            />
          ),
          table: ({ children, ...props }) => (
            <div className="my-6 overflow-x-auto rounded-lg border">
              <table
                {...props}
                className="w-full border-collapse text-sm [&_td]:border-b [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_th]:border-b [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-medium [&_tbody_tr:last-child_td]:border-b-0"
              >
                {children}
              </table>
            </div>
          ),
          pre: CodeBlock,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
