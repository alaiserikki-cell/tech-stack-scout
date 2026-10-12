import { describe, expect, it } from "vitest";
import dictJson from "../data/tech-dictionary.json";
import profileJson from "../data/product-profile.json";
import type { DictEntry, ProductProfile, Signal } from "../src/lib/types";
import { aggregateLanguages, isSdkHeavy, orgWebsiteMatches, parseManifest } from "../src/collectors/github";
import { matchFiles, matchDependencies, pathMatches, matchText } from "../src/lib/dictionary";
import { atsFromHtml, detectInitiatives, isEngineeringRole, matchJobTech, workdayPostedDate } from "../src/collectors/jobs";
import { htmlToLines } from "../src/lib/text";
import { verifyMentions, parseFeed } from "../src/collectors/blog";
import { changeEvents, computeFields, confidenceFor, infoScore, fitScore, signalHash, updateTechState, type Computed } from "../src/lib/compute";
import { stripInlineIds, validateBrief, type BriefSignal } from "../src/lib/brief";
import { rankAccounts } from "../src/lib/digest";
import { ProfileZ } from "../src/lib/profile-schema";
import { nextCleanup } from "../src/lib/cleanup";
import { isTalkUrl, selectTalks, talkTechMatches } from "../src/collectors/talks";

const dict = dictJson as DictEntry[];
const profile = profileJson as ProductProfile;
const NOW = new Date("2026-10-11T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const sig = (p: Partial<Signal> & Pick<Signal, "source" | "kind" | "name">): Signal => ({ detail: {}, evidenceUrl: "https://x.test/" + p.name, observedAt: NOW.toISOString(), ...p });

describe("language aggregation", () => {
  it("sums bytes across repos and computes percentages", () => {
    const r = aggregateLanguages([{ Go: 600, Shell: 100 }, { Go: 200, TypeScript: 100 }]);
    expect(r.map((x) => x.name)).toEqual(["Go", "Shell", "TypeScript"]);
    expect(r[0]).toMatchObject({ bytes: 800, pct: 80 });
    expect(r[1].pct).toBe(10);
  });
  it("returns nothing for empty input", () => expect(aggregateLanguages([])).toEqual([]));
});

describe("CI / infra detection", () => {
  const paths = [".github/workflows/ci.yml", "infra/main.tf", "deploy/charts/api/Chart.yaml", "services/api/Dockerfile", "nx.json", "docs/.github/workflows/x.yml", "README.md"];
  const names = matchFiles(paths, dict).map((m) => m.entry.canonical_name);
  it("detects root-anchored CI and basename-anywhere infra files", () => {
    expect(names).toEqual(expect.arrayContaining(["GitHub Actions", "Terraform", "Helm", "Docker", "Nx"]));
  });
  it("does not detect CircleCI or Jenkins when absent", () => {
    expect(names).not.toContain("CircleCI");
    expect(names).not.toContain("Jenkins");
  });
  it("anchors patterns with a slash at the root", () => {
    expect(pathMatches("docs/.github/workflows/x.yml", ".github/workflows/*.yml")).toBe(false);
    expect(pathMatches(".circleci/config.yml", ".circleci/config.yml")).toBe(true);
  });
  it("matches dependency names incl. scopes, go modules and maven groups", () => {
    const deps = ["@aws-sdk/client-s3", "github.com/stretchr/testify", "org.junit.jupiter:junit-jupiter", "@playwright/test", "pytest"];
    const m = matchDependencies(deps, dict).map((x) => x.entry.canonical_name);
    expect(m).toEqual(expect.arrayContaining(["AWS", "testify", "JUnit", "Playwright", "pytest"]));
  });
  it("parses manifests", () => {
    expect(parseManifest("package.json", JSON.stringify({ devDependencies: { jest: "1", cypress: "2" } }))).toEqual(["jest", "cypress"]);
    expect(parseManifest("requirements.txt", "boto3==1.0\n# c\npytest>=7\n")).toEqual(["boto3", "pytest"]);
    expect(parseManifest("go.mod", "module x\nrequire (\n\tgithub.com/stretchr/testify v1.9.0\n)\n")).toContain("github.com/stretchr/testify");
    expect(parseManifest("settings.gradle.kts", 'plugins { id("com.gradle.develocity") version("4.5.0") }')).toContain("com.gradle.develocity");
  });
  it("excludes verify:true dictionary entries from matching", () => {
    expect(matchFiles(["Procfile"], dict).map((m) => m.entry.canonical_name)).not.toContain("Heroku");
  });
});

describe("sdk_heavy", () => {
  it("is true when more than half the top repos look like client libraries", () => {
    expect(isSdkHeavy(["stripe-python", "stripe-node", "stripe-go", "stripe-java", "docs", "cli"])).toBe(true);
  });
  it("is false at exactly half or below", () => {
    expect(isSdkHeavy(["api-gateway-x", "core", "web", "sdk-js"])).toBe(false);
    expect(isSdkHeavy(["monorepo", "infra", "web"])).toBe(false);
  });
});

describe("job matching", () => {
  const html = `<p>We are migrating from Jenkins to GitHub Actions to reduce build times.</p>
    <h3>Requirements</h3><ul><li>5+ years with Golang or Python</li><li>Experience with Kubernetes</li></ul>
    <h3>Nice to have</h3><ul><li>Terraform</li><li>Kafka</li></ul>
    <p><strong>You have:</strong></p><ul><li>Experience with Kafka streams</li></ul>`;
  const res = matchJobTech(htmlToLines(html), dict);
  const level = (n: string) => res.find((r) => r.entry.canonical_name === n)?.level;
  it("tags requirement vs nice_to_have from section headings", () => {
    expect(level("Go")).toBe("requirement");
    expect(level("Python")).toBe("requirement");
    expect(level("Kubernetes")).toBe("requirement");
    expect(level("Terraform")).toBe("nice_to_have");
  });
  it("upgrades to requirement when also listed as required", () => expect(level("Apache Kafka")).toBe("requirement"));
  it("defaults to requirement with no heading", () => expect(level("Jenkins")).toBe("requirement"));
  it("uses word boundaries and avoids ambiguous words", () => {
    const t = matchText("Let's go! We trust our process and express interest in rust-colored paint.", dict).map((m) => m.entry.canonical_name);
    expect(t).not.toContain("Go");
    expect(t).not.toContain("Rust");
    expect(t).not.toContain("Express");
  });
  it("filters engineering roles", () => {
    expect(isEngineeringRole("Senior Software Engineer, Platform")).toBe(true);
    expect(isEngineeringRole("Account Executive")).toBe(false);
    expect(isEngineeringRole("Solutions Engineer")).toBe(false);
  });
});

describe("initiatives", () => {
  it("detects migration, monolith, platform team, CI reliability, build times, test infra, dev productivity", () => {
    const text = [
      "We are migrating from Jenkins to GitHub Actions this year.",
      "You will help break up the monolith into services.",
      "We are building a platform team from scratch.",
      "Improve CI reliability across 200 services.",
      "Reduce build times for every engineer.",
      "Own our test infrastructure.",
      "Champion developer productivity.",
    ].join(" ");
    const labels = detectInitiatives(text).map((i) => i.label);
    expect(labels).toEqual(["Migration", "Monolith breakup", "Platform team", "CI reliability", "Build times", "Test infrastructure", "Developer productivity"]);
  });
  it("stores the full sentence as evidence", () => {
    expect(detectInitiatives("Intro. We are migrating from MySQL to Postgres. End.")[0].sentence).toBe("We are migrating from MySQL to Postgres.");
  });
});

describe("confidence", () => {
  it("high with 2+ sources", () => expect(confidenceFor([sig({ source: "github", kind: "tech", name: "x" }), sig({ source: "jobs", kind: "tech", name: "x" })], NOW)).toBe("high"));
  it("high with 3+ recent job posts", () =>
    expect(confidenceFor([1, 2, 3].map((i) => sig({ source: "jobs", kind: "tech", name: "x", evidenceUrl: `https://j/${i}`, observedAt: daysAgo(10) })), NOW)).toBe("high"));
  it("medium if seen once recently", () => expect(confidenceFor([sig({ source: "jobs", kind: "tech", name: "x", observedAt: daysAgo(5) })], NOW)).toBe("medium"));
  it("medium if seen several times, all older than 90 days", () =>
    expect(confidenceFor([1, 2].map((i) => sig({ source: "jobs", kind: "tech", name: "x", evidenceUrl: `https://j/${i}`, observedAt: daysAgo(120) })), NOW)).toBe("medium"));
  it("low for a single old sighting", () => expect(confidenceFor([sig({ source: "blog", kind: "tech", name: "x", observedAt: daysAgo(200) })], NOW)).toBe("low"));
});

describe("adopted / dropped", () => {
  const prev = [
    { tech: "Go", status: "active" as const, firstSeen: daysAgo(30), lastSeen: daysAgo(7), missingRuns: 0 },
    { tech: "Jenkins", status: "active" as const, firstSeen: daysAgo(30), lastSeen: daysAgo(7), missingRuns: 1 },
    { tech: "Ruby", status: "active" as const, firstSeen: daysAgo(30), lastSeen: daysAgo(7), missingRuns: 0 },
  ];
  it("marks new techs and drops after two consecutive missing successful runs", () => {
    const r = updateTechState(prev, new Map([["Go", NOW.toISOString()], ["Kotlin", NOW.toISOString()]]), NOW, true);
    expect(r.newTechs).toEqual(["Kotlin"]);
    expect(r.dropped).toEqual(["Jenkins"]);
    expect(r.next.find((x) => x.tech === "Ruby")?.missingRuns).toBe(1);
  });
  it("does not count missing runs when collectors failed", () => {
    const r = updateTechState(prev, new Map(), NOW, false);
    expect(r.dropped).toEqual([]);
  });
});

function baseComputed(over: Partial<Computed> = {}): Computed {
  return {
    languages: [],
    jobLanguages: [],
    techs: [],
    hosting: [],
    activity: { label: "unknown", pushed30: null, pushed90: null, created90: null, totalRepos: null, engineeringJobs: null },
    sdkHeavy: false,
    initiatives: [],
    blogPosts: [],
    hnStories: [],
    contradictions: [],
    fit: { score: 0, reasons: [] },
    coverage: "thin",
    githubOrg: null,
    jobBoard: null,
    checked: {},
    hash: "",
    ...over,
  };
}

describe("fit score", () => {
  it("scores target languages, CI, tests, monorepo, patterns and activity", () => {
    const t = (name: string, category: any, sources: any[] = ["github"]) => ({ name, category, confidence: "high" as const, sources, jobPosts: 0, requirementLevel: null, firstSeen: null, lastSeen: null, status: "active" as const, signalIds: [1], evidenceUrl: null });
    const c = baseComputed({
      languages: [{ name: "Go", pct: 70, signalId: 1 }, { name: "HCL", pct: 30, signalId: 2 }],
      techs: [t("GitHub Actions", "ci"), t("Jest", "test_framework"), t("Playwright", "test_framework"), t("Nx", "infra"), t("Kubernetes", "infra"), t("CI reliability", "pattern", ["jobs"])],
      activity: { label: "high", pushed30: 12, pushed90: 30, created90: 2, totalRepos: 50, engineeringJobs: 20 },
    });
    const f = fitScore(c, profile);
    // 14 (70% of 20) + 20 + 10 + 10 + 10 + 5 + 10
    expect(f.score).toBe(79);
    expect(f.reasons[0].points).toBe(20);
  });
  it("is zero with no signals", () => expect(fitScore(baseComputed(), profile).score).toBe(0));
});

describe("change events", () => {
  const prev = baseComputed({ initiatives: [], blogPosts: [{ title: "a", url: "u1", date: daysAgo(10), topic: "", signalId: 1 }], activity: { ...baseComputed().activity, engineeringJobs: 10 } });
  const curr = baseComputed({
    initiatives: [{ label: "Migration", sentence: "Migrating from Jenkins to GitHub Actions.", jobTitle: "SRE", evidenceUrl: "j", signalId: 2, date: daysAgo(1) }],
    blogPosts: [{ title: "a", url: "u1", date: daysAgo(10), topic: "", signalId: 1 }, { title: "b", url: "u2", date: daysAgo(2), topic: "", signalId: 4 }],
    activity: { ...baseComputed().activity, engineeringJobs: 16 },
  });
  it("emits initiative, hiring spike, new tech, dropped tech and new post", () => {
    const ev = changeEvents(curr, prev, ["Kotlin"], ["Ruby"], NOW).map((e) => e.type);
    expect(ev.slice(0, 3)).toEqual(["new_initiative", "hiring_spike", "new_tech"]);
    expect(ev.slice(3).sort()).toEqual(["dropped_tech", "new_blog_post"]); // equal weight, ordered by date
  });
  it("emits nothing on the first run", () => expect(changeEvents(curr, null, ["Kotlin"], [], NOW)).toEqual([]));
  it("no hiring spike below +50%", () => {
    const c2 = baseComputed({ activity: { ...baseComputed().activity, engineeringJobs: 14 } });
    expect(changeEvents(c2, prev, [], [], NOW).map((e) => e.type)).not.toContain("hiring_spike");
  });
});

describe("hash skip", () => {
  const a = [sig({ source: "github", kind: "tech", name: "Docker" }), sig({ source: "github", kind: "language", name: "Go", detail: { pct: 71.2 } })];
  it("ignores timestamps and order", () => {
    const b = [{ ...a[1], observedAt: daysAgo(3) }, { ...a[0], observedAt: daysAgo(1) }];
    expect(signalHash(a)).toBe(signalHash(b));
  });
  it("ignores small language-share jitter but not new techs", () => {
    expect(signalHash([a[0], { ...a[1], detail: { pct: 72.1 } }])).toBe(signalHash(a));
    expect(signalHash([...a, sig({ source: "github", kind: "tech", name: "Terraform" })])).not.toBe(signalHash(a));
  });
});

describe("blog quote verification", () => {
  const text = "We moved our build to Bazel last quarter.\nOur services are written in Golang and deployed on Kubernetes.";
  it("keeps verbatim quotes that contain the name", () => {
    const r = verifyMentions({ topic: "t", tech_mentions: [{ name: "Bazel", quote: "We moved our build to Bazel last quarter." }, { name: "Go", quote: "Our services are written in Golang" }] }, text, dict);
    expect(r.kept.map((k) => k.entry.canonical_name)).toEqual(["Bazel", "Go"]);
  });
  it("rejects an invented quote, a quote without the name, and a non-dictionary name", () => {
    const r = verifyMentions(
      {
        topic: "t",
        tech_mentions: [
          { name: "Rust", quote: "We rewrote everything in Rust programming." },
          { name: "Kubernetes", quote: "We moved our build to Bazel last quarter." },
          { name: "FooDB", quote: "We moved our build to Bazel last quarter." },
        ],
      },
      text,
      dict,
    );
    expect(r.kept).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["quote not found verbatim", "quote does not contain the name or an alias", "not in dictionary"]);
  });
  it("parses RSS and Atom", () => {
    expect(parseFeed(`<rss><channel><item><title>A</title><link>https://b/a</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`)[0]).toMatchObject({ title: "A", url: "https://b/a" });
    expect(parseFeed(`<feed><entry><title>B</title><link rel="alternate" href="https://b/b"/><published>2026-10-01T00:00:00Z</published></entry></feed>`)[0].url).toBe("https://b/b");
  });
});

describe("brief validator", () => {
  const sigs: BriefSignal[] = [
    { id: 11, source: "github", kind: "language", name: "Go", detail: { pct: 70 }, confidence: "high", requirement_level: null, url: "u", date: "2026-10-01" },
    { id: 12, source: "jobs", kind: "tech", name: "GitHub Actions", detail: { job_title: "SRE" }, confidence: "medium", requirement_level: "requirement", url: "u", date: "2026-10-01" },
    { id: 13, source: "jobs", kind: "initiative", name: "CI reliability", detail: { sentence: "Improve CI reliability for 200 services." }, confidence: null, requirement_level: null, url: "u", date: "2026-10-01" },
  ];
  const good = {
    paragraph_1: "Their public GitHub is mostly Go, and their job posts mention GitHub Actions.",
    paragraph_2: "A recent job post talks about improving CI reliability.",
    opener: "Your SRE post mentions improving CI reliability across 200 services; flaky tests are usually the first thing that breaks that.",
    opener_signal_ids: [13],
    already_answered: [
      { question: "Main language?", answer: "Go", signal_ids: [11] },
      { question: "CI system?", answer: "GitHub Actions per job posts", signal_ids: [12] },
      { question: "Is CI reliability a priority?", answer: "Yes, per a job post", signal_ids: [13] },
    ],
    still_unknown: [
      { question: "How many tests?", why_unknown: "Not visible publicly" },
      { question: "Who owns CI?", why_unknown: "No org chart in signals" },
    ],
    cited_signal_ids: [11, 12, 13],
    caveats: [],
  };
  it("accepts a valid brief", () => expect(validateBrief(JSON.stringify(good), sigs, dict)).toMatchObject({ ok: true }));
  it("rejects an unknown technology", () => {
    const r = validateBrief(JSON.stringify({ ...good, paragraph_1: good.paragraph_1 + " They also run Kubernetes on AWS." }), sigs, dict);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/Kubernetes/);
    expect(r.errors.join()).toMatch(/AWS/);
  });
  it("rejects a fake signal id", () => {
    const r = validateBrief(JSON.stringify({ ...good, opener_signal_ids: [999] }), sigs, dict);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/999/);
  });
  it("rejects wrong counts and a long opener", () => {
    const r = validateBrief(JSON.stringify({ ...good, still_unknown: [good.still_unknown[0]], opener: "word ".repeat(31) }), sigs, dict);
    expect(r.errors.join()).toMatch(/exactly 2/);
    expect(r.errors.join()).toMatch(/31 words/);
  });
  it("rejects invalid JSON", () => expect(validateBrief("{not json", sigs, dict).ok).toBe(false));
  it("strips inline id brackets without touching other text", () => {
    expect(stripInlineIds("Their job posts mention Kubernetes [200, 201] and Redis [7].")).toBe("Their job posts mention Kubernetes and Redis.");
    expect(stripInlineIds("scale platform engineering and developer experience; tests [x] stay")).toBe("scale platform engineering and developer experience; tests [x] stay");
    const r = validateBrief(JSON.stringify({ ...good, paragraph_1: "Their public GitHub is mostly Go [11], said to scale." }), sigs, dict);
    expect(r.brief?.paragraph_1).toBe("Their public GitHub is mostly Go, said to scale.");
  });
});

describe("digest ranking", () => {
  it("ranks by fit; this week's changes only break near-ties, and explains why now", () => {
    const ev = (w: number, title: string) => ({ type: "new_initiative" as const, title, date: NOW.toISOString(), evidenceUrl: "e", signalIds: [], weight: w });
    const r = rankAccounts(
      [
        { companyId: 1, name: "TopFitQuiet", domain: "a", fitScore: 98, events: [], computed: null, generatedAt: NOW },
        { companyId: 2, name: "CloseFitChanged", domain: "b", fitScore: 95, events: [ev(25, "Migration: x")], computed: null, generatedAt: NOW },
        { companyId: 3, name: "LowFitBusy", domain: "c", fitScore: 70, events: [ev(30, "a"), ev(30, "b"), ev(30, "c")], computed: null, generatedAt: NOW },
      ],
      NOW,
    );
    expect(r.map((x) => x.name)).toEqual(["CloseFitChanged", "TopFitQuiet", "LowFitBusy"]);
    expect(r[0].whyNow).toBe("Migration: x");
    expect(r[2].score).toBe(80); // change bonus is capped at 10
  });
});

describe("computeFields integration", () => {
  it("builds contradictions and coverage", () => {
    const s: Signal[] = [
      sig({ id: 1, source: "github", kind: "language", name: "Python", detail: { pct: 80 } }),
      sig({ id: 2, source: "github", kind: "activity", name: "repo_activity", detail: { pushed_30d: 3, pushed_90d: 8, created_90d: 1, total_public_repos: 40, sdk_heavy: true } }),
      ...[1, 2, 3].map((i) => sig({ id: 10 + i, source: "jobs", kind: "tech", name: "Java", evidenceUrl: `https://j/${i}`, detail: { category: "language" }, requirementLevel: "requirement" })),
      sig({ id: 20, source: "jobs", kind: "job_count", name: "engineering_jobs", detail: { engineering: 4 } }),
      sig({ id: 21, source: "github", kind: "tech", name: "GitHub Actions", detail: { category: "ci" } }),
      sig({ id: 22, source: "github", kind: "tech", name: "Docker", detail: { category: "infra" } }),
      sig({ id: 23, source: "github", kind: "tech", name: "pytest", detail: { category: "test_framework" } }),
    ];
    const c = computeFields({ signals: s, dict, profile, techState: [], newTechs: new Set(), hasPreviousRun: false, checked: {}, now: NOW });
    expect(c.contradictions[0]).toMatchObject({ github: "Python", jobs: "Java" });
    expect(c.sdkHeavy).toBe(true);
    expect(c.coverage).toBe("rich");
    expect(c.techs.find((t) => t.name === "Java")?.confidence).toBe("high");
  });
});

describe("conference talks", () => {
  const hit = (title: string, url: string | null, id = title) => ({ objectID: id, title, url, points: 10, num_comments: 1, created_at: "2026-09-01T00:00:00Z" });
  it("keeps talk-host links whose title names the company, de-duplicated", () => {
    const r = selectTalks(
      [
        hit("How Stripe builds reliable APIs [video]", "https://www.youtube.com/watch?v=abc"),
        hit("How Stripe builds reliable APIs (repost)", "https://www.youtube.com/watch?v=abc", "dup"),
        hit("Scaling CI at Stripe", "https://www.infoq.com/presentations/stripe-ci/"),
        hit("Stripe raises money", "https://techcrunch.com/x"),
        hit("Striped tables in CSS", "https://www.youtube.com/watch?v=zzz"),
        hit("Unrelated talk", "https://vimeo.com/1"),
        hit("Linear algebra for beginners", "https://www.youtube.com/watch?v=la"),
      ],
      "Stripe",
    );
    expect(r.map((h) => h.title)).toEqual(["How Stripe builds reliable APIs [video]", "Scaling CI at Stripe"]);
  });
  it("recognises talk hosts", () => {
    expect(isTalkUrl("https://youtu.be/x")).toBe(true);
    expect(isTalkUrl("https://speakerdeck.com/a/b")).toBe(true);
    expect(isTalkUrl("https://example.com/talk")).toBe(false);
    expect(isTalkUrl(null)).toBe(false);
  });
  it("extracts technologies from talk titles", () => {
    expect(talkTechMatches("Migrating to Kubernetes at Stripe", dict).map((m) => m.entry.canonical_name)).toContain("Kubernetes");
  });
});

describe("job board discovery", () => {
  it("finds Workday, Greenhouse, Lever, Ashby and SmartRecruiters links on careers pages", () => {
    expect(atsFromHtml('<a href="https://stryker.wd1.myworkdayjobs.com/StrykerCareers/login">Jobs</a>')).toEqual({ provider: "workday", slug: "stryker/wd1/StrykerCareers" });
    expect(atsFromHtml('<a href="https://acme.wd5.myworkdayjobs.com/en-US/External">Jobs</a>')).toEqual({ provider: "workday", slug: "acme/wd5/External" });
    expect(atsFromHtml('<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>')).toEqual({ provider: "greenhouse", slug: "acme" });
    expect(atsFromHtml('<a href="https://jobs.lever.co/acme/123">')).toEqual({ provider: "lever", slug: "acme" });
    expect(atsFromHtml('<a href="https://jobs.ashbyhq.com/Acme">')).toEqual({ provider: "ashby", slug: "Acme" });
    expect(atsFromHtml('<a href="https://careers.smartrecruiters.com/AcmeCorp">')).toEqual({ provider: "smartrecruiters", slug: "AcmeCorp" });
    expect(atsFromHtml("<p>No board here</p>")).toBeNull();
  });
  it("parses Workday posted labels", () => {
    const now = new Date("2026-10-11T00:00:00Z");
    expect(workdayPostedDate("Posted Today", now)).toBe(now.toISOString());
    expect(workdayPostedDate("Posted 5 Days Ago", now)).toBe(new Date("2026-10-06T00:00:00Z").toISOString());
    expect(workdayPostedDate("Posted 30+ Days Ago", now)).toBe(new Date("2026-09-11T00:00:00Z").toISOString());
    expect(workdayPostedDate(undefined, now)).toBeNull();
  });
});

describe("fit score follows the targeting profile", () => {
  const t = (name: string, category: any, sources: any[] = ["github"]) => ({ name, category, confidence: "high" as const, sources, jobPosts: 0, requirementLevel: null, firstSeen: null, lastSeen: null, status: "active" as const, signalIds: [1], evidenceUrl: null });
  const c = baseComputed({
    languages: [{ name: "Go", pct: 100, signalId: 1 }],
    techs: [t("GitHub Actions", "ci"), t("AWS", "cloud")],
    activity: { label: "low", pushed30: 1, pushed90: 2, created90: 0, totalRepos: 3, engineeringJobs: 0 },
  });
  it("default importance keeps the original weights", () => expect(fitScore(c, profile).score).toBe(40)); // 20 languages + 20 CI out of 100
  it("turning a factor off removes it and rescales", () => {
    const f = fitScore(c, { ...profile, importance: { ci: 0 } });
    expect(f.score).toBe(25); // 20 of the remaining 80
    expect(f.reasons.some((r) => r.reason.includes("CI"))).toBe(false);
  });
  it("high importance counts a factor double", () => expect(fitScore(c, { ...profile, importance: { ci: 2 } }).score).toBe(50)); // (20 + 40) / 120
  it("target clouds add a cloud factor only when set", () => {
    expect(fitScore(c, { ...profile, target_clouds: ["AWS"] }).score).toBe(45); // (20 + 20 + 10) / 110
    expect(fitScore(c, { ...profile, target_clouds: ["Azure"] }).score).toBe(36); // 40 / 110
  });
});

describe("info score", () => {
  const t = (name: string, sources: any[]) => ({ name, category: "infra" as const, confidence: "high" as const, sources, jobPosts: 0, requirementLevel: null, firstSeen: null, lastSeen: null, status: "active" as const, signalIds: [1], evidenceUrl: null });
  const NOW2 = new Date("2026-10-11T00:00:00Z");
  const c = baseComputed({
    languages: [{ name: "Go", pct: 100, signalId: 1 }],
    techs: [t("Docker", ["github", "jobs"]), t("Kubernetes", ["jobs"]), t("Terraform", ["github", "jobs"])],
    activity: { label: "high", pushed30: 5, pushed90: 9, created90: 0, totalRepos: 9, engineeringJobs: 12 },
    hosting: [{ name: "Cloudflare", evidence: "cf-ray", signalId: 2 }],
  });
  it("measures how much verified information there is", () => {
    const e = infoScore(c, NOW2, NOW2);
    // stack 4 items x3 = 12 · sources GitHub, job board, hosting x5 = 15 · cross-checks round(20 x 2/3) = 13 · depth ceil(12/5) = 3 · freshness 5 + 10
    expect(e.reasons.map((r) => r.points)).toEqual([12, 15, 13, 3, 15]);
    expect(e.score).toBe(58);
    expect(e.label).toBe("partial");
  });
  it("caps every part at its maximum", () => {
    const many = baseComputed({ ...c, techs: Array.from({ length: 15 }, (_, i) => t(`T${i}`, ["github", "jobs"])), initiatives: Array.from({ length: 5 }, () => ({ label: "x", sentence: "x", jobTitle: "x", evidenceUrl: null, signalId: 1, date: NOW2.toISOString() })) });
    const e = infoScore(many, NOW2, NOW2);
    for (const r of e.reasons) expect(r.points).toBeLessThanOrEqual(r.max);
    expect(e.reasons[0].points).toBe(30);
  });
  it("loses freshness when stale", () => {
    const old = new Date("2026-09-01T00:00:00Z");
    expect(infoScore(c, old, NOW2).reasons[4].points).toBe(10);
  });
  it("is sparse with no data", () => expect(infoScore(baseComputed(), null, NOW2)).toMatchObject({ score: 0, label: "sparse" }));
});

describe("GitHub org proof", () => {
  it("accepts an org whose website is on the company domain", () => {
    expect(orgWebsiteMatches("https://stripe.com", "stripe.com")).toBe(true);
    expect(orgWebsiteMatches("www.gitlab.com/about", "gitlab.com")).toBe(true);
    expect(orgWebsiteMatches("https://engineering.linear.app", "linear.app")).toBe(true);
  });
  it("rejects other sites and look-alikes", () => {
    expect(orgWebsiteMatches("https://notstripe.com", "stripe.com")).toBe(false);
    expect(orgWebsiteMatches("", "stripe.com")).toBe(false);
    expect(orgWebsiteMatches(null, "stripe.com")).toBe(false);
  });
});

describe("targeting profile validation", () => {
  it("accepts a profile that sets importance for only some factors", () => {
    const r = ProfileZ.safeParse({ ...profile, target_clouds: ["AWS"], importance: { activity: 2, ci: 0 } });
    expect(r.success).toBe(true);
  });
  it("accepts a profile with no importance at all", () => expect(ProfileZ.safeParse(profile).success).toBe(true));
  it("rejects an invalid importance level", () => expect(ProfileZ.safeParse({ ...profile, importance: { ci: 5 } }).success).toBe(false));
});

describe("cleanup schedule", () => {
  it("runs on the 1st of every other month at 09:00 IST", () => {
    expect(nextCleanup(new Date("2026-10-12T00:00:00Z")).toISOString()).toBe("2026-11-01T03:30:00.000Z");
    expect(nextCleanup(new Date("2026-11-01T04:00:00Z")).toISOString()).toBe("2027-01-01T03:30:00.000Z");
    expect(nextCleanup(new Date("2026-12-31T00:00:00Z")).toISOString()).toBe("2027-01-01T03:30:00.000Z");
  });
});
