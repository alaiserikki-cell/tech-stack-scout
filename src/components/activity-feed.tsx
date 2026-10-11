"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface FeedItem {
  id: number;
  at: string; // ISO
  type: string;
  actor: string;
  companyId: number | null;
  summary: string;
  status?: string;
}

const GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "companies", label: "Added & removed", types: ["company_added", "company_reactivated", "company_removed"] },
  { key: "refresh", label: "Refreshes", types: ["refresh_requested", "refresh_finished", "cron_run"] },
  { key: "review", label: "Reviews", types: ["source_confirmed", "source_edited", "opener_feedback", "entry_verified", "profile_saved"] },
  { key: "digest", label: "Digests", types: ["digest_built", "digest_sent"] },
];

const META: Record<string, { icon: string; tone: string }> = {
  company_added: { icon: "+", tone: "bg-accent text-accent-fg" },
  company_reactivated: { icon: "+", tone: "bg-accent text-accent-fg" },
  company_removed: { icon: "−", tone: "bg-bad/15 text-bad" },
  refresh_requested: { icon: "↻", tone: "bg-surface-2 text-ink" },
  refresh_finished: { icon: "✓", tone: "bg-accent-soft text-accent-ink" },
  cron_run: { icon: "⏱", tone: "bg-surface-2 text-ink" },
  source_confirmed: { icon: "✓", tone: "bg-accent-soft text-accent-ink" },
  source_edited: { icon: "✎", tone: "bg-surface-2 text-ink" },
  opener_feedback: { icon: "★", tone: "bg-surface-2 text-ink" },
  entry_verified: { icon: "✓", tone: "bg-accent-soft text-accent-ink" },
  profile_saved: { icon: "✎", tone: "bg-surface-2 text-ink" },
  digest_built: { icon: "✉", tone: "bg-surface-2 text-ink" },
  digest_sent: { icon: "✉", tone: "bg-accent-soft text-accent-ink" },
};

const ACTOR: Record<string, string> = { visitor: "You", system: "System", cron: "Daily job" };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const ist = (x: Date) => new Date(x.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const today = ist(new Date());
  const yest = ist(new Date(Date.now() - 86_400_000));
  const k = ist(d);
  if (k === today) return "Today";
  if (k === yest) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export function ActivityFeed({ items }: { items: FeedItem[] }) {
  const [group, setGroup] = useState("all");
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.key, g.types.length ? items.filter((i) => g.types.includes(i.type)).length : items.length])), [items]);
  const shown = useMemo(() => {
    const g = GROUPS.find((x) => x.key === group)!;
    return g.types.length ? items.filter((i) => g.types.includes(i.type)) : items;
  }, [items, group]);
  const days = useMemo(() => {
    const m = new Map<string, FeedItem[]>();
    for (const i of shown) {
      const k = dayLabel(i.at);
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()];
  }, [shown]);

  return (
    <div>
      <div role="tablist" aria-label="Filter activity" className="mb-5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            role="tab"
            aria-selected={group === g.key}
            onClick={() => setGroup(g.key)}
            className={
              "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors " +
              (group === g.key ? "bg-btn text-btn-fg" : "border border-line bg-surface text-muted hover:text-ink")
            }
          >
            {g.label} <span className="ml-1 opacity-60">{counts[g.key]}</span>
          </button>
        ))}
      </div>
      {days.length === 0 && <p className="rounded-2xl border border-dashed border-line p-6 text-sm text-muted">Nothing here yet.</p>}
      <div className="space-y-6">
        {days.map(([day, list]) => (
          <section key={day}>
            <h2 className="mb-2 font-display text-sm font-semibold text-faint">{day}</h2>
            <ol className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {list.map((i) => {
                const m = META[i.type] ?? { icon: "•", tone: "bg-surface-2 text-ink" };
                const failed = i.status === "failed";
                return (
                  <li key={i.id} className="flex items-start gap-3 border-t border-line px-4 py-3 first:border-0">
                    <span aria-hidden className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${failed ? "bg-bad/15 text-bad" : m.tone}`}>
                      {failed ? "!" : m.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        {i.companyId ? (
                          <Link href={`/company/${i.companyId}`} className="text-ink no-underline hover:underline">
                            {i.summary}
                          </Link>
                        ) : (
                          i.summary
                        )}
                      </p>
                      <p className="text-xs text-faint">
                        {ACTOR[i.actor] ?? i.actor} · {new Date(i.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
