// Re-checks every tracked company domain with the same two validation layers as "Add company".
// Usage: npx tsx scripts/check-domains.ts [--fix]
//   --fix: a domain that redirects to a company already tracked is removed as a duplicate; one that redirects to
//          the same brand elsewhere is moved there and refreshed; anything that fails validation is removed.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import { resolveCompanyDomain, validateDomainInput } from "../src/lib/domain";
import { logActivity } from "../src/lib/activity";
import { createRun, executeRun } from "../src/lib/pipeline";

async function main() {
  const fix = process.argv.includes("--fix");
  const db = getDb();
  const all = await db.select().from(schema.watchlist);
  const rows = all.filter((r) => r.active);
  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  const remove = async (r: (typeof rows)[number], why: string) => {
    await db.update(schema.watchlist).set({ active: false }).where(eq(schema.watchlist.id, r.id));
    await logActivity("company_removed", `Removed ${r.companyName} (${r.domain}): ${why}`, { actor: "system", companyId: r.id, detail: { domain: r.domain, reason: why } });
    console.log(`  removed #${r.id}`);
  };
  for (const r of rows) {
    const syntax = validateDomainInput(r.domain);
    const res = syntax.ok ? await resolveCompanyDomain(syntax.domain) : syntax;
    if (!res.ok) {
      console.log(`✗ ${r.domain}: [${res.code}] ${res.error}`);
      if (fix) await remove(r, res.error);
      continue;
    }
    const { domain, redirectedFrom } = "value" in res ? res.value : { domain: r.domain, redirectedFrom: null };
    if (!redirectedFrom) {
      console.log(`✓ ${r.domain}`);
      continue;
    }
    const twin = byDomain.get(domain);
    console.log(`→ ${r.domain} redirects to ${domain}${twin ? ` (already tracked as #${twin.id})` : ""}`);
    if (!fix) continue;
    if (twin) {
      await remove(r, `it redirects to ${domain}, already tracked as ${twin.companyName}`);
      continue;
    }
    if (all.some((x) => x.domain === domain)) {
      console.log(`  skipped: an inactive row already uses ${domain}`);
      continue;
    }
    await db.update(schema.watchlist).set({ domain }).where(eq(schema.watchlist.id, r.id));
    await logActivity("source_edited", `${r.companyName}: domain moved from ${r.domain} to ${domain} (the old domain redirects there)`, { actor: "system", companyId: r.id, detail: { from: r.domain, to: domain } });
    const runId = await createRun(r.id, "manual");
    await executeRun(runId);
    console.log(`  moved to ${domain} and refreshed (run ${runId})`);
  }
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
