import { SiteHeader } from "@/components/site-header";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
