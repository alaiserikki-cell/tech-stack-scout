// Runs the database cleanup by hand (the same code the 2-monthly cron runs).
// Usage: npx tsx scripts/cleanup.ts          (delete)
//        npx tsx scripts/cleanup.ts --dry    (only count what would be deleted)
import "dotenv/config";
import { RETENTION, runCleanup } from "../src/lib/cleanup";
import { logActivity } from "../src/lib/activity";

async function main() {
  const dryRun = process.argv.includes("--dry");
  const daysArg = process.argv.find((a) => a.startsWith("--days=")); // testing only
  const r = await runCleanup({ dryRun, days: daysArg ? Number(daysArg.split("=")[1]) : undefined });
  console.log(`${dryRun ? "DRY RUN: would delete" : "Deleted"} (retention ${RETENTION.days} days, activity ${RETENTION.activityDays} days):`);
  console.table(r.deleted);
  console.log(`database size: ${r.sizeBefore}${dryRun ? "" : ` → ${r.sizeAfter}`}`);
  if (!dryRun) {
    const total = Object.values(r.deleted).reduce((a, n) => a + n, 0);
    await logActivity("cleanup_run", `Database cleanup (manual): removed ${total} old rows; size ${r.sizeBefore} → ${r.sizeAfter}`, { actor: "visitor", detail: r.deleted });
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
