// Pure navigation config — safe to import from client components.
// (Filesystem access lives in lib/docs.ts.)

export type NavItem = {
  title: string;
  slug: string;
  href: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const nav: NavSection[] = [
  {
    title: "Getting Started",
    items: [
      { title: "Introduction", slug: "introduction", href: "/docs/introduction" },
      { title: "Quickstart", slug: "quickstart", href: "/docs/quickstart" },
      { title: "Architecture", slug: "architecture", href: "/docs/architecture" },
    ],
  },
  {
    title: "Core Concepts",
    items: [
      { title: "The Computer Image", slug: "image", href: "/docs/image" },
      { title: "Daemon API", slug: "daemon", href: "/docs/daemon" },
      { title: "TypeScript SDK", slug: "sdk", href: "/docs/sdk" },
    ],
  },
  {
    title: "Guides",
    items: [
      { title: "Docker Setup", slug: "docker", href: "/docs/docker" },
      { title: "Automation Playbook", slug: "automation", href: "/docs/automation" },
      { title: "Troubleshooting", slug: "troubleshooting", href: "/docs/troubleshooting" },
    ],
  },
];

/** All nav items flattened in reading order — used for prev/next pagination. */
export function flatNav(): NavItem[] {
  return nav.flatMap((section) => section.items);
}

/** Which section a slug belongs to, e.g. for breadcrumbs. */
export function sectionOf(slug: string): NavSection | undefined {
  return nav.find((section) => section.items.some((item) => item.slug === slug));
}
