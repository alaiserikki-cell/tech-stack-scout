// Dry-run the collectors for a domain without touching the database or Gemini.
// Usage: npx tsx scripts/probe.ts flipkart.com "Flipkart" [more domain name pairs...]
import "dotenv/config";
import { COLLECTORS, runCollector } from "../src/collectors";
import { loadDictionary, loadProfile } from "../src/lib/repo";
import type { CollectorContext, CompanyInput } from "../src/lib/types";

const memCache = { get: async () => null, set: async () => {} } as unknown as CollectorContext["cache"];

async function main() {
  const [dict, profile] = await Promise.all([loadDictionary(), loadProfile()]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const domain = args[i], name = args[i + 1] ?? domain.split(".")[0];
    const company = { id: 0, companyName: name, domain, githubOrg: null, githubOrgVerified: false, atsProvider: null, atsSlug: null, atsVerified: false, blogFeedUrl: null, blogVerified: false } as unknown as CompanyInput;
    const ctx: CollectorContext = { company, dict, profile, fetch, env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }, cache: memCache, seenBlogUrls: new Set(), extractBlog: undefined, now: new Date() };
    console.log(`\n=== ${name} (${domain})`);
    for (const c of COLLECTORS) {
      const out = await runCollector(c, ctx);
      if (out.updates) Object.assign(ctx.company, out.updates);
      if (process.env.ALL && c.name === "github") console.log("hints", ctx.hints);
      const kinds: Record<string, number> = {};
      for (const s of out.signals) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
      console.log(`${c.name.padEnd(8)} ${out.signals.length} signals ${JSON.stringify(kinds)}${out.error ? ` ERROR ${out.error}` : ""}`);
      for (const ch of out.checked.slice(0, process.env.ALL ? 99 : 6)) console.log(`         · ${ch}`);
    }
    console.log(`  → github ${ctx.company.githubOrg} verified=${ctx.company.githubOrgVerified} · ats ${ctx.company.atsProvider}/${ctx.company.atsSlug} verified=${ctx.company.atsVerified} · blog ${ctx.company.blogFeedUrl} verified=${ctx.company.blogVerified}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
