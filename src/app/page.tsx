import { Suspense } from "react";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { latestSnapshotsByCompany, runningRuns } from "@/lib/queries";
import { isAuthed } from "@/lib/auth";
import { AddCompanyForm, PasscodeForm, WatchlistTable, type WatchRow } from "@/components/client";
import { Card, Empty, Eyebrow, Skeleton, SkeletonPage, ago, isStale } from "@/components/ui";

export default function Home() {
  return (
    <>
      <section className="mx-auto mb-10 max-w-3xl text-center">
        <Eyebrow>Account intelligence</Eyebrow>
        <h1 className="mt-5 font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[52px]">
          Know how every account builds,
          <br />
          <span className="text-accent-ink">before the first call.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted sm:text-[17px]">
          Languages, CI, infrastructure and hiring signals from public GitHub, job boards, blogs, Hacker News and DNS, turned into a sourced brief. Every account refreshes at least weekly.
        </p>
        <div id="add" className="mx-auto mt-7 max-w-xl scroll-mt-28 text-left">
          <AddCompanyForm hero />
          <p className="mt-2 text-center text-xs text-faint">Type a domain. The brief builds in about a minute; sources are matched automatically.</p>
        </div>
      </section>
      <Suspense fallback={<WatchlistSkeleton />}>
        <Watchlist />
      </Suspense>
    </>
  );
}

function WatchlistSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading watchlist">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <SkeletonPage rows={6} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="text-xs font-medium text-faint">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tracking-tight text-ink tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

async function Watchlist() {
  await connection();
  const db = getDb();
  const [companies, snaps, running, authed] = await Promise.all([
    db.select().from(schema.watchlist).where(eq(schema.watchlist.active, true)),
    latestSnapshotsByCompany(),
    runningRuns(),
    isAuthed(),
  ]);
  const now = new Date();
  const runningSet = new Set(running.filter((r) => now.getTime() - r.startedAt.getTime() < 10 * 60_000).map((r) => r.companyId));
  const rows: WatchRow[] = companies.map((c) => {
    const s = snaps.get(c.id);
    const comp = s?.computed;
    const recentChanges = (s?.changeEvents ?? []).filter((e) => now.getTime() - (s?.generatedAt.getTime() ?? 0) <= 7 * 86_400_000 && e);
    return {
      id: c.id,
      name: c.companyName,
      domain: c.domain,
      fit: s ? s.fitScore : null,
      fitReasons: comp?.fit.reasons ?? [],
      activity: comp?.activity.label ?? "unknown",
      languages: (comp?.languages ?? []).slice(0, 3).map((l) => l.name),
      competitor: comp?.competitors[0]?.name ?? null,
      lastRefreshed: c.lastRefreshedAt?.toISOString() ?? null,
      lastRefreshedLabel: ago(c.lastRefreshedAt, now),
      stale: isStale(c.lastRefreshedAt, now),
      coverage: s?.coverage ?? "pending",
      changes: recentChanges.length,
      briefStatus: s?.briefStatus ?? null,
      running: runningSet.has(c.id),
    };
  });
  const scored = rows.filter((r) => r.fit != null);
  const avgFit = scored.length ? Math.round(scored.reduce((a, r) => a + (r.fit ?? 0), 0) / scored.length) : 0;
  const changed = rows.filter((r) => r.changes > 0).length;
  const stale = rows.filter((r) => r.stale).length;

  return (
    <div className="space-y-5">
      {!authed && (
        <Card>
          <p className="mb-2 text-sm text-muted">Enter the demo passcode to make changes.</p>
          <PasscodeForm compact />
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Accounts tracked" value={rows.length} hint="max 40 active" />
        <Stat label="Average fit" value={avgFit} hint="out of 100" />
        <Stat label="Changed this week" value={changed} hint="new tech, posts, hiring" />
        <Stat label="Stale (> 7 days)" value={stale} hint="refreshed by the daily job" />
      </div>
      {rows.length ? (
        <WatchlistTable rows={rows} />
      ) : (
        <Empty title="No companies on the watchlist yet.">Add one above, or insert a row into the watchlist table in the Neon console; the next daily run picks it up.</Empty>
      )}
      <p className="text-xs text-faint">Freshness turns red after 7 days. A mint dot means something changed in the last week. Tap a fit score for its reasons; open a company for the full brief.</p>
    </div>
  );
}
