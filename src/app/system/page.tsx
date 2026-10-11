import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { count, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { Card, H2, PageTitle, SkeletonPage, fmtDateTime } from "@/components/ui";
import { geminiConfigured } from "@/lib/gemini";
import { emailConfigured } from "@/lib/email";

export const metadata: Metadata = { title: "System" };

const CRON_UTC = { h: 2, m: 30 }; // vercel.json: "30 2 * * *" = 08:00 IST

function nextCron(now: Date): Date {
  const n = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_UTC.h, CRON_UTC.m));
  if (n <= now) n.setUTCDate(n.getUTCDate() + 1);
  return n;
}

export default function SystemPage() {
  return (
    <>
      <PageTitle title="System" sub="Schedule, run history and collector errors." />
      <Suspense fallback={<SkeletonPage rows={8} />}>
        <SystemData />
      </Suspense>
    </>
  );
}

async function SystemData() {
  await connection();
  const db = getDb();
  const now = new Date();
  const [runs, [lastCron], counts, statusCounts] = await Promise.all([
    db
      .select({ r: schema.refreshRuns, name: schema.watchlist.companyName })
      .from(schema.refreshRuns)
      .innerJoin(schema.watchlist, eq(schema.watchlist.id, schema.refreshRuns.companyId))
      .orderBy(desc(schema.refreshRuns.startedAt))
      .limit(50),
    db.select().from(schema.refreshRuns).where(eq(schema.refreshRuns.trigger, "cron")).orderBy(desc(schema.refreshRuns.startedAt)).limit(1),
    db.execute(sql`select
        (select count(*) from watchlist where active) as active,
        (select count(*) from watchlist) as companies,
        (select count(*) from signals) as signals,
        (select count(*) from snapshots) as snapshots,
        (select count(*) from refresh_runs) as runs,
        (select count(*) from digests) as digests,
        (select count(*) from llm_calls where status <> 'skipped_unchanged') as llm_calls`),
    db.select({ status: schema.refreshRuns.status, n: count() }).from(schema.refreshRuns).groupBy(schema.refreshRuns.status),
  ]);
  const c = (counts.rows?.[0] ?? {}) as Record<string, string>;
  const stat = (k: string, v: string | number | undefined) => (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs text-faint">{k}</p>
      <p className="font-mono text-xl tabular-nums">{v ?? 0}</p>
    </div>
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <H2>Schedule</H2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Daily cron</dt>
              <dd className="text-right font-mono text-xs">30 2 * * * (08:00 IST, ±59 min on Hobby)</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Last cron run</dt>
              <dd>{lastCron ? fmtDateTime(lastCron.startedAt) : "not yet"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Next cron run</dt>
              <dd>{fmtDateTime(nextCron(now))}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Refresh policy</dt>
              <dd className="text-right">Active companies older than 7 days, oldest first; stops starting work at 210 s of 300 s</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Digest</dt>
              <dd>Mondays (Asia/Kolkata), once per week</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Gemini</dt>
              <dd>{geminiConfigured() ? "configured" : "not configured"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Email</dt>
              <dd>{emailConfigured() ? "configured" : "not configured"}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <H2>Counts</H2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stat("Active companies", c.active)}
            {stat("Signals", c.signals)}
            {stat("Snapshots", c.snapshots)}
            {stat("Runs", c.runs)}
            {stat("Digests", c.digests)}
            {stat("Gemini calls", c.llm_calls)}
          </div>
          <p className="mt-3 text-xs text-muted">Runs by status: {statusCounts.map((s) => `${s.status.replace("_", " ")} ${s.n}`).join(" · ") || "none"}</p>
        </Card>
      </div>

      <Card>
        <H2>Run history (latest 50)</H2>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-medium">Started</th>
                <th scope="col" className="py-2 pr-3 font-medium">Company</th>
                <th scope="col" className="py-2 pr-3 font-medium">Trigger</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2 font-medium">Collector errors</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(({ r, name }) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted">{fmtDateTime(r.startedAt)}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/company/${r.companyId}`}>{name}</Link>
                  </td>
                  <td className="py-2 pr-3 text-muted">{r.trigger.replace("_", " ")}</td>
                  <td className={`py-2 pr-3 ${r.status === "failed" ? "text-bad" : r.status === "partial" ? "text-warn" : ""}`}>
                    {r.status.replace("_", " ")}
                    {["queued", "running"].includes(r.status) && r.step ? <span className="block text-xs text-faint">{r.step}</span> : null}
                  </td>
                  <td className="py-2 text-xs text-muted">
                    {Object.entries(r.collectorErrors ?? {}).map(([k, v]) => (
                      <p key={k}>
                        <span className="font-medium">{k}</span>: {v}
                      </p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!runs.length && <p className="text-sm text-muted">No runs yet.</p>}
      </Card>
    </div>
  );
}
