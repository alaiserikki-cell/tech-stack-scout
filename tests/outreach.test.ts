import { describe, expect, it } from "vitest";
import profileJson from "../data/product-profile.json";
import { gmailComposeUrl, mailtoUrl, outreachEmail } from "../src/lib/outreach";

const t = (name: string, category: string, sources: string[]) => ({ name, category, sources }) as never;
const profile = profileJson as never;

// Real shape of Stripe's brief (12 Oct 2026): public GitHub is mostly SDKs (sdk_heavy), job posts describe the internal stack.
const stripeBrief = {
  opener:
    "With Stripe currently hiring an Engineering Manager for Mobile Development Productivity to oversee CI and test infrastructure, how are you isolating flaky test failures across your pipelines?",
  paragraph_1:
    "Their job posts indicate an internal stack spanning Python, Ruby and Go running on AWS with Docker. Their public GitHub showcases significant code in Java, Kotlin and Swift, alongside Turborepo for repository management. For CI and infrastructure, their public GitHub repositories show configurations for GitHub Actions and Gradle. Stripe runs GitHub Actions for every service.",
  paragraph_2:
    "Recent job openings specifically target test infrastructure and developer productivity. Testing frameworks visible across their public GitHub include pytest and Vitest. As the team expands, automated quarantine of flaky tests with FlakeGuard directly supports their initiatives.",
};
const stripeComputed = {
  sdkHeavy: true,
  languages: [
    { name: "Java", pct: 40, signalId: 1 },
    { name: "Kotlin", pct: 20, signalId: 2 },
  ],
  jobLanguages: [
    { name: "Python", posts: 12 },
    { name: "Ruby", posts: 9 },
    { name: "Go", posts: 7 },
  ],
  techs: [
    t("AWS", "cloud", ["jobs"]),
    t("Docker", "infra", ["github", "jobs"]),
    t("GitHub Actions", "ci", ["github"]),
    t("Gradle", "infra", ["github"]),
    t("Turborepo", "framework", ["github"]),
    t("pytest", "test_framework", ["github"]),
    t("Vitest", "test_framework", ["github"]),
  ],
} as never;

describe("outreach email draft (Stripe, sdk_heavy)", () => {
  const d = outreachEmail({ company: "Stripe", brief: stripeBrief, computed: stripeComputed, profile });

  it("opens with the opener and keeps the job-post sentence, in the second person", () => {
    expect(d.body.split("\n\n")[1]).toBe(stripeBrief.opener);
    expect(d.body).toContain("Your job posts indicate an internal stack spanning Python, Ruby and Go running on AWS with Docker.");
    expect(d.body).toContain("Recent job openings specifically target test infrastructure and developer productivity.");
  });

  it("never states a GitHub-only tool as how Stripe builds internally", () => {
    expect(d.body).not.toMatch(/Stripe runs GitHub Actions/);
    expect(d.body).not.toMatch(/configurations for GitHub Actions/);
    expect(d.body).not.toMatch(/significant code in Java/);
    expect(d.subject).not.toMatch(/GitHub Actions/);
    expect(d.subject).toBe("Stripe's CI pipeline and FlakeGuard");
  });

  it("phrases GitHub-only CI and test tools as 'your public repos use X'", () => {
    expect(d.body).toContain("Your public repos use GitHub Actions, pytest and Vitest.");
  });

  it("uses only hedged sentences and leaves out the product pitch sentence from the brief", () => {
    expect(d.body).not.toContain("automated quarantine of flaky tests with FlakeGuard directly supports");
    expect(d.body.endsWith("Best,\nNikhil")).toBe(true);
  });
});

describe("outreach email draft (not sdk_heavy)", () => {
  const computed = { ...(stripeComputed as object), sdkHeavy: false } as never;
  const d = outreachEmail({ company: "Acme", brief: { ...stripeBrief, opener: "Hi." }, computed, profile });
  it("keeps a public-repo sentence that names its source, but drops an unhedged claim", () => {
    expect(d.body).toContain("Your job posts indicate");
    expect(d.body).not.toContain("Your public repos use"); // the extra line is only for sdk_heavy orgs
    expect(d.body).not.toMatch(/runs GitHub Actions for every service/);
  });
  it("builds Gmail and mail-app links with the draft encoded", () => {
    expect(gmailComposeUrl(d)).toContain("su=Acme's%20CI%20pipeline");
    expect(decodeURIComponent(mailtoUrl(d).split("&body=")[1])).toBe(d.body);
  });
});

describe("job filtering", async () => {
  const { isNonEngineeringTitle, computeFields } = await import("../src/lib/compute");
  const dict = (await import("../data/tech-dictionary.json")).default as never;
  it.each([
    ["Data Analyst", true],
    ["Software Engineering Intern", true],
    ["Business Systems Engineer", true],
    ["Tax Technology Lead", true],
    ["Finance Systems Developer", true],
    ["Data Excellence Manager", true],
    ["Senior Software Engineer, Internal Tools", false],
    ["International Payments Backend Engineer", false],
    ["Platform Engineer", false],
  ])("%s -> %s", (title, excluded) => expect(isNonEngineeringTitle(title as string)).toBe(excluded));

  it("leaves excluded roles out of language counts and contradictions", () => {
    const sig = (id: number, title: string, lang: string) => ({ id, source: "jobs", kind: "tech", name: lang, detail: { category: "language", job_title: title }, evidenceUrl: `https://j/${id}`, observedAt: "2026-10-10T00:00:00Z" });
    const signals = [
      { id: 1, source: "github", kind: "language", name: "Go", detail: { pct: 80 }, evidenceUrl: null, observedAt: "2026-10-10T00:00:00Z" },
      sig(2, "Data Analyst", "Python"),
      sig(3, "Finance Analyst", "Python"),
      sig(4, "Backend Engineer", "Go"),
    ];
    const c = computeFields({ signals: signals as never, dict, profile, techState: [], newTechs: new Set(), hasPreviousRun: false, checked: {}, now: new Date("2026-10-12T00:00:00Z") });
    expect(c.jobLanguages).toEqual([{ name: "Go", posts: 1 }]);
    expect(c.contradictions).toEqual([]); // without the filter: "GitHub says Go, jobs say Python"
  });
});
