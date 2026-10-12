// Re-checks every active watchlist domain: does it still resolve, and does it redirect to another company's domain?
// Usage: npx tsx scripts/check-domains.ts [--fix]
//   --fix: duplicates that redirect to a tracked company are removed; other redirects are moved to the canonical
//          domain and refreshed; domains that don't exist or aren't companies (gmail.com) are removed.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import { isGenericDomain, resolveCompanyDomain } from "../src/lib/domain";
import { createRun, executeRun } from "../src/lib/pipeline";
import { logActivity } from "../src/lib/activity";

async function main() {
  const fix = process.argv.includes("--fix");
  const db = getDb();
  const rows = await db.select().from(schema.watchlist).where(eq(schema.watchlist.active, true));
  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  const all = await db.select().from(schema.watchlist);
  const remove = async (r: (typeof rows)[number], why: string) => {
    await db.update(schema.watchlist).set({ active: false }).where(eq(schema.watchlist.id, r.id));
    await logActivity("company_removed", `Removed ${r.companyName} (${r.domain}): ${why}`, { actor: "system", companyId: r.id, detail: { domain: r.domain, reason: why } });
    console.log(`  removed #${r.id}`);
  };
  for (const r of rows) {
    if (isGenericDomain(r.domain)) { console.log(`✗ ${r.domain}: shared email/hosting domain`); if (fix) await remove(r, "a shared email service, not a company"); continue; }
    const res = await resolveCompanyDomain(r.domain);
    if (!res.ok) { console.log(`✗ ${r.domain}: ${res.error}`); if (fix) await remove(r, "the domain has no website (no DNS records)"); continue; }
    const { domain, redirectedFrom } = res.value;
    if (redirectedFrom && isGenericDomain(domain)) { console.log(`✓ ${r.domain}`); continue; }
    if (!redirectedFrom) { console.log(`✓ ${r.domain}`); continue; }
    const twin = byDomain.get(domain);
    console.log(`→ ${r.domain} redirects to ${domain}${twin ? ` (already tracked as #${twin.id})` : ""}`);
    if (!fix) continue;
    if (twin) { await remove(r, `it redirects to ${domain}, already tracked as ${twin.companyName}`); continue; }
    if (all.some((x) => x.domain === domain)) { console.log(`  skipped: an inactive row already uses ${domain}`); continue; }
    await db.update(schema.watchlist).set({ domain }).where(eq(schema.watchlist.id, r.id));
    await logActivity("source_edited", `${r.companyName}: domain moved from ${r.domain} to ${domain} (the old domain redirects there)`, { actor: "system", companyId: r.id, detail: { from: r.domain, to: domain } });
    const runId = await createRun(r.id, "manual");
    await executeRun(runId);
    console.log(`  moved to ${domain} and refreshed (run ${runId})`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
