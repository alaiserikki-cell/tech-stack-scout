import { runCleanup } from "@/lib/cleanup";
import { logActivity } from "@/lib/activity";

// Runs every 2 months (vercel.json: "30 3 1 */2 *"). Same CRON_SECRET convention as the daily job.
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const r = await runCleanup({ dryRun });
  const total = Object.values(r.deleted).reduce((a, n) => a + n, 0);
  const parts = Object.entries(r.deleted)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${t.replace("_", " ")}`)
    .join(", ");
  if (!dryRun)
    await logActivity("cleanup_run", `Database cleanup: removed ${total} old rows${parts ? ` (${parts})` : ""}; size ${r.sizeBefore} → ${r.sizeAfter}`, { actor: "cron", detail: r.deleted });
  return Response.json(r);
}
