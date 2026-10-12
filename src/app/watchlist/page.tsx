import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { latestSnapshotsByCompany, runningRuns } from "@/lib/queries";
import { isAuthed } from "@/lib/auth";
import { loadProfile } from "@/lib/repo";
import { liveScores } from "@/lib/scores";
import { AddCompanyForm, PasscodeForm, WatchlistTable, type WatchRow } from "@/components/client";
import { Card, Empty, Skeleton, SkeletonPage, ago, isStale } from "@/components/ui";

export const metadata: Metadata = { title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold tracking-[-0.025em] text-ink sm:text-[40px]">
            Your accounts, <span className="text-accent-ink">ranked by fit.</span>
          </h1>
          <p className="mt-2 text-sm text-muted">Open a company for its call-prep brief. Every account refreshes at least weekly.</p>
        </div>
        <div id="add" className="w-full max-w-md scroll-mt-28">
          <AddCompanyForm hero />
          <p className="mt-1.5 text-xs text-faint">Type a domain and press Build brief. Remove a company from its row below.</p>
        </div>
      </div>
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
  const [companies, snaps, running, authed, profile] = await Promise.all([
    db.select().from(schema.watchlist).where(eq(schema.watchlist.active, true)),
    latestSnapshotsByCompany(),
    runningRuns(),
    isAuthed(),
    loadProfile(),
  ]);
  const now = new Date();
  const runningSet = new Set(running.filter((r) => now.getTime() - r.startedAt.getTime() < 10 * 60_000).map((r) => r.companyId));
  const rows: WatchRow[] = companies.map((c) => {
    const s = snaps.get(c.id);
    const comp = s?.computed;
    const recentChanges = (s?.changeEvents ?? []).filter((e) => now.getTime() - (s?.generatedAt.getTime() ?? 0) <= 7 * 86_400_000 && e);
    const live = comp ? liveScores(comp, profile, c, now) : null;
    return {
      id: c.id,
      name: c.companyName,
      domain: c.domain,
      fit: live ? live.fit.score : null,
      fitReasons: live?.fit.reasons ?? [],
      evidence: live ? live.evidence.score : null,
      evidenceLabel: live?.evidence.label ?? null,
      techs: (comp?.techs ?? []).map((t) => t.name),
      activity: comp?.activity.label ?? "unknown",
      languages: (comp?.languages?.length ? comp.languages.map((l) => l.name) : (comp?.jobLanguages ?? []).map((l) => l.name)).slice(0, 3),
      languagesFrom: comp?.languages?.length ? "code" : comp?.jobLanguages?.length ? "jobs" : null,
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
        <Stat label="Average fit" value={avgFit} hint="for what you sell" />
        <Stat label="Changed this week" value={changed} hint="new tech, posts, hiring" />
        <Stat label="Strong evidence" value={rows.filter((r) => r.evidenceLabel === "strong").length} hint={`${stale} stale (> 7 days)`} />
      </div>
      {rows.length ? (
        <WatchlistTable rows={rows} />
      ) : (
        <Empty title="No companies on the watchlist yet.">Add one above, or insert a row into the watchlist table in the Neon console; the next daily run picks it up.</Empty>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4 text-sm shadow-card">
          <p className="font-display font-semibold text-ink">Fit score: is this a good account for you?</p>
          <p className="mt-1 text-muted">Matches each company against what you sell and who you target. <a href="/settings">Change your targeting</a> and every score updates instantly.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 text-sm shadow-card">
          <p className="font-display font-semibold text-ink">Evidence score: how sure are we?</p>
          <p className="mt-1 text-muted">How much of the stack comes from verified sources, confirmed twice, recently. <a href="/#scores">How both scores work</a></p>
        </div>
      </div>
    </div>
  );
}
