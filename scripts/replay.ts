// Replays recorded fixtures through the real collectors, computation and validators.
// No network, no database, no Gemini. Prints expected vs actual and exits non-zero on any failure.
// Usage: npx tsx scripts/replay.ts
import dictJson from "../data/tech-dictionary.json";
import profileJson from "../data/product-profile.json";
import type { BlogExtraction, CollectorContext, CompanyInput, DictEntry, KvCache, ProductProfile, Signal } from "../src/lib/types";
import { COLLECTORS, runCollector } from "../src/collectors";
import { computeFields } from "../src/lib/compute";
import { generateBrief, selectBriefSignals } from "../src/lib/brief";
import { GeminiQuotaError, type GeminiCall } from "../src/lib/gemini";
import { fakeFetch, github403Routes, noGithubRoutes, noJobsRoutes, richRoutes, sdkRoutes, type Route } from "../fixtures/http";

const dict = dictJson as DictEntry[];
const profile = profileJson as ProductProfile;
const NOW = new Date("2026-10-11T00:00:00Z");
let failures = 0;

function check(scenario: string, what: string, expected: unknown, actual: unknown) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${scenario}] ${what}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
}

const memCache = (): KvCache => {
  const m = new Map<string, { etag: string | null; body: unknown }>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, etag, body) => void m.set(k, { etag, body }) };
};

function company(over: Partial<CompanyInput>): CompanyInput {
  return { id: 1, companyName: "Acme", domain: "acme.dev", githubOrg: null, githubOrgVerified: false, atsProvider: null, atsSlug: null, atsVerified: false, blogFeedUrl: null, blogVerified: false, ...over };
}

async function collectAll(c: CompanyInput, routes: Route[], extractBlog?: CollectorContext["extractBlog"]) {
  const ctx: CollectorContext = { company: c, dict, profile, fetch: fakeFetch(routes), env: { GITHUB_TOKEN: "test" }, cache: memCache(), seenBlogUrls: new Set(), extractBlog, now: NOW };
  const signals: Signal[] = [];
  const errors: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  for (const col of COLLECTORS) {
    const out = await runCollector(col, ctx);
    if (out.error) errors[col.name] = out.error;
    checked[col.name] = out.checked;
    if (out.updates) Object.assign(ctx.company, out.updates);
    signals.push(...out.signals);
  }
  signals.forEach((s, i) => (s.id = i + 1));
  const computed = computeFields({ signals, dict, profile, techState: [], newTechs: new Set(), hasPreviousRun: false, checked, now: NOW });
  return { signals, errors, computed, company: ctx.company };
}

const goodExtraction = async (_t: string, text: string): Promise<BlogExtraction> => ({
  topic: "Moving the monorepo build to Bazel",
  tech_mentions: [
    { name: "Bazel", quote: "Last quarter we moved our monorepo build to Bazel." },
    { name: "Buildkite", quote: "Tests now run on Buildkite agents." },
  ].filter((m) => text.includes(m.quote)),
});

async function main() {
  // 1. rich company
  {
    const r = await collectAll(company({ githubOrg: "acme", githubOrgVerified: true, atsProvider: "greenhouse", atsSlug: "acme", atsVerified: true }), richRoutes, goodExtraction);
    const names = (cat: string) => r.computed.techs.filter((t) => t.category === cat).map((t) => t.name).sort();
    check("rich", "collector errors", {}, r.errors);
    check("rich", "top language", "Go", r.computed.languages[0]?.name);
    check("rich", "CI systems", ["Buildkite", "CircleCI", "GitHub Actions", "Jenkins"], names("ci"));
    check("rich", "infra includes Bazel, Docker, Helm, Nx, Terraform", true, ["Bazel", "Docker", "Helm", "Nx", "Terraform"].every((n) => names("infra").includes(n)));
    check("rich", "test frameworks", ["Jest", "Playwright", "testify"], names("test_framework"));
    check("rich", "competitor", ["Trunk Flaky Tests"], r.computed.competitors.map((c) => c.name));
    check("rich", "engineering jobs (sales role excluded)", 3, r.computed.activity.engineeringJobs);
    check("rich", "initiatives", ["Migration", "Test infrastructure"], r.computed.initiatives.map((i) => i.label).sort());
    check("rich", "Terraform tagged nice_to_have", "nice_to_have", r.signals.find((s) => s.source === "jobs" && s.name === "Terraform")?.requirementLevel);
    check("rich", "Bazel confidence high (GitHub + blog)", "high", r.computed.techs.find((t) => t.name === "Bazel")?.confidence);
    check("rich", "blog posts within 90 days", ["How we cut CI time in half with Bazel"], r.computed.blogPosts.map((b) => b.title));
    check("rich", "HN stories on own domain only", 1, r.computed.hnStories.length);
    check("rich", "hosting", ["Amazon CloudFront", "Vercel"], r.computed.hosting.map((h) => h.name).sort());
    check("rich", "coverage", "rich", r.computed.coverage);
    check("rich", "sdk_heavy", false, r.computed.sdkHeavy);
    check("rich", "fit score >= 70", true, r.computed.fit.score >= 70);
  }

  // 2. sdk heavy
  {
    const r = await collectAll(company({ companyName: "PayCorp", domain: "paycorp.com", githubOrg: "paycorp", githubOrgVerified: true, atsProvider: "none" }), sdkRoutes);
    check("sdk_heavy", "sdk_heavy flag", true, r.computed.sdkHeavy);
  }

  // 3. no GitHub
  {
    const r = await collectAll(company({ companyName: "Quiet Co", domain: "quiet.example" }), [...noGithubRoutes, ...noJobsRoutes]);
    check("no_github", "no github signals", 0, r.signals.filter((s) => s.source === "github").length);
    check("no_github", "github collector did not error", undefined, r.errors.github);
    check("no_github", "org left empty", null, r.company.githubOrg);
    check("no_github", "coverage none", "none", r.computed.coverage);
  }

  // 4. no job board
  {
    const r = await collectAll(company({ githubOrg: "acme", githubOrgVerified: true }), [...noJobsRoutes, ...richRoutes]);
    check("no_jobs", "no job signals", 0, r.signals.filter((s) => s.source === "jobs").length);
    check("no_jobs", "ats not set", null, r.company.atsProvider);
    check("no_jobs", "github still collected", "Go", r.computed.languages[0]?.name);
  }

  // 5. invented blog mention
  {
    const invented = async (): Promise<BlogExtraction> => ({
      topic: "CI",
      tech_mentions: [
        { name: "Bazel", quote: "Last quarter we moved our monorepo build to Bazel." },
        { name: "Rust", quote: "We rewrote the scheduler in Rust programming language." },
        { name: "Kubernetes", quote: "Tests now run on Buildkite agents." },
      ],
    });
    const r = await collectAll(company({ githubOrg: "acme", atsProvider: "none" }), richRoutes, invented);
    check("invented_blog", "only the verbatim Bazel mention survives", ["Bazel"], r.signals.filter((s) => s.source === "blog" && s.kind === "tech").map((s) => s.name));
  }

  // 6. GitHub 403
  {
    const r = await collectAll(company({ githubOrg: "acme", atsProvider: "greenhouse", atsSlug: "acme" }), [...github403Routes, ...richRoutes]);
    check("github_403", "github error captured", true, /403/.test(r.errors.github ?? ""));
    check("github_403", "jobs still collected", 3, r.computed.activity.engineeringJobs);
  }

  // Brief scenarios use the rich company's signals
  const rich = await collectAll(company({ githubOrg: "acme", githubOrgVerified: true, atsProvider: "greenhouse", atsSlug: "acme" }), richRoutes, goodExtraction);
  const sigs = selectBriefSignals(rich.signals, rich.computed);
  const blogSig = sigs.find((s) => s.kind === "blog_post")!.id;
  const goSig = sigs.find((s) => s.kind === "language" && s.name === "Go")!.id;
  const validBrief = JSON.stringify({
    paragraph_1: "Their public GitHub is mostly Go, with CI defined in GitHub Actions and CircleCI.",
    paragraph_2: "Their engineering blog describes moving the monorepo build to Bazel.",
    opener: "Your post on moving the monorepo build to Bazel caught my eye; did flaky tests show up once CI got faster?",
    opener_signal_ids: [blogSig],
    already_answered: [
      { question: "Main language?", answer: "Go", signal_ids: [goSig] },
      { question: "Build tool?", answer: "Bazel", signal_ids: [blogSig] },
      { question: "Blogging about CI?", answer: "Yes", signal_ids: [blogSig] },
    ],
    still_unknown: [
      { question: "Test count?", why_unknown: "Not public" },
      { question: "CI owner?", why_unknown: "Not public" },
    ],
    cited_signal_ids: [goSig, blogSig],
    caveats: [],
  });
  const fake = (responses: (string | Error)[]): GeminiCall => {
    let i = 0;
    return async () => {
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return { text: r, inputTokens: 1000, outputTokens: 200, model: "fake" };
    };
  };
  const brief = (g: GeminiCall) => generateBrief({ gemini: g, profile, dict, sigs, computed: rich.computed, events: [], unverified: [] });

  // 7. invalid Gemini JSON
  {
    const twice = await brief(fake(["{not json", "{still not json"]));
    check("gemini_invalid_json", "invalid twice -> status invalid after 2 attempts", ["invalid", 2], [twice.status, twice.attempts]);
    const recovers = await brief(fake(["{not json", validBrief]));
    check("gemini_invalid_json", "invalid then valid -> ok on retry", ["ok", 2], [recovers.status, recovers.attempts]);
    const fakeTech = await brief(fake([validBrief.replace("mostly Go", "mostly Go on Kubernetes and Azure")]));
    check("gemini_invalid_json", "unknown technology rejected", "invalid", fakeTech.status);
  }

  // 8. Gemini 429
  {
    const q = await brief(fake([new GeminiQuotaError("quota")]));
    check("gemini_429", "quota -> pending brief, no crash", "quota", q.status);
  }

  console.log(`\n${failures ? `FAILED: ${failures} check(s)` : "ALL REPLAY CHECKS PASSED"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("REPLAY CRASHED:", e);
  process.exit(1);
});
