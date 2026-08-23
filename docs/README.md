# desktop — docs

Documentation site for [desktop](https://github.com/tanav29/desktop): the
computer image, the daemon API, the TypeScript SDK, and setup guides.

Built with Next.js (App Router) + Tailwind + shadcn/ui, in strict black &
white. Run with [bun](https://bun.sh).

## Run it

```bash
bun install
bun run dev        # http://localhost:3000
```

Production:

```bash
bun run build
bun run start
```

## How it works

- **Content is plain Markdown.** Every docs page lives in
  [`content/docs/*.md`](content/docs) with a tiny frontmatter block:

  ```md
  ---
  title: The page title
  description: One-line summary shown under the title.
  ---
  ```

  The filename becomes the URL: `content/docs/sdk.md` → `/docs/sdk`.
  GFM (tables, task lists), syntax-highlighted fenced code blocks, and
  `#anchor` headings all work.

- **Navigation is one config.** The sidebar, breadcrumbs, and prev/next pager
  are driven by [`lib/nav.ts`](lib/nav.ts). Add a page: drop the `.md` file in
  `content/docs/` and add an entry to `nav`.

- **Rendering.** [`app/docs/[slug]/page.tsx`](app/docs/[slug]/page.tsx) reads
  the file with `gray-matter`, extracts the h2/h3 outline for the "On this
  page" rail, and renders the body with `react-markdown` +
  `remark-gfm` + `rehype-slug` + `rehype-highlight` (grayscale theme defined
  in `app/globals.css`). All routes are statically prerendered at build time.

## Layout

```
app/
├── page.tsx              # landing page
├── docs/
│   ├── layout.tsx        # site header for all docs pages
│   ├── page.tsx          # /docs → redirect to introduction
│   └── [slug]/page.tsx   # renders a markdown file
components/               # markdown renderer, sidebar, TOC, code blocks…
lib/
├── nav.ts                # sidebar config (pure data)
└── docs.ts               # fs + frontmatter + heading outline helpers
content/docs/*.md         # the actual documentation
```
