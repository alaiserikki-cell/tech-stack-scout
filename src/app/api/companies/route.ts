import { after } from "next/server";
import { count, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { logActivity } from "@/lib/activity";
import { isAuthed, unauthorized } from "@/lib/auth";
import { LIMITS } from "@/lib/ratelimit";
import { createRun, executeRun } from "@/lib/pipeline";
import { brandOf, resolveCompanyDomain, validateDomainInput } from "@/lib/domain";

export const maxDuration = 300;

function nameFromDomain(d: string): string {
  const brand = brandOf(d); // tata.co.in -> Tata
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const check = validateDomainInput(String(body.domain ?? ""));
  if (!check.ok) return Response.json({ error: check.error, code: check.code }, { status: 400 });

  // apple.in redirects to apple.com: both are the same company, so it is stored (and scored) once, under apple.com.
  const resolved = await resolveCompanyDomain(check.domain);
  if (!resolved.ok) return Response.json({ error: resolved.error, code: resolved.code }, { status: 400 });
  const { domain, redirectedFrom } = resolved.value;
  const typedName = String(body.name ?? "").trim().slice(0, 80);
  const name = typedName || nameFromDomain(domain);
  const db = getDb();

  const rows = await db.select().from(schema.watchlist).where(inArray(schema.watchlist.domain, [domain, ...(redirectedFrom ? [redirectedFrom] : [])]));
  const existing = rows.find((r) => r.domain === domain);
  const note = redirectedFrom ? `${redirectedFrom} redirects to ${domain}, so it is tracked as ${domain}.` : undefined;
  if (existing?.active) return Response.json({ id: existing.id, existing: true, domain, redirectedFrom, note });

  // same name on another domain (amazon.in vs amazon.com) is usually the same company: ask before adding a second copy
  if (!existing && body.force !== true) {
    const active = await db.select({ id: schema.watchlist.id, name: schema.watchlist.companyName, domain: schema.watchlist.domain }).from(schema.watchlist).where(eq(schema.watchlist.active, true));
    const twin = active.find((c) => c.domain !== domain && brandOf(c.domain) === brandOf(domain));
    if (twin)
      return Response.json(
        {
          code: "same_brand",
          existingId: twin.id,
          existingName: twin.name,
          existingDomain: twin.domain,
          error: `${domain} looks like the same company as ${twin.name} (${twin.domain}), which is already on the dashboard.`,
        },
        { status: 409 },
      );
  }

  const [{ n }] = await db.select({ n: count() }).from(schema.watchlist).where(eq(schema.watchlist.active, true));
  if (n >= LIMITS.maxActiveCompanies) return Response.json({ error: `The dashboard is full (${LIMITS.maxActiveCompanies} active companies). Remove one first.` }, { status: 429 });

  let id: number;
  if (existing) {
    await db.update(schema.watchlist).set({ active: true }).where(eq(schema.watchlist.id, existing.id));
    id = existing.id;
  } else {
    // onConflictDoNothing: two people adding the same company at the same moment get one row, not an error
    const [row] = await db.insert(schema.watchlist).values({ companyName: name, domain, addedBy: "demo" }).onConflictDoNothing({ target: schema.watchlist.domain }).returning({ id: schema.watchlist.id });
    if (!row) {
      const [twin] = await db.select({ id: schema.watchlist.id }).from(schema.watchlist).where(eq(schema.watchlist.domain, domain));
      return Response.json({ id: twin.id, existing: true, domain, redirectedFrom, note });
    }
    id = row.id;
  }
  const label = existing?.companyName ?? name;
  await logActivity(existing ? "company_reactivated" : "company_added", `${existing ? "Re-added" : "Added"} ${label} (${domain})${redirectedFrom ? `, typed as ${redirectedFrom}` : ""}`, {
    companyId: id,
    detail: { domain, redirectedFrom },
  });
  const runId = await createRun(id, "on_add");
  after(() => executeRun(runId));
  return Response.json({ id, runId, domain, redirectedFrom, note });
}
