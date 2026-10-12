import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { logActivity } from "@/lib/activity";
import { isAuthed, unauthorized } from "@/lib/auth";
import { createRun, executeRun } from "@/lib/pipeline";

export const maxDuration = 300;

/** Confirm or edit an auto-discovered source (GitHub org, job board, blog feed). */
export async function POST(req: Request, ctx: RouteContext<"/api/companies/[id]/sources">) {
  if (!(await isAuthed())) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown company." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const field = String(b.field);
  const action = String(b.action);
  const value = typeof b.value === "string" ? b.value.trim().slice(0, 300) : "";
  const db = getDb();
  let set: Partial<typeof schema.watchlist.$inferInsert> = {};
  if (!["confirm", "edit"].includes(action)) return Response.json({ error: "Unknown action" }, { status: 400 });
  if (action === "edit" && !value) return Response.json({ error: "Enter a value, or none." }, { status: 400 });
  if (field === "github") {
    set = action === "confirm" ? { githubOrgVerified: true } : { githubOrg: value.replace(/^https?:\/\/github\.com\//, "").split("/")[0] || null, githubOrgVerified: Boolean(value) };
  } else if (field === "ats") {
    if (action === "confirm") set = { atsVerified: true };
    else if (value === "none") set = { atsProvider: "none", atsSlug: null, atsVerified: true };
    else {
      const i = value.indexOf("/");
      const provider = value.slice(0, i);
      const slug = value.slice(i + 1);
      if (i < 1 || !["greenhouse", "lever", "ashby", "workday", "smartrecruiters"].includes(provider) || !slug) return Response.json({ error: "Use provider/slug, e.g. greenhouse/acme or workday/acme/wd1/AcmeCareers, or none." }, { status: 400 });
      set = { atsProvider: provider, atsSlug: slug, atsVerified: true };
    }
  } else if (field === "blog") {
    if (action === "confirm") set = { blogVerified: true };
    else if (value === "none") set = { blogFeedUrl: "none", blogVerified: true };
    else if (/^https?:\/\//.test(value)) set = { blogFeedUrl: value, blogVerified: true };
    else return Response.json({ error: "Enter a full feed URL or none." }, { status: 400 });
  } else return Response.json({ error: "Unknown field" }, { status: 400 });
  const [c] = await db.update(schema.watchlist).set(set).where(eq(schema.watchlist.id, id)).returning();
  const label = field === "github" ? "GitHub org" : field === "ats" ? "job board" : "blog feed";
  if (!c) return Response.json({ error: "Unknown company." }, { status: 404 });
  await logActivity(action === "confirm" ? "source_confirmed" : "source_edited", `${action === "confirm" ? "Confirmed" : "Changed"} ${c.companyName}'s ${label}${action === "confirm" ? "" : ` to ${value}`}`, { companyId: id });
  // only verified sources are used, so the brief and scores must be rebuilt now that this source's status changed
  const runId = await createRun(id, "manual");
  after(() => executeRun(runId));
  return Response.json({ ok: true, runId });
}
