import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/**
 * Database cleanup, run every 2 months (Vercel cron) or by hand (`npm run cleanup [-- --dry]`).
 * Retention rules: delete only what nothing on the site uses any more.
 *
 *   signals ........ facts from runs older than 60 days, except the run behind each company's
 *                    current brief (its citations and Sources list need them)
 *   snapshots ...... older than 60 days, but always keep each company's latest 6 ("What changed"
 *                    history) and any snapshot with opener feedback
 *   refresh_runs ... older than 60 days and no longer referenced by a kept snapshot
 *   http_cache ..... GitHub ETag cache entries not refreshed in 60 days (they are simply refetched)
 *   llm_calls ...... Gemini usage rows older than 60 days
 *   rate_limits .... counter windows older than 2 days
 *   activity_log ... older than 180 days (the audit trail keeps 6 months)
 * Never deleted: companies, digests and their sends, opener feedback, tech_state, dictionary, profile.
 */
export const RETENTION = { days: 60, keepSnapshotsPerCompany: 6, activityDays: 180, rateLimitDays: 2 } as const;

export interface CleanupResult {
  dryRun: boolean;
  deleted: Record<string, number>;
  sizeBefore: string;
  sizeAfter: string;
}

function steps(days: number): { table: string; where: string }[] {
  return [
  {
    table: "signals",
    where: `run_id in (select id from refresh_runs where started_at < now() - interval '${days} days')
            and run_id not in (select distinct on (company_id) run_id from snapshots where run_id is not null order by company_id, generated_at desc)`,
  },
  {
    table: "snapshots",
    where: `generated_at < now() - interval '${days} days'
            and id not in (select id from (select id, row_number() over (partition by company_id order by generated_at desc) rn from snapshots) r where rn <= ${RETENTION.keepSnapshotsPerCompany})
            and id not in (select snapshot_id from opener_feedback)`,
  },
  {
    table: "refresh_runs",
    where: `started_at < now() - interval '${days} days'
            and status not in ('queued', 'running')
            and id not in (select run_id from snapshots where run_id is not null)`,
  },
  { table: "http_cache", where: `updated_at < now() - interval '${days} days'` },
  { table: "llm_calls", where: `created_at < now() - interval '${days} days'` },
  { table: "rate_limits", where: `window_start < now() - interval '${RETENTION.rateLimitDays} days'` },
  { table: "activity_log", where: `at < now() - interval '${RETENTION.activityDays} days'` },
  ];
}

async function dbSize(): Promise<string> {
  const r = await getDb().execute(sql`select pg_size_pretty(pg_database_size(current_database())) as size`);
  return String((r.rows[0] as { size: string }).size);
}

export async function runCleanup(opts: { dryRun?: boolean; days?: number } = {}): Promise<CleanupResult> {
  const db = getDb();
  const dryRun = Boolean(opts.dryRun);
  const sizeBefore = await dbSize();
  const deleted: Record<string, number> = {};
  for (const s of steps(opts.days ?? RETENTION.days)) {
    const q = dryRun ? `select count(*)::int as n from ${s.table} where ${s.where}` : `with d as (delete from ${s.table} where ${s.where} returning 1) select count(*)::int as n from d`;
    const r = await db.execute(sql.raw(q));
    deleted[s.table] = Number((r.rows[0] as { n: number }).n);
  }
  return { dryRun, deleted, sizeBefore, sizeAfter: dryRun ? sizeBefore : await dbSize() };
}

/** Next run of the "30 3 1 *\/2 *" schedule (03:30 UTC = 09:00 IST on the 1st of Jan, Mar, May, Jul, Sep, Nov). */
export function nextCleanup(now = new Date()): Date {
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1, 3, 30));
    if (d.getUTCMonth() % 2 === 0 && d > now) return d;
  }
  return now;
}
