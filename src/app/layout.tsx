import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter, Inter_Tight, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AddCompanyDialog } from "@/components/client";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FlakeGuard", template: "%s · FlakeGuard" },
  description: "Call-prep briefs on how target companies build software, from public signals.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1210" },
  ],
};

const NAV = [
  { href: "/", label: "Watchlist" },
  { href: "/digests", label: "Digests" },
  { href: "/activity", label: "Activity" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/settings", label: "Targeting" },
];

function LogoMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="24" height="24" rx="7" fill="var(--text)" />
      <path d="M8 16.5 11.5 9l3 5 1.8-2.6L18.5 16.5" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-1">
          Skip to content
        </a>
        <div className="bg-[#1f1f1f] px-4 py-1.5 text-center text-xs text-white/85 dark:bg-black">
          <span className="sm:hidden">Public signals in, sourced briefs out</span>
          <span className="hidden sm:inline">Signals collected from public GitHub, job boards, blogs, Hacker News and DNS · briefs written by Gemini Flash, checked in code</span>
        </div>
        <header className="sticky top-0 z-30 border-b border-line/70 bg-surface/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-ink no-underline">
              <LogoMark />
              <span className="font-display text-[15px] font-bold tracking-tight">FlakeGuard</span>
            </Link>
            <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-x-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-sm sm:order-none sm:w-auto sm:flex-1 sm:flex-wrap">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-lg px-2.5 py-1.5 text-muted no-underline transition-colors hover:bg-surface-2 hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
            <AddCompanyDialog />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:pt-10">
          {children}
        </main>
        <footer className="border-t border-line/70 py-6 text-center text-xs text-faint">
          FlakeGuard · facts in code, prose by Gemini Flash · <a href="https://github.com/alaiserikki-cell/tech-stack-scout">source on GitHub</a>
        </footer>
      </body>
    </html>
  );
}
