import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const id = Number((await ctx.params).id);
  const [r] = await getDb().select().from(schema.refreshRuns).where(eq(schema.refreshRuns.id, id));
  if (!r) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json(
    { id: r.id, companyId: r.companyId, status: r.status, step: r.step, trigger: r.trigger, errors: r.collectorErrors, startedAt: r.startedAt, finishedAt: r.finishedAt },
    { headers: { "cache-control": "no-store" } },
  );
}
