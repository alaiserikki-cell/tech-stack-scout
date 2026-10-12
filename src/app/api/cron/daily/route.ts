import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { createRun, executeRun, sweepStuckRuns } from "@/lib/pipeline";
import { buildDigest, isMondayIST, weekOfIST } from "@/lib/digest";
import { logActivity } from "@/lib/activity";
import { latestSnapshotsByCompany } from "@/lib/queries";

// Vercel Hobby: functions run up to 300s; cron jobs run at most once per day (hour-level precision).
export const maxDuration = 300;
const BUDGET_MS = maxDuration * 1000 * 0.7; // stop starting new work at ~70% of maxDuration
const REFRESH_AFTER_DAYS = 3; // short enough that job-post links in briefs stay live, long enough to fit the budget
const PARALLEL = 3; // refreshes at a time (GitHub, Gemini and job boards all tolerate this)

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const t0 = Date.now();
  const db = getDb();
  await sweepStuckRuns();
  const stale = await db
    .select({ id: schema.watchlist.id })
    .from(schema.watchlist)
    .where(and(eq(schema.watchlist.active, true), or(isNull(schema.watchlist.lastRefreshedAt), lt(schema.watchlist.lastRefreshedAt, new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000)))))
    .orderBy(asc(schema.watchlist.lastRefreshedAt));
  // companies whose latest brief is still pending (e.g. Gemini quota was out) go first
  const latest = await latestSnapshotsByCompany();
  const active = await db.select({ id: schema.watchlist.id }).from(schema.watchlist).where(eq(schema.watchlist.active, true));
  const pending = active.filter((c) => ["pending", "failed"].includes(latest.get(c.id)?.briefStatus ?? "")).map((c) => c.id);
  const due = [...new Set([...pending, ...stale.map((c) => c.id)])];
  const running = await db.select({ companyId: schema.refreshRuns.companyId }).from(schema.refreshRuns).where(inArray(schema.refreshRuns.status, ["queued", "running"]));
  const busy = new Set(running.map((r) => r.companyId));
  const queue = due.filter((id) => !busy.has(id));
  const refreshed: number[] = [];
  const worker = async () => {
    for (let id = queue.shift(); id != null; id = queue.shift()) {
      if (Date.now() - t0 > BUDGET_MS) return;
      const runId = await createRun(id, "cron");
      await executeRun(runId);
      refreshed.push(id);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  let digest: string = "not Monday";
  if (isMondayIST()) {
    const weekOf = weekOfIST();
    const [existing] = await db.select().from(schema.digests).where(eq(schema.digests.weekOf, weekOf));
    if (existing) digest = "already built this week";
    else if (Date.now() - t0 > BUDGET_MS + 30_000) digest = "deferred (time budget)";
    else {
      // the digest is built for the site (and downloadable as an email draft); the job never sends email
      const d = await buildDigest(weekOf);
      await logActivity("digest_built", `Built the digest for the week of ${weekOf}`, { actor: "cron", detail: { digestId: d.id } });
      digest = "built";
    }
  }
  await logActivity("cron_run", `Daily job: ${refreshed.length} of ${due.length} due companies refreshed; digest ${digest}`, { actor: "cron" });
  return Response.json({ due: due.length, refreshed: refreshed.length, remaining: due.length - refreshed.length, digest, ms: Date.now() - t0 });
}
