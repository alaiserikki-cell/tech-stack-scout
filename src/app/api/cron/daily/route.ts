import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { createRun, executeRun } from "@/lib/pipeline";
import { buildDigest, isMondayIST, sendDigest, weekOfIST } from "@/lib/digest";
import { emailConfigured } from "@/lib/email";

// Vercel Hobby: functions run up to 300s; cron jobs run at most once per day (hour-level precision).
export const maxDuration = 300;
const BUDGET_MS = maxDuration * 1000 * 0.7; // stop starting new work at ~70% of maxDuration

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const t0 = Date.now();
  const db = getDb();
  const due = await db
    .select({ id: schema.watchlist.id })
    .from(schema.watchlist)
    .where(and(eq(schema.watchlist.active, true), or(isNull(schema.watchlist.lastRefreshedAt), lt(schema.watchlist.lastRefreshedAt, new Date(Date.now() - 7 * 86_400_000)))))
    .orderBy(asc(schema.watchlist.lastRefreshedAt));
  const refreshed: number[] = [];
  for (const c of due) {
    if (Date.now() - t0 > BUDGET_MS) break;
    const runId = await createRun(c.id, "cron");
    await executeRun(runId);
    refreshed.push(c.id);
  }

  let digest: string = "not Monday";
  if (isMondayIST()) {
    const weekOf = weekOfIST();
    const [existing] = await db.select().from(schema.digests).where(eq(schema.digests.weekOf, weekOf));
    if (existing && existing.emailStatus === "sent") digest = "already sent this week";
    else if (Date.now() - t0 > BUDGET_MS + 30_000) digest = "deferred (time budget)";
    else {
      const d = existing ?? (await buildDigest(weekOf));
      const to = process.env.DIGEST_TO;
      if (to && emailConfigured()) {
        const status = await sendDigest(d.id, to);
        await db.update(schema.digests).set({ emailStatus: status }).where(eq(schema.digests.id, d.id));
        digest = `built and ${status}`;
      } else {
        await db.update(schema.digests).set({ emailStatus: "not_configured" }).where(eq(schema.digests.id, d.id));
        digest = "built; email not configured";
      }
    }
  }
  return Response.json({ due: due.length, refreshed: refreshed.length, remaining: due.length - refreshed.length, digest, ms: Date.now() - t0 });
}
