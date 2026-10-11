import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { logActivity } from "@/lib/activity";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Remove from the watchlist (soft: active=false keeps history). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/companies/[id]">) {
  if (!(await isAuthed())) return unauthorized();
  const id = Number((await ctx.params).id);
  const [c] = await getDb().update(schema.watchlist).set({ active: false }).where(eq(schema.watchlist.id, id)).returning();
  if (c) await logActivity("company_removed", `Removed ${c.companyName} (${c.domain}) from the watchlist`, { companyId: id });
  return Response.json({ ok: true });
}
