import { isParkingDomain } from "./domain";

/**
 * Activity display: companies that only existed because a domain failed validation (before the current checks
 * caught it) are hidden from the normal feed, and one example per rejection reason is shown in plain words
 * under "Edge cases handled". Display only: nothing is deleted from the database.
 */
export interface EdgeInput {
  companyId: number;
  domain: string;
  active: boolean;
  removedAt: Date | null;
  removalSummaries: string[]; // company_removed entries written by the system
  addedSummary: string | null; // e.g. "Added Gen (gen.xyz), typed as com.com"
}

export interface EdgeExample {
  code: string;
  companyId: number;
  at: Date;
  text: string;
}

const RULES: { code: string; re: RegExp; text: (domain: string, m: RegExpMatchArray) => string }[] = [
  { code: "no_dns", re: /no DNS records/i, text: (d) => `${d} rejected: the domain does not exist (no DNS records)` },
  { code: "no_website", re: /no website responds/i, text: (d) => `${d} rejected: the domain exists but no website responds there` },
  { code: "shared_email", re: /shared email service/i, text: (d) => `${d} rejected: a shared email service, not a company` },
  { code: "redirect", re: /redirects to ([\w.-]+), already tracked/i, text: (d, m) => `${d} merged: redirects to ${m[1]}, already tracked` },
  { code: "same_company", re: /same company as (.+?\(([\w.-]+)\)), already tracked/i, text: (d, m) => `${d} merged: same company as ${m[1]}, already tracked` },
];

export function classifyEdgeCases(companies: EdgeInput[]): { hidden: Set<number>; examples: EdgeExample[] } {
  const hidden = new Set<number>();
  const found: EdgeExample[] = [];
  for (const c of companies) {
    if (c.active) continue;
    let hit: EdgeExample | null = null;
    if (isParkingDomain(c.domain)) {
      const typed = c.addedSummary?.match(/typed as ([\w.-]+)/i)?.[1];
      hit = { code: "registrar", companyId: c.companyId, at: c.removedAt ?? new Date(0), text: `${typed ?? c.domain} rejected: it redirects to ${c.domain}, a domain registrar, not a company` };
    } else {
      for (const s of c.removalSummaries) {
        const rule = RULES.find((r) => r.re.test(s));
        if (rule) {
          hit = { code: rule.code, companyId: c.companyId, at: c.removedAt ?? new Date(0), text: rule.text(c.domain, s.match(rule.re)!) };
          break;
        }
      }
    }
    if (hit) {
      hidden.add(c.companyId);
      found.push(hit);
    }
  }
  // one example per reason: the earliest
  const examples = new Map<string, EdgeExample>();
  for (const e of found.sort((a, b) => a.at.getTime() - b.at.getTime())) if (!examples.has(e.code)) examples.set(e.code, e);
  return { hidden, examples: [...examples.values()] };
}
