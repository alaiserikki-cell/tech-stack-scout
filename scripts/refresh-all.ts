// Runs the full refresh pipeline for every active company (or the ids given), sequentially,
// against the database in DATABASE_URL. Same code path as the cron job.
// Usage: npx tsx scripts/refresh-all.ts [companyId ...]
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import { createRun, executeRun } from "../src/lib/pipeline";

async function main() {
  const db = getDb();
  const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
  const companies = (await db.select().from(schema.watchlist).where(eq(schema.watchlist.active, true))).filter((c) => !ids.length || ids.includes(c.id));
  for (const c of companies) {
    const t0 = Date.now();
    const runId = await createRun(c.id, "manual");
    await executeRun(runId);
    const [r] = await db.select().from(schema.refreshRuns).where(eq(schema.refreshRuns.id, runId));
    const [s] = await db.select({ fit: schema.snapshots.fitScore, coverage: schema.snapshots.coverage, brief: schema.snapshots.briefStatus }).from(schema.snapshots).where(eq(schema.snapshots.runId, runId));
    console.log(
      `${c.companyName.padEnd(12)} run ${runId} ${r.status.padEnd(17)} ${((Date.now() - t0) / 1000).toFixed(0)}s  fit=${s?.fit ?? "-"} coverage=${s?.coverage ?? "-"} brief=${s?.brief ?? "-"}  ${Object.entries(r.collectorErrors ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ")}`,
    );
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
