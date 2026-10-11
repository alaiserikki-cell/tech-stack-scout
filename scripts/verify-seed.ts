// Checks seed candidates against live public sources (GitHub org, job board, blog feed) and
// writes the passing set to data/seed-companies.json.
// Usage: npx tsx scripts/verify-seed.ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fetchJson } from "../src/lib/http";
import { discoverFeed, parseFeed } from "../src/collectors/blog";
import { slugCandidates } from "../src/collectors/jobs";
import { fetchText } from "../src/lib/http";
import type { CollectorContext } from "../src/lib/types";

interface Candidate {
  name: string;
  domain: string;
  github?: string | null; // null = expected to have no public GitHub
  ats?: [string, string];
  feed?: string;
  india?: boolean;
  thin?: boolean;
}

const CANDIDATES: Candidate[] = [
  { name: "Spotify", domain: "spotify.com", github: "spotify", ats: ["lever", "spotify"], feed: "https://engineering.atspotify.com/feed/" },
  { name: "Ramp", domain: "ramp.com", github: "ramp", ats: ["ashby", "ramp"], feed: "https://engineering.ramp.com/rss.xml" },
  { name: "Vercel", domain: "vercel.com", github: "vercel", ats: ["greenhouse", "vercel"], feed: "https://vercel.com/atom" },
  { name: "Stripe", domain: "stripe.com", github: "stripe", ats: ["greenhouse", "stripe"], feed: "https://stripe.com/blog/feed.rss" },
  { name: "Notion", domain: "notion.so", github: "makenotion", ats: ["ashby", "notion"] },
  { name: "Linear", domain: "linear.app", github: "linear", ats: ["ashby", "linear"], feed: "https://linear.app/rss/blog.xml" },
  { name: "GitLab", domain: "gitlab.com", github: "gitlabhq", ats: ["greenhouse", "gitlab"], feed: "https://about.gitlab.com/atom.xml" },
  { name: "Razorpay", domain: "razorpay.com", github: "razorpay", india: true, feed: "https://engineering.razorpay.com/feed" },
  { name: "PhonePe", domain: "phonepe.com", github: "PhonePe", ats: ["greenhouse", "phonepe"], india: true },
  { name: "Postman", domain: "postman.com", github: "postmanlabs", ats: ["greenhouse", "postman"], india: true, feed: "https://blog.postman.com/feed/" },
  { name: "BrowserStack", domain: "browserstack.com", github: "browserstack", india: true },
  { name: "Hasura", domain: "hasura.io", github: "hasura", india: true, feed: "https://hasura.io/blog/rss.xml" },
  { name: "Zerodha", domain: "zerodha.com", github: "zerodha", india: true, feed: "https://zerodha.tech/index.xml" },
  { name: "Groww", domain: "groww.in", github: "Groww", india: true },
  { name: "Meesho", domain: "meesho.com", github: "Meesho", ats: ["lever", "meesho"], india: true },
  { name: "Allbirds", domain: "allbirds.com", github: null, thin: true },
  { name: "Sweetgreen", domain: "sweetgreen.com", github: "sweetgreen" },
  { name: "Rothy's", domain: "rothys.com", github: null, thin: true },
  { name: "Glossier", domain: "glossier.com", github: null, thin: true },
];

const ctxFor = (c: Candidate): CollectorContext =>
  ({
    company: { id: 0, companyName: c.name, domain: c.domain, githubOrg: null, githubOrgVerified: false, atsProvider: null, atsSlug: null, atsVerified: false, blogFeedUrl: null, blogVerified: false },
    fetch,
  }) as unknown as CollectorContext;

const ghHeaders: Record<string, string> = { accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) ghHeaders.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function boardJobs(p: string, slug: string): Promise<number | null> {
  const url =
    p === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
      : p === "lever"
        ? `https://api.lever.co/v0/postings/${slug}?mode=json`
        : `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  const { status, data } = await fetchJson<any>(url, { timeoutMs: 20000, retries: 1 }).catch(() => ({ status: 0, data: null }));
  if (status !== 200 || !data) return null;
  return Array.isArray(data) ? data.length : (data.jobs?.length ?? null);
}

async function main() {
  const results: Record<string, unknown>[] = [];
  for (const c of CANDIDATES) {
    // GitHub
    let github: string | null = null;
    let repos = 0;
    // thin candidates: confirm no org exists under the domain stem either
    const probe = c.github ?? (c.thin ? c.domain.split(".")[0] : null);
    if (probe) {
      const { data } = await fetchJson<{ login: string; public_repos: number }>(`https://api.github.com/orgs/${probe}`, { headers: ghHeaders }).catch(() => ({ data: null }));
      if (data && data.public_repos > 0) {
        github = data.login;
        repos = data.public_repos;
      }
    }
    // job board
    let ats: [string, string] | null = null;
    let jobs: number | null = null;
    const tries: [string, string][] = c.ats ? [c.ats] : [];
    for (const s of slugCandidates(c.name, c.domain)) for (const p of ["greenhouse", "lever", "ashby"]) tries.push([p, s]);
    for (const [p, s] of tries) {
      const n = await boardJobs(p, s);
      if (n != null) {
        ats = [p, s];
        jobs = n;
        break;
      }
    }
    // blog feed
    let feed: string | null = null;
    let posts = 0;
    const feedCandidates = c.feed ? [c.feed] : [];
    const discovered = await discoverFeed(ctxFor(c), []).catch(() => null);
    if (discovered) feedCandidates.push(discovered);
    for (const f of feedCandidates) {
      const r = await fetchText(f, { timeoutMs: 15000, retries: 1 }).catch(() => null);
      const items = r?.text ? parseFeed(r.text) : [];
      if (items.length) {
        feed = f;
        posts = items.length;
        break;
      }
    }
    const pass = c.thin ? !github && (jobs != null || feed != null) : Boolean(github) && (jobs != null || feed != null);
    const row = { name: c.name, domain: c.domain, india: Boolean(c.india), thin: Boolean(c.thin), github, repos, ats: ats?.join("/") ?? null, jobs, feed, posts, pass };
    results.push(row);
    console.log(`${pass ? "PASS" : "FAIL"}  ${c.name.padEnd(13)} github=${github ?? "-"}(${repos})  jobs=${ats?.join("/") ?? "-"}(${jobs ?? "-"})  feed=${feed ? "yes" : "-"}(${posts})${c.india ? "  [India]" : ""}${c.thin ? "  [thin]" : ""}`);
  }

  // choose 10: >=2 Indian, exactly 1 thin, rest strongest
  const passing = results.filter((r) => r.pass) as any[];
  const india = passing.filter((r) => r.india).sort((a, b) => Number(b.jobs != null) - Number(a.jobs != null)).slice(0, 3);
  const thin = passing.filter((r) => r.thin).slice(0, 1);
  const others = passing.filter((r) => !r.india && !r.thin);
  const chosen = [...india, ...thin, ...others].slice(0, 10);
  if (india.length < 2) console.error("WARNING: fewer than 2 Indian companies passed");
  if (!thin.length) console.error("WARNING: no thin (no-GitHub) company passed");
  writeFileSync(
    "data/seed-companies.json",
    JSON.stringify(
      chosen.map((r) => ({
        company_name: r.name,
        domain: r.domain,
        github_org: r.github,
        ats_provider: r.ats ? r.ats.split("/")[0] : null,
        ats_slug: r.ats ? r.ats.split("/")[1] : null,
        blog_feed_url: r.feed,
      })),
      null,
      2,
    ) + "\n",
  );
  console.log(`\nWrote ${chosen.length} companies to data/seed-companies.json: ${chosen.map((r) => r.name).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
