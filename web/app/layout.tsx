import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "eve — desktop operator",
  description: "An eve agent that drives a Dockerized Linux desktop, live.",
};

export const viewport: Viewport = { themeColor: "#09090b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}