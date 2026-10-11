import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { logActivity } from "@/lib/activity";
import { isAuthed, unauthorized } from "@/lib/auth";
import { createRun, executeRun, recentRun } from "@/lib/pipeline";
import { LIMITS } from "@/lib/ratelimit";

export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/companies/[id]/refresh">) {
  if (!(await isAuthed())) return unauthorized();
  const id = Number((await ctx.params).id);
  const [c] = await getDb().select().from(schema.watchlist).where(eq(schema.watchlist.id, id));
  if (!c) return Response.json({ error: "Company not found" }, { status: 404 });
  const recent = await recentRun(id, LIMITS.refreshWindowMs);
  if (recent) return Response.json({ runId: recent.id, cached: true, message: "Refreshed less than 10 minutes ago; showing that run." });
  const runId = await createRun(id, "manual");
  await logActivity("refresh_requested", `Refresh requested for ${c.companyName}`, { companyId: id, detail: { runId } });
  after(() => executeRun(runId));
  return Response.json({ runId });
}
