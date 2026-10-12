"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** other paths that belong to this section (a company page is reached from the dashboard) */
  also?: string[];
}

const BASE = "rounded-lg px-2.5 py-1.5 no-underline transition-colors";
const IDLE = "text-muted hover:bg-surface-2 hover:text-ink";
const ACTIVE = "bg-accent-soft font-semibold text-accent-ink";

function isActive(path: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some((p) => path === p || path.startsWith(`${p}/`));
}

/** Main navigation with the current section highlighted. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname() ?? "/";
  return items.map((n) => {
    const on = isActive(path, n);
    return (
      <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`${BASE} ${on ? ACTIVE : IDLE}`}>
        {n.label}
      </Link>
    );
  });
}

/** Same links without a highlight: shown for the instant before the current path is known. */
export function NavLinksStatic({ items }: { items: NavItem[] }) {
  return items.map((n) => (
    <Link key={n.href} href={n.href} className={`${BASE} ${IDLE}`}>
      {n.label}
    </Link>
  ));
}
