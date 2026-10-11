import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Tech Stack Scout", template: "%s · Tech Stack Scout" },
  description: "Call-prep briefs on how target companies build software, from public signals.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0e" },
  ],
};

const NAV = [
  { href: "/", label: "Watchlist" },
  { href: "/digests", label: "Digests" },
  { href: "/system", label: "System" },
  { href: "/costs", label: "Costs" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-1">
          Skip to content
        </a>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight text-ink no-underline">
              Tech Stack Scout
            </Link>
            <nav aria-label="Main" className="-mx-1 flex flex-wrap gap-x-1 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded px-2 py-1 text-muted no-underline hover:bg-surface-2 hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:pt-8">
          {children}
        </main>
      </body>
    </html>
  );
}
