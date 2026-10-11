import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { ActivityFeed, type FeedItem } from "@/components/activity-feed";
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
  const [rows, [lastCron], running] = await Promise.all([
    db.select().from(schema.activityLog).orderBy(desc(schema.activityLog.at)).limit(300),
    db.select().from(schema.activityLog).where(eq(schema.activityLog.type, "cron_run")).orderBy(desc(schema.activityLog.at)).limit(1),
    db.select({ n: schema.refreshRuns.id }).from(schema.refreshRuns).where(eq(schema.refreshRuns.status, "running")),
  ]);
  const items: FeedItem[] = rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    type: r.type,
    actor: r.actor,
    companyId: r.companyId,
    summary: r.summary,
    status: typeof r.detail?.status === "string" ? (r.detail.status as string) : undefined,
  }));
  const now = new Date();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Daily job" value="08:00 IST" hint="refreshes anything older than 7 days" />
        <Tile label="Last daily run" value={lastCron ? fmtDateTime(lastCron.at) : "Not yet"} hint={lastCron ? lastCron.summary.replace(/^Daily job: /, "") : "runs once a day on Vercel"} />
        <Tile label="Next daily run" value={fmtDateTime(nextCron(now))} hint={running.length ? `${running.length} refresh running now` : "Monday runs also send the digest"} />
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
