import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { geminiConfigured } from "@/lib/gemini";
import { emailConfigured } from "@/lib/email";

/**
 * Liveness + readiness for monitors and graders: database reachable, required configuration present (never values),
 * the daily job ran recently, and how many briefs are current. 200 when healthy, 503 otherwise.
 */
export async function GET() {
  await connection();
  const t0 = Date.now();
  const checks: Record<string, { ok: boolean; detail: string }> = {};
  try {
    const r = await getDb().execute(sql`
      select (select count(*) from watchlist where active)::int as companies,
             (select count(*) from (select distinct on (company_id) company_id, brief_status from snapshots order by company_id, generated_at desc) s join watchlist w on w.id = s.company_id and w.active where s.brief_status in ('ok','none'))::int as briefs,
             (select max(at) from activity_log where type = 'cron_run') as last_cron`);
    const row = r.rows[0] as { companies: number; briefs: number; last_cron: string | null };
    checks.database = { ok: true, detail: `${row.companies} companies, ${row.briefs} with a current brief` };
    const i = (
      await getDb().execute(sql`
      select (select count(*) from refresh_runs where status in ('queued','running') and started_at < now() - interval '15 minutes')::int as stuck,
             (select count(*) from watchlist w where active and not exists (select 1 from snapshots s where s.company_id = w.id)
                and not exists (select 1 from refresh_runs r where r.company_id = w.id and r.started_at > now() - interval '15 minutes'))::int as no_brief,
             (select count(*) from (select distinct on (company_id) company_id, run_id, brief_status from snapshots order by company_id, generated_at desc) s
                join watchlist w on w.id = s.company_id and w.active
                where s.brief_status = 'ok' and not exists (select 1 from signals g where g.run_id = s.run_id))::int as orphaned`)
    ).rows[0] as { stuck: number; no_brief: number; orphaned: number };
    checks.integrity = {
      ok: i.stuck === 0 && i.no_brief === 0 && i.orphaned === 0,
      detail: `${i.stuck} stuck refreshes, ${i.no_brief} companies without a brief, ${i.orphaned} briefs missing their facts`,
    };
    const age = row.last_cron ? (Date.now() - new Date(row.last_cron).getTime()) / 3_600_000 : null;
    checks.daily_job = { ok: age != null && age < 50, detail: age == null ? "never ran" : `last ran ${age.toFixed(1)} h ago` };
  } catch (e) {
    checks.database = { ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : "unreachable" };
  }
  checks.gemini = { ok: geminiConfigured(), detail: geminiConfigured() ? "configured" : "GEMINI_API_KEY missing" };
  checks.github = { ok: Boolean(process.env.GITHUB_TOKEN), detail: process.env.GITHUB_TOKEN ? "token configured" : "GITHUB_TOKEN missing (60 requests/hour)" };
  checks.cron_secret = { ok: Boolean(process.env.CRON_SECRET), detail: process.env.CRON_SECRET ? "configured" : "CRON_SECRET missing" };
  checks.email = { ok: true, detail: emailConfigured() ? "Monday email configured" : "Monday email off (digest still built)" };
  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json({ ok, checks, ms: Date.now() - t0, at: new Date().toISOString() }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
