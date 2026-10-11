import { Suspense } from "react";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { latestSnapshotsByCompany, runningRuns } from "@/lib/queries";
import { isAuthed } from "@/lib/auth";
import { AddCompanyForm, PasscodeForm, WatchlistTable, type WatchRow } from "@/components/client";
import { Card, Empty, H2, PageTitle, SkeletonPage, ago, isStale } from "@/components/ui";

export default function Home() {
  return (
    <>
      <PageTitle title="Watchlist" sub="How each target company builds software, from public GitHub, job boards, blogs, Hacker News and DNS. Every company refreshes at least weekly." />
      <Suspense fallback={<SkeletonPage rows={8} />}>
        <Watchlist />
      </Suspense>
    </>
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <H2>Add a company</H2>
          <AddCompanyForm />
          <p className="mt-3 text-xs text-muted">The brief builds immediately (about a minute). Sources are discovered automatically and marked unverified until you confirm them.</p>
        </Card>
        <Card className="bg-accent-soft">
          <H2>Try it</H2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>{authed ? "Passcode accepted. Changes are unlocked." : "Enter the demo passcode from the README."}</li>
            <li>Open a company and press Refresh now to watch the steps.</li>
            <li>Add a company by its domain, e.g. a startup you know.</li>
            <li>Open Digests and email yourself this week&apos;s ranking.</li>
          </ol>
          {!authed && (
            <div className="mt-3">
              <PasscodeForm compact />
            </div>
          )}
        </Card>
      </div>
      {rows.length ? (
        <WatchlistTable rows={rows} />
      ) : (
        <Empty title="No companies on the watchlist yet.">Add one above, or insert a row into the watchlist table in the Neon console; the next daily run picks it up.</Empty>
      )}
      <p className="text-xs text-faint">
        Freshness turns red after 7 days. A dot in Changes means something changed in the last week. Fit score reasons appear on hover; open a company for the full brief.
      </p>
    </div>
  );
}
