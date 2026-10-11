import { after } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { isAuthed, unauthorized } from "@/lib/auth";
import { LIMITS, hit, dayMs } from "@/lib/ratelimit";
import { createRun, executeRun } from "@/lib/pipeline";
import { normalizeDomain } from "@/lib/domain";

export const maxDuration = 300;

function nameFromDomain(d: string): string {
  const stem = d.split(".")[0];
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const domain = normalizeDomain(String(body.domain ?? ""));
  if (!domain) return Response.json({ error: "Enter a company domain like example.com." }, { status: 400 });
  const name = String(body.name ?? "").trim().slice(0, 80) || nameFromDomain(domain);
  const db = getDb();

  const [existing] = await db.select().from(schema.watchlist).where(eq(schema.watchlist.domain, domain));
  if (existing?.active) return Response.json({ id: existing.id, existing: true });

  const [{ n }] = await db.select({ n: count() }).from(schema.watchlist).where(eq(schema.watchlist.active, true));
  if (n >= LIMITS.maxActiveCompanies) return Response.json({ error: `The watchlist is full (${LIMITS.maxActiveCompanies} active companies). Remove one first.` }, { status: 429 });
  if (!(await hit("demo_adds", dayMs, LIMITS.demoAddsPerDay))) return Response.json({ error: `Demo limit reached: ${LIMITS.demoAddsPerDay} new companies per day.` }, { status: 429 });

  let id: number;
  if (existing) {
    await db.update(schema.watchlist).set({ active: true }).where(and(eq(schema.watchlist.id, existing.id)));
    id = existing.id;
  } else {
    const [row] = await db.insert(schema.watchlist).values({ companyName: name, domain, addedBy: "demo" }).returning({ id: schema.watchlist.id });
    id = row.id;
  }
  const runId = await createRun(id, "on_add");
  after(() => executeRun(runId));
  return Response.json({ id, runId });
}
