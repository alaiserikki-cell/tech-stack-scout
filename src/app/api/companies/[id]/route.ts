import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Remove from the watchlist (soft: active=false keeps history). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/companies/[id]">) {
  if (!(await isAuthed())) return unauthorized();
  const id = Number((await ctx.params).id);
  await getDb().update(schema.watchlist).set({ active: false }).where(eq(schema.watchlist.id, id));
  return Response.json({ ok: true });
}
