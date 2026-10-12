import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { ActivityFeed, type FeedItem } from "@/components/activity-feed";
import { RETENTION, nextCleanup } from "@/lib/cleanup";
import { classifyEdgeCases } from "@/lib/edge-cases";
import { Mint, PageTitle, SkeletonPage, fmtDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Activity" };

const CRON_UTC = { h: 2, m: 30 }; // vercel.json "30 2 * * *" = 08:00 IST

function nextCron(now: Date): Date {
  const n = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_UTC.h, CRON_UTC.m));
  if (n <= now) n.setUTCDate(n.getUTCDate() + 1);
  return n;
}

export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle eyebrow="Activity" title={<>Everything that happened, <Mint>in one place.</Mint></>} sub="Every company added or removed, every refresh, review and digest, newest first." />
      <Suspense fallback={<SkeletonPage rows={8} />}>
        <ActivityData />
      </Suspense>
    </div>
  );
}

async function ActivityData() {
  await connection();
  const db = getDb();
  const [rows, [lastCron], running, inactive, lifecycle] = await Promise.all([
    db.select().from(schema.activityLog).orderBy(desc(schema.activityLog.at)).limit(300),
    db.select().from(schema.activityLog).where(eq(schema.activityLog.type, "cron_run")).orderBy(desc(schema.activityLog.at)).limit(1),
    db.select({ n: schema.refreshRuns.id }).from(schema.refreshRuns).where(eq(schema.refreshRuns.status, "running")),
    db.select({ id: schema.watchlist.id, domain: schema.watchlist.domain }).from(schema.watchlist).where(eq(schema.watchlist.active, false)),
    db
      .select({ companyId: schema.activityLog.companyId, type: schema.activityLog.type, actor: schema.activityLog.actor, summary: schema.activityLog.summary, at: schema.activityLog.at })
      .from(schema.activityLog)
      .where(and(inArray(schema.activityLog.type, ["company_added", "company_removed"]))),
  ]);
  // companies that only existed because a domain failed validation: one plain-words example per reason (display only)
  const edge = classifyEdgeCases(
    inactive.map((c) => {
      const mine = lifecycle.filter((l) => l.companyId === c.id);
      const removals = mine.filter((l) => l.type === "company_removed");
      return {
        companyId: c.id,
        domain: c.domain,
        active: false,
        removedAt: removals.length ? removals.map((r) => r.at).sort((a, b) => b.getTime() - a.getTime())[0] : null,
        removalSummaries: removals.filter((r) => r.actor === "system").map((r) => r.summary),
        addedSummary: mine.find((l) => l.type === "company_added")?.summary ?? null,
      };
    }),
  );
  // past "email not delivered" entries are no longer relevant (the app no longer sends email); hidden, not deleted
  const shown = rows.filter((r) => !(r.type === "digest_sent" && /not delivered/i.test(r.summary)) && !(r.companyId != null && edge.hidden.has(r.companyId)));
  const items: FeedItem[] = shown.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    type: r.type,
    actor: r.actor,
    companyId: r.companyId,
    summary: r.summary,
    status: typeof r.detail?.status === "string" ? (r.detail.status as string) : undefined,
  }));
  items.push(...edge.examples.map((e, i) => ({ id: -(i + 1), at: e.at.toISOString(), type: "edge_case", actor: "system", companyId: null, summary: e.text })));
  items.sort((a, b) => b.at.localeCompare(a.at));
  const now = new Date();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Daily job" value="08:00 IST" hint="refreshes anything older than 7 days" />
        <Tile label="Last daily run" value={lastCron ? fmtDateTime(lastCron.at) : "Not yet"} hint={lastCron ? lastCron.summary.replace(/^Daily job: /, "") : "runs once a day on Vercel"} />
        <Tile label="Next daily run" value={fmtDateTime(nextCron(now))} hint={running.length ? `${running.length} refresh running now` : "Monday runs also send the digest"} />
        <Tile label="Next database cleanup" value={fmtDateTime(nextCleanup(now))} hint={`every 2 months; keeps ${RETENTION.days} days of history`} />
      </div>
      <ActivityFeed items={items} />
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="text-xs font-medium text-faint">{label}</p>
      <p className="mt-1 font-display text-lg font-bold tracking-tight text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-faint">{hint}</p>
    </div>
  );
}
