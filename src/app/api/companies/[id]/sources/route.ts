import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Confirm or edit an auto-discovered source (GitHub org, job board, blog feed). */
export async function POST(req: Request, ctx: RouteContext<"/api/companies/[id]/sources">) {
  if (!(await isAuthed())) return unauthorized();
  const id = Number((await ctx.params).id);
  const b = await req.json().catch(() => ({}));
  const field = String(b.field);
  const action = String(b.action);
  const value = typeof b.value === "string" ? b.value.trim().slice(0, 300) : "";
  const db = getDb();
  let set: Partial<typeof schema.watchlist.$inferInsert> = {};
  if (field === "github") {
    set = action === "confirm" ? { githubOrgVerified: true } : { githubOrg: value.replace(/^https?:\/\/github\.com\//, "").split("/")[0] || null, githubOrgVerified: Boolean(value) };
  } else if (field === "ats") {
    if (action === "confirm") set = { atsVerified: true };
    else if (value === "none") set = { atsProvider: "none", atsSlug: null, atsVerified: true };
    else {
      const [provider, slug] = value.split("/");
      if (!["greenhouse", "lever", "ashby"].includes(provider) || !slug) return Response.json({ error: "Use provider/slug, e.g. greenhouse/acme, or none." }, { status: 400 });
      set = { atsProvider: provider, atsSlug: slug, atsVerified: true };
    }
  } else if (field === "blog") {
    if (action === "confirm") set = { blogVerified: true };
    else if (value === "none") set = { blogFeedUrl: "none", blogVerified: true };
    else if (/^https?:\/\//.test(value)) set = { blogFeedUrl: value, blogVerified: true };
    else return Response.json({ error: "Enter a full feed URL or none." }, { status: 400 });
  } else return Response.json({ error: "Unknown field" }, { status: 400 });
  await db.update(schema.watchlist).set(set).where(eq(schema.watchlist.id, id));
  return Response.json({ ok: true });
}
