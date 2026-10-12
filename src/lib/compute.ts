import { createHash } from "node:crypto";
import type { Category, Confidence, DictEntry, ProductProfile, Signal, Source } from "./types";

const DAY = 86_400_000;
const RECENT_DAYS = 90;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TechSummary {
  name: string;
  category: Category | "other";
  confidence: Confidence;
  sources: Source[];
  jobPosts: number;
  requirementLevel: "requirement" | "nice_to_have" | null;
  firstSeen: string | null;
  lastSeen: string | null;
  status: "new" | "active";
  signalIds: number[];
  evidenceUrl: string | null;
}

export interface FitReason {
  reason: string;
  points: number;
  signalIds: number[];
}

export interface ChangeEvent {
  type: "new_initiative" | "new_tech" | "dropped_tech" | "hiring_spike" | "new_blog_post" | "new_hn_story" | "new_talk";
  title: string;
  date: string;
  evidenceUrl: string | null;
  signalIds: number[];
  weight: number;
}

export interface Contradiction {
  kind: "language";
  github: string;
  jobs: string;
  note: string;
  signalIds: number[];
}

export interface Computed {
  languages: { name: string; pct: number; signalId: number | null }[];
  jobLanguages: { name: string; posts: number }[];
  techs: TechSummary[];
  hosting: { name: string; evidence: string; signalId: number | null }[];
  activity: {
    label: "high" | "medium" | "low" | "unknown";
    pushed30: number | null;
    pushed90: number | null;
    created90: number | null;
    totalRepos: number | null;
    engineeringJobs: number | null;
  };
  sdkHeavy: boolean;
  initiatives: { label: string; sentence: string; jobTitle: string; evidenceUrl: string | null; signalId: number | null; date: string }[];
  blogPosts: { title: string; url: string | null; date: string; topic: string; signalId: number | null }[];
  hnStories: { title: string; url: string | null; date: string; points: number; comments: number; signalId: number | null }[];
  talks?: { title: string; url: string | null; host: string; date: string; signalId: number | null }[];
  contradictions: Contradiction[];
  fit: { score: number; reasons: FitReason[] };
  coverage: "rich" | "thin" | "none";
  githubOrg: string | null;
  jobBoard: string | null;
  checked: Record<string, string[]>;
  hash: string;
  /** Sources found but not proven to be the company's: nothing from them is used until they are confirmed. */
  unconfirmed?: VerifiableSource[];
}

export type VerifiableSource = "github" | "jobs" | "blog";

export interface TechStateRow {
  tech: string;
  status: "active" | "dropped";
  firstSeen: string;
  lastSeen: string;
  missingRuns: number;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------
/**
 * high   = seen in 2+ distinct sources, or in 3+ distinct job posts within the last 90 days
 * medium = seen once recently (<= 90 days), or several times but all older than 90 days
 * low    = otherwise (a single sighting older than 90 days)
 */
export function confidenceFor(sigs: Pick<Signal, "source" | "observedAt" | "evidenceUrl">[], now: Date): Confidence {
  const sources = new Set(sigs.map((s) => s.source));
  const recent = sigs.filter((s) => now.getTime() - Date.parse(s.observedAt) <= RECENT_DAYS * DAY);
  const recentJobPosts = new Set(recent.filter((s) => s.source === "jobs").map((s) => s.evidenceUrl)).size;
  if (sources.size >= 2 || recentJobPosts >= 3) return "high";
  if (recent.length >= 1 || sigs.length >= 2) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// tech_state: adopted / dropped
// ---------------------------------------------------------------------------
/**
 * "new"     = first seen in the latest run (only reported when a previous run exists)
 * "dropped" = active before and missing from two consecutive successful runs.
 * Missing runs are only counted when the run's collectors succeeded (countMissing), so an outage
 * never marks technologies as dropped.
 */
export const DROP_AFTER_DAYS = 14;

export function updateTechState(
  prev: TechStateRow[],
  seen: Map<string, string>, // tech -> latest observedAt
  now: Date,
  countMissing: boolean,
): { next: TechStateRow[]; newTechs: string[]; dropped: string[] } {
  const nowIso = now.toISOString();
  const byTech = new Map(prev.map((r) => [r.tech, { ...r }]));
  const newTechs: string[] = [];
  const dropped: string[] = [];
  for (const [tech] of seen) {
    const r = byTech.get(tech);
    if (!r) {
      byTech.set(tech, { tech, status: "active", firstSeen: nowIso, lastSeen: nowIso, missingRuns: 0 });
      newTechs.push(tech);
    } else {
      if (r.status === "dropped") newTechs.push(tech); // re-adopted
      r.status = "active";
      r.lastSeen = nowIso;
      r.missingRuns = 0;
    }
  }
  if (countMissing) {
    for (const r of byTech.values()) {
      if (seen.has(r.tech) || r.status !== "active") continue;
      r.missingRuns += 1;
      // dropped = missing from 2+ successful refreshes AND unseen for 14+ days (two refreshes on one day prove nothing)
      if (r.missingRuns >= 2 && now.getTime() - Date.parse(r.lastSeen) >= DROP_AFTER_DAYS * 86_400_000) {
        r.status = "dropped";
        dropped.push(r.tech);
      }
    }
  }
  return { next: [...byTech.values()], newTechs, dropped };
}

// ---------------------------------------------------------------------------
// FIT SCORE: "does this account look like a good customer for what Nikhil sells?"
// Driven by the targeting profile in Settings (target languages, CI systems, clouds, patterns and an
// importance level per factor). Base weights (default importance, sum to 100):
//   languages ... 20  share of recent public code in target languages (15 if only job posts show them)
//   ci .......... 20  a target CI system is defined in code
//   tests ....... 15  5 per distinct test framework, max 3
//   services .... 10  microservices pattern, Kubernetes/Helm, or 20+ repos pushed in 90 days
//   monorepo .... 10  Nx, Turborepo, Bazel, Lerna, pnpm workspaces, Pants, or monorepo pattern
//   patterns .... 15  5 per target pattern seen in job posts / initiatives, max 3
//   activity .... 10  high 10, medium 5
//   cloud ....... 10  only counted when target clouds are set: a target cloud is in use
// Importance multiplies a factor's weight (off = 0, normal = 1, high = 2); the score is the share of the
// maximum possible points, so it always stays 0-100 and default settings give the original weights.
// ---------------------------------------------------------------------------
export const FIT_WEIGHTS = { languages: 20, ci: 20, tests: 15, services: 10, monorepo: 10, patterns: 15, activity: 10, cloud: 10 } as const;
export type FitComponent = keyof typeof FIT_WEIGHTS;
export const FIT_COMPONENTS: { key: FitComponent; label: string; what: string }[] = [
  { key: "languages", label: "Target languages", what: "Share of recent public code (or job posts) in your target languages" },
  { key: "ci", label: "CI in code", what: "One of your target CI systems is configured in their repos" },
  { key: "tests", label: "Test suites", what: "How many test frameworks they visibly use" },
  { key: "services", label: "Many services", what: "Microservices, Kubernetes/Helm, or lots of active repos" },
  { key: "monorepo", label: "Monorepo", what: "Monorepo tooling such as Nx, Turborepo or Bazel" },
  { key: "patterns", label: "Hiring themes", what: "Your target themes (CI reliability, platform team...) in job posts" },
  { key: "activity", label: "Momentum", what: "How actively they push code and hire engineers" },
  { key: "cloud", label: "Target clouds", what: "They use one of your target clouds (only if you set some)" },
];
const MONOREPO_TOOLS = ["Nx", "Turborepo", "Bazel", "Lerna", "pnpm workspaces", "Pants"];
const INITIATIVE_TO_PATTERN: Record<string, string> = {
  "Platform team": "platform team",
  "CI reliability": "CI reliability",
  "Build times": "CI reliability",
  "Test infrastructure": "test infrastructure",
  "Developer productivity": "developer productivity",
  "Monolith breakup": "microservices",
};

export function fitScore(c: Omit<Computed, "fit" | "hash" | "coverage" | "checked">, profile: ProductProfile): { score: number; reasons: FitReason[] } {
  const raw: (FitReason & { key: FitComponent })[] = [];
  const techByName = new Map(c.techs.map((t) => [t.name, t]));
  const ids = (names: string[]) => names.flatMap((n) => techByName.get(n)?.signalIds.slice(0, 2) ?? []);
  const imp = (k: FitComponent): number => profile.importance?.[k] ?? 1;
  const clouds = profile.target_clouds ?? [];
  const list = (xs: { name: string }[], n = 3) => xs.slice(0, n).map((x) => x.name).join(", ");

  // languages
  const targetLangs = new Set(profile.target_languages);
  const ghTarget = c.languages.filter((l) => targetLangs.has(l.name));
  const ghShare = ghTarget.reduce((a, l) => a + l.pct, 0);
  if (ghShare > 0) {
    const pts = Math.round((Math.min(ghShare, 100) / 100) * FIT_WEIGHTS.languages);
    if (pts > 0)
      raw.push({
        key: "languages",
        reason: `${Math.round(ghShare)}% of recent public code is in target languages (${list(ghTarget)})`,
        points: pts,
        signalIds: ghTarget.map((l) => l.signalId).filter((x): x is number => x != null),
      });
  } else {
    const jl = c.jobLanguages.filter((l) => targetLangs.has(l.name));
    if (jl.length) raw.push({ key: "languages", reason: `Job posts ask for ${list(jl)}`, points: 15, signalIds: ids(jl.map((l) => l.name)) });
  }

  // CI in code
  const ci = c.techs.filter((t) => profile.target_ci_systems.includes(t.name));
  if (ci.length) raw.push({ key: "ci", reason: `CI defined in code: ${list(ci, 9)}`, points: FIT_WEIGHTS.ci, signalIds: ids(ci.map((t) => t.name)) });

  // tests
  const tests = c.techs.filter((t) => t.category === "test_framework");
  if (tests.length)
    raw.push({
      key: "tests",
      reason: `${tests.length} test framework${tests.length > 1 ? "s" : ""} in use (${list(tests)})`,
      points: Math.min(3, tests.length) * 5,
      signalIds: ids(tests.slice(0, 3).map((t) => t.name)),
    });

  // multiple services
  const svc = c.techs.filter((t) => ["microservices", "Kubernetes", "Helm"].includes(t.name));
  if (svc.length || (c.activity.pushed90 ?? 0) >= 20)
    raw.push({
      key: "services",
      reason: svc.length ? `Multiple services: ${list(svc, 9)}` : `${c.activity.pushed90} repos pushed in the last 90 days`,
      points: FIT_WEIGHTS.services,
      signalIds: ids(svc.map((t) => t.name)),
    });

  // monorepo
  const mono = c.techs.filter((t) => MONOREPO_TOOLS.includes(t.name) || t.name === "monorepo");
  if (mono.length) raw.push({ key: "monorepo", reason: `Monorepo tooling: ${list(mono, 9)}`, points: FIT_WEIGHTS.monorepo, signalIds: ids(mono.map((t) => t.name)) });

  // target patterns in jobs / initiatives
  const patterns = new Map<string, number[]>();
  for (const t of c.techs) if (profile.target_patterns.includes(t.name) && t.name !== "monorepo" && t.name !== "microservices" && t.sources.includes("jobs")) patterns.set(t.name, t.signalIds.slice(0, 2));
  for (const i of c.initiatives) {
    const p = INITIATIVE_TO_PATTERN[i.label];
    if (p && profile.target_patterns.includes(p) && !patterns.has(p) && i.signalId != null) patterns.set(p, [i.signalId]);
  }
  if (patterns.size) {
    const names = [...patterns.keys()].slice(0, 3);
    raw.push({ key: "patterns", reason: `Job posts mention ${names.join(", ")}`, points: Math.min(3, patterns.size) * 5, signalIds: names.flatMap((p) => patterns.get(p)!) });
  }

  // activity
  if (c.activity.label === "high" || c.activity.label === "medium")
    raw.push({
      key: "activity",
      reason: `${c.activity.label === "high" ? "High" : "Moderate"} engineering activity${c.activity.engineeringJobs ? ` (${c.activity.engineeringJobs} open engineering roles)` : ""}`,
      points: c.activity.label === "high" ? 10 : 5,
      signalIds: [],
    });

  // target clouds (only when the profile names some)
  if (clouds.length) {
    const used = c.techs.filter((t) => t.category === "cloud" && clouds.includes(t.name));
    if (used.length) raw.push({ key: "cloud", reason: `Uses ${list(used, 9)}`, points: FIT_WEIGHTS.cloud, signalIds: ids(used.map((t) => t.name)) });
  }

  // When the public GitHub is mostly SDKs, it shows what they publish, not how they build: a factor supported
  // only by GitHub evidence counts half.
  if (c.sdkHeavy) {
    const onlyGithub = (names: string[]) => names.length > 0 && names.every((n) => (techByName.get(n)?.sources ?? ["github"]).every((s) => s === "github"));
    const names = (xs: { name: string }[]) => xs.map((x) => x.name);
    const githubOnly: Partial<Record<FitComponent, boolean>> = {
      languages: ghShare > 0,
      ci: onlyGithub(names(ci)),
      tests: onlyGithub(names(tests)),
      services: svc.length ? onlyGithub(names(svc)) : true, // otherwise based on repos pushed
      monorepo: onlyGithub(names(mono)),
      activity: !(c.activity.engineeringJobs ?? 0),
      cloud: onlyGithub(names(c.techs.filter((t) => t.category === "cloud" && clouds.includes(t.name)))),
    };
    for (const r of raw)
      if (githubOnly[r.key]) {
        r.points = r.points / 2;
        r.reason = `${r.reason} (public SDK repos)`;
      }
  }

  const included = (Object.keys(FIT_WEIGHTS) as FitComponent[]).filter((k) => (k !== "cloud" || clouds.length > 0) && imp(k) > 0);
  const max = included.reduce((a, k) => a + FIT_WEIGHTS[k] * imp(k), 0) || 1;
  const counted = raw.filter((r) => imp(r.key) > 0);
  const reasons: FitReason[] = counted
    .map((r) => ({ reason: r.reason, points: Math.round((r.points * imp(r.key) * 100) / max), signalIds: r.signalIds }))
    .filter((r) => r.points > 0)
    .sort((x, y) => y.points - x.points);
  const total = counted.reduce((a, r) => a + r.points * imp(r.key), 0);
  return { score: Math.min(100, Math.round((total * 100) / max)), reasons };
}

// ---------------------------------------------------------------------------
// Activity label thresholds
//   unknown: no GitHub activity and no job board
//   high:    10+ repos pushed in 30 days, or 15+ engineering roles, or (5+ pushed in 30 days and 5+ roles)
//   medium:  3+ repos pushed in 90 days, or 3+ engineering roles
//   low:     otherwise
// ---------------------------------------------------------------------------
export function activityLabel(pushed30: number | null, pushed90: number | null, jobs: number | null): Computed["activity"]["label"] {
  if (pushed30 == null && jobs == null) return "unknown";
  const p30 = pushed30 ?? 0;
  const p90 = pushed90 ?? 0;
  const j = jobs ?? 0;
  if (p30 >= 10 || j >= 15 || (p30 >= 5 && j >= 5)) return "high";
  if (p90 >= 3 || j >= 3) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Hash of the normalised signal set (timestamps and volatile counts excluded)
// ---------------------------------------------------------------------------
export function signalHash(signals: Signal[]): string {
  const keys = signals
    .map((s) => {
      if (s.kind === "activity") {
        const d = s.detail as Record<string, number>;
        return `github|activity|${activityLabel(d.pushed_30d, d.pushed_90d, null)}|${d.sdk_heavy}`;
      }
      if (s.kind === "language") return `github|language|${s.name}|${Math.round(Number(s.detail.pct) / 5) * 5}`;
      if (s.kind === "job_count") return `jobs|job_count|${Math.round(Number(s.detail.engineering) / 5) * 5}`;
      if (s.kind === "hn_story") return `hn|${s.evidenceUrl}`;
      return `${s.source}|${s.kind}|${s.name}|${s.requirementLevel ?? ""}|${s.evidenceUrl ?? ""}`;
    })
    .sort();
  return createHash("sha256").update([...new Set(keys)].join("\n")).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------
/** Roles whose language requirements say nothing about the engineering stack. */
const NON_ENGINEERING_TITLE = /\b(analysts?|interns?|internship|business systems|tax|finance|financial|data excellence)\b/i;
export function isNonEngineeringTitle(title: string): boolean {
  return NON_ENGINEERING_TITLE.test(title);
}

export function computeFields(args: {
  signals: Signal[];
  dict: DictEntry[];
  profile: ProductProfile;
  techState: TechStateRow[];
  newTechs: Set<string>;
  hasPreviousRun: boolean;
  checked: Record<string, string[]>;
  now: Date;
}): Computed {
  const { signals, dict, profile, now } = args;
  const dictByName = new Map(dict.map((e) => [e.canonical_name, e]));
  const stateByTech = new Map(args.techState.map((r) => [r.tech, r]));
  const sid = (s: Signal) => s.id ?? null;

  const languages = signals
    .filter((s) => s.kind === "language")
    .map((s) => ({ name: s.name, pct: Number(s.detail.pct), signalId: sid(s) }))
    .sort((a, b) => b.pct - a.pct);

  // technologies across sources (GitHub languages count as GitHub evidence for that language)
  const techSigs = new Map<string, Signal[]>();
  for (const s of signals) {
    if (s.kind === "tech" || (s.kind === "language" && dictByName.has(s.name))) {
      const arr = techSigs.get(s.name) ?? [];
      arr.push(s);
      techSigs.set(s.name, arr);
    }
  }
  const techs: TechSummary[] = [...techSigs.entries()].map(([name, sigs]) => {
    const st = stateByTech.get(name);
    const jobUrls = new Set(sigs.filter((s) => s.source === "jobs").map((s) => s.evidenceUrl));
    const req = sigs.some((s) => s.requirementLevel === "requirement") ? "requirement" : sigs.some((s) => s.requirementLevel === "nice_to_have") ? "nice_to_have" : null;
    const best = sigs.find((s) => s.source === "github") ?? sigs.find((s) => s.source === "blog") ?? sigs[0];
    return {
      name,
      category: dictByName.get(name)?.category ?? "other",
      confidence: confidenceFor(sigs, now),
      sources: [...new Set(sigs.map((s) => s.source))],
      jobPosts: jobUrls.size,
      requirementLevel: req,
      firstSeen: st?.firstSeen ?? null,
      lastSeen: st?.lastSeen ?? null,
      status: args.hasPreviousRun && args.newTechs.has(name) ? "new" : "active",
      signalIds: sigs.map(sid).filter((x): x is number => x != null),
      evidenceUrl: best.evidenceUrl,
    };
  });
  const confRank = { high: 0, medium: 1, low: 2 };
  techs.sort((a, b) => confRank[a.confidence] - confRank[b.confidence] || b.signalIds.length - a.signalIds.length);

  // languages asked for in engineering job posts; analyst, intern, finance-type roles are listed but not counted
  const langPosts = new Map<string, Set<string>>();
  for (const s of signals) {
    if (s.source !== "jobs" || s.kind !== "tech" || dictByName.get(s.name)?.category !== "language") continue;
    if (isNonEngineeringTitle(String(s.detail.job_title ?? ""))) continue;
    const set = langPosts.get(s.name) ?? new Set<string>();
    set.add(s.evidenceUrl ?? String(s.detail.job_title));
    langPosts.set(s.name, set);
  }
  const jobLanguages = [...langPosts.entries()].map(([name, posts]) => ({ name, posts: posts.size })).sort((a, b) => b.posts - a.posts);

  const act = signals.find((s) => s.kind === "activity");
  const jc = signals.find((s) => s.kind === "job_count");
  const ad = (act?.detail ?? {}) as Record<string, unknown>;
  const engineeringJobs = jc ? Number(jc.detail.engineering) : null;
  const pushed30 = act ? Number(ad.pushed_30d) : null;
  const pushed90 = act ? Number(ad.pushed_90d) : null;
  const activity = {
    label: activityLabel(pushed30, pushed90, engineeringJobs),
    pushed30,
    pushed90,
    created90: act ? Number(ad.created_90d) : null,
    totalRepos: act ? Number(ad.total_public_repos) : null,
    engineeringJobs,
  };

  const initiatives = signals
    .filter((s) => s.kind === "initiative")
    .map((s) => ({ label: s.name, sentence: String(s.detail.sentence), jobTitle: String(s.detail.job_title ?? ""), evidenceUrl: s.evidenceUrl, signalId: sid(s), date: s.observedAt }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const blogPosts = signals
    .filter((s) => s.kind === "blog_post")
    .map((s) => ({ title: s.name, url: s.evidenceUrl, date: s.observedAt, topic: String(s.detail.topic ?? ""), signalId: sid(s) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const hnStories = signals
    .filter((s) => s.kind === "hn_story")
    .map((s) => ({ title: s.name, url: s.evidenceUrl, date: s.observedAt, points: Number(s.detail.points), comments: Number(s.detail.comments), signalId: sid(s) }));
  const talks = signals
    .filter((s) => s.kind === "talk")
    .map((s) => ({ title: s.name, url: s.evidenceUrl, host: String(s.detail.host ?? ""), date: s.observedAt, signalId: sid(s) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const hosting = signals.filter((s) => s.kind === "hosting").map((s) => ({ name: s.name, evidence: String(s.detail.evidence), signalId: sid(s) }));

  // contradictions: dominant GitHub language vs dominant job-post language
  const contradictions: Contradiction[] = [];
  const ghTop = languages.find((l) => dictByName.get(l.name)?.category === "language");
  const jobTop = jobLanguages[0];
  if (ghTop && jobTop && ghTop.name !== jobTop.name) {
    contradictions.push({
      kind: "language",
      github: ghTop.name,
      jobs: jobTop.name,
      note: `Public GitHub is mostly ${ghTop.name} (${ghTop.pct}%) but job posts most often ask for ${jobTop.name} (${jobTop.posts} posts). Job posts are stronger evidence of the internal stack; public repos often hold SDKs and open-source tools.`,
      signalIds: [ghTop.signalId, ...(techs.find((t) => t.name === jobTop.name)?.signalIds.slice(0, 2) ?? [])].filter((x): x is number => x != null),
    });
  }

  const sdkHeavy = Boolean(ad.sdk_heavy);
  const base = {
    languages,
    jobLanguages,
    techs,
    hosting,
    activity,
    sdkHeavy,
    initiatives,
    blogPosts,
    hnStories,
    talks,
    contradictions,
    githubOrg: signals.find((s) => s.kind === "org")?.name ?? null,
    jobBoard: jc?.evidenceUrl ?? null,
  };
  const fit = fitScore(base, profile);
  const hasGithub = languages.length > 0 || Boolean(act);
  const hasJobs = (engineeringJobs ?? 0) > 0;
  const hasBlog = blogPosts.length > 0;
  const nonPatternTechs = techs.filter((t) => t.category !== "pattern").length;
  const sourcesWithData = [hasGithub, hasJobs, hasBlog].filter(Boolean).length;
  const coverage: Computed["coverage"] =
    !hasGithub && !hasJobs && !hasBlog && hnStories.length === 0 && talks.length === 0 ? "none" : sourcesWithData >= 2 && nonPatternTechs >= 5 ? "rich" : "thin";

  return { ...base, fit, coverage, checked: args.checked, hash: signalHash(signals) };
}

// ---------------------------------------------------------------------------
// Change events vs previous snapshot
// ---------------------------------------------------------------------------
export const EVENT_WEIGHTS: Record<ChangeEvent["type"], number> = {
  new_initiative: 25,
  hiring_spike: 20,
  new_tech: 10,
  new_blog_post: 8,
  dropped_tech: 8,
  new_hn_story: 6,
  new_talk: 8,
};

export function changeEvents(curr: Computed, prev: Computed | null, newTechs: string[], dropped: string[], now: Date): ChangeEvent[] {
  if (!prev) return [];
  const nowIso = now.toISOString();
  const ev: ChangeEvent[] = [];
  const push = (e: Omit<ChangeEvent, "weight">) => ev.push({ ...e, weight: EVENT_WEIGHTS[e.type] });

  const prevInit = new Set(prev.initiatives.map((i) => i.label + "|" + i.sentence));
  for (const i of curr.initiatives)
    if (!prevInit.has(i.label + "|" + i.sentence))
      push({ type: "new_initiative", title: `${i.label}: "${i.sentence.slice(0, 140)}"${i.jobTitle ? ` (${i.jobTitle})` : ""}`, date: i.date, evidenceUrl: i.evidenceUrl, signalIds: i.signalId != null ? [i.signalId] : [] });

  const techByName = new Map(curr.techs.map((t) => [t.name, t]));
  for (const t of newTechs) {
    const s = techByName.get(t);
    push({ type: "new_tech", title: `${t} first seen (${s?.sources.join(", ") ?? "signals"})`, date: nowIso, evidenceUrl: s?.evidenceUrl ?? null, signalIds: s?.signalIds.slice(0, 2) ?? [] });
  }
  for (const t of dropped) push({ type: "dropped_tech", title: `${t} no longer seen in two consecutive refreshes`, date: nowIso, evidenceUrl: null, signalIds: [] });


  const pj = prev.activity.engineeringJobs ?? 0;
  const cj = curr.activity.engineeringJobs ?? 0;
  if (pj > 0 && cj >= pj * 1.5 && cj - pj >= 2)
    push({ type: "hiring_spike", title: `Engineering openings up from ${pj} to ${cj}`, date: nowIso, evidenceUrl: curr.jobBoard, signalIds: [] });

  const prevBlog = new Set(prev.blogPosts.map((b) => b.url));
  for (const b of curr.blogPosts) if (!prevBlog.has(b.url)) push({ type: "new_blog_post", title: `New post: ${b.title}`, date: b.date, evidenceUrl: b.url, signalIds: b.signalId != null ? [b.signalId] : [] });
  const prevHn = new Set(prev.hnStories.map((b) => b.url));
  for (const h of curr.hnStories) if (!prevHn.has(h.url)) push({ type: "new_hn_story", title: `On Hacker News: ${h.title} (${h.points} points)`, date: h.date, evidenceUrl: h.url, signalIds: h.signalId != null ? [h.signalId] : [] });

  const prevTalks = new Set((prev.talks ?? []).map((t) => t.url));
  if (prev.talks) for (const t of curr.talks ?? []) if (!prevTalks.has(t.url)) push({ type: "new_talk", title: `Conference talk: ${t.title}`, date: t.date, evidenceUrl: t.url, signalIds: t.signalId != null ? [t.signalId] : [] });

  return ev.sort((a, b) => b.weight - a.weight || b.date.localeCompare(a.date));
}
