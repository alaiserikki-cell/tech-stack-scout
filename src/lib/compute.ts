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
  type: "new_initiative" | "new_tech" | "dropped_tech" | "competitor_appeared" | "hiring_spike" | "new_blog_post" | "new_hn_story";
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
  competitors: { name: string; match: string; evidenceUrl: string | null; signalId: number | null }[];
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
  contradictions: Contradiction[];
  fit: { score: number; reasons: FitReason[] };
  coverage: "rich" | "thin" | "none";
  githubOrg: string | null;
  jobBoard: string | null;
  checked: Record<string, string[]>;
  hash: string;
}

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
      if (r.missingRuns >= 2) {
        r.status = "dropped";
        dropped.push(r.tech);
      }
    }
  }
  return { next: [...byTech.values()], newTechs, dropped };
}

// ---------------------------------------------------------------------------
// Fit score. Weights (sum to 100):
//   target languages ............ 20  (share of GitHub bytes in target languages; 15 if only job posts show them)
//   CI defined in code .......... 20  (any target CI system detected)
//   test frameworks ............. 15  (5 per distinct framework, max 3)
//   multiple services ........... 10  (microservices pattern, Kubernetes/Helm, or 20+ repos pushed in 90 days)
//   monorepo tooling ............ 10  (Nx, Turborepo, Bazel, Lerna, pnpm workspaces, Pants, or monorepo pattern)
//   target patterns in jobs ..... 15  (5 per distinct target pattern / matching initiative, max 3)
//   activity / hiring ........... 10  (high 10, medium 5)
// ---------------------------------------------------------------------------
export const FIT_WEIGHTS = { languages: 20, ci: 20, tests: 15, services: 10, monorepo: 10, patterns: 15, activity: 10 } as const;
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
  const reasons: FitReason[] = [];
  const techByName = new Map(c.techs.map((t) => [t.name, t]));
  const ids = (names: string[]) => names.flatMap((n) => techByName.get(n)?.signalIds.slice(0, 2) ?? []);

  // languages
  const targetLangs = new Set(profile.target_languages);
  const ghTarget = c.languages.filter((l) => targetLangs.has(l.name));
  const ghShare = ghTarget.reduce((a, l) => a + l.pct, 0);
  if (ghShare > 0) {
    const pts = Math.round((Math.min(ghShare, 100) / 100) * FIT_WEIGHTS.languages);
    if (pts > 0)
      reasons.push({
        reason: `${Math.round(ghShare)}% of recent public code is in target languages (${ghTarget.slice(0, 3).map((l) => l.name).join(", ")})`,
        points: pts,
        signalIds: ghTarget.map((l) => l.signalId).filter((x): x is number => x != null),
      });
  } else {
    const jl = c.jobLanguages.filter((l) => targetLangs.has(l.name));
    if (jl.length)
      reasons.push({ reason: `Job posts ask for ${jl.slice(0, 3).map((l) => l.name).join(", ")}`, points: 15, signalIds: ids(jl.map((l) => l.name)) });
  }

  // CI in code
  const ci = c.techs.filter((t) => profile.target_ci_systems.includes(t.name));
  if (ci.length) reasons.push({ reason: `CI defined in code: ${ci.map((t) => t.name).join(", ")}`, points: FIT_WEIGHTS.ci, signalIds: ids(ci.map((t) => t.name)) });

  // tests
  const tests = c.techs.filter((t) => t.category === "test_framework");
  if (tests.length)
    reasons.push({
      reason: `${tests.length} test framework${tests.length > 1 ? "s" : ""} in use (${tests.slice(0, 3).map((t) => t.name).join(", ")})`,
      points: Math.min(3, tests.length) * 5,
      signalIds: ids(tests.slice(0, 3).map((t) => t.name)),
    });

  // multiple services
  const svc = c.techs.filter((t) => ["microservices", "Kubernetes", "Helm"].includes(t.name));
  if (svc.length || (c.activity.pushed90 ?? 0) >= 20)
    reasons.push({
      reason: svc.length ? `Multiple services: ${svc.map((t) => t.name).join(", ")}` : `${c.activity.pushed90} repos pushed in the last 90 days`,
      points: FIT_WEIGHTS.services,
      signalIds: ids(svc.map((t) => t.name)),
    });

  // monorepo
  const mono = c.techs.filter((t) => MONOREPO_TOOLS.includes(t.name) || t.name === "monorepo");
  if (mono.length) reasons.push({ reason: `Monorepo tooling: ${mono.map((t) => t.name).join(", ")}`, points: FIT_WEIGHTS.monorepo, signalIds: ids(mono.map((t) => t.name)) });

  // target patterns in jobs / initiatives
  const patterns = new Map<string, number[]>();
  for (const t of c.techs) if (profile.target_patterns.includes(t.name) && t.name !== "monorepo" && t.name !== "microservices" && t.sources.includes("jobs")) patterns.set(t.name, t.signalIds.slice(0, 2));
  for (const i of c.initiatives) {
    const p = INITIATIVE_TO_PATTERN[i.label];
    if (p && profile.target_patterns.includes(p) && !patterns.has(p) && i.signalId != null) patterns.set(p, [i.signalId]);
  }
  if (patterns.size) {
    const list = [...patterns.keys()].slice(0, 3);
    reasons.push({ reason: `Job posts mention ${list.join(", ")}`, points: Math.min(3, patterns.size) * 5, signalIds: list.flatMap((p) => patterns.get(p)!) });
  }

  // activity
  if (c.activity.label === "high" || c.activity.label === "medium")
    reasons.push({
      reason: `${c.activity.label === "high" ? "High" : "Moderate"} engineering activity${c.activity.engineeringJobs ? ` (${c.activity.engineeringJobs} open engineering roles)` : ""}`,
      points: c.activity.label === "high" ? 10 : 5,
      signalIds: [],
    });

  reasons.sort((a, b) => b.points - a.points);
  return { score: Math.min(100, reasons.reduce((a, r) => a + r.points, 0)), reasons };
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

  const jobLanguages = techs
    .filter((t) => t.category === "language" && t.jobPosts > 0)
    .map((t) => ({ name: t.name, posts: t.jobPosts }))
    .sort((a, b) => b.posts - a.posts);

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
  const hosting = signals.filter((s) => s.kind === "hosting").map((s) => ({ name: s.name, evidence: String(s.detail.evidence), signalId: sid(s) }));
  const competitors = signals.filter((s) => s.kind === "competitor").map((s) => ({ name: s.name, match: String(s.detail.match), evidenceUrl: s.evidenceUrl, signalId: sid(s) }));

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
    competitors,
    activity,
    sdkHeavy,
    initiatives,
    blogPosts,
    hnStories,
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
    !hasGithub && !hasJobs && !hasBlog && hnStories.length === 0 ? "none" : sourcesWithData >= 2 && nonPatternTechs >= 5 ? "rich" : "thin";

  return { ...base, fit, coverage, checked: args.checked, hash: signalHash(signals) };
}

// ---------------------------------------------------------------------------
// Change events vs previous snapshot
// ---------------------------------------------------------------------------
export const EVENT_WEIGHTS: Record<ChangeEvent["type"], number> = {
  competitor_appeared: 30,
  new_initiative: 25,
  hiring_spike: 20,
  new_tech: 10,
  new_blog_post: 8,
  dropped_tech: 8,
  new_hn_story: 6,
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

  const prevComp = new Set(prev.competitors.map((c) => c.name));
  for (const c of curr.competitors)
    if (!prevComp.has(c.name)) push({ type: "competitor_appeared", title: `${c.name} detected (${c.match})`, date: nowIso, evidenceUrl: c.evidenceUrl, signalIds: c.signalId != null ? [c.signalId] : [] });

  const pj = prev.activity.engineeringJobs ?? 0;
  const cj = curr.activity.engineeringJobs ?? 0;
  if (pj > 0 && cj >= pj * 1.5 && cj - pj >= 2)
    push({ type: "hiring_spike", title: `Engineering openings up from ${pj} to ${cj}`, date: nowIso, evidenceUrl: curr.jobBoard, signalIds: [] });

  const prevBlog = new Set(prev.blogPosts.map((b) => b.url));
  for (const b of curr.blogPosts) if (!prevBlog.has(b.url)) push({ type: "new_blog_post", title: `New post: ${b.title}`, date: b.date, evidenceUrl: b.url, signalIds: b.signalId != null ? [b.signalId] : [] });
  const prevHn = new Set(prev.hnStories.map((b) => b.url));
  for (const h of curr.hnStories) if (!prevHn.has(h.url)) push({ type: "new_hn_story", title: `On Hacker News: ${h.title} (${h.points} points)`, date: h.date, evidenceUrl: h.url, signalIds: h.signalId != null ? [h.signalId] : [] });

  return ev.sort((a, b) => b.weight - a.weight || b.date.localeCompare(a.date));
}
