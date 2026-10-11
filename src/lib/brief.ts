import { z } from "zod";
import type { DictEntry, ProductProfile, Signal } from "./types";
import type { ChangeEvent, Computed } from "./compute";
import { matchText } from "./dictionary";
import { words } from "./text";
import { GeminiQuotaError, type GeminiCall } from "./gemini";

export const NO_SIGNAL_TEXT = "Not enough public engineering signal for this company.";

export interface Brief {
  paragraph_1: string;
  paragraph_2: string;
  opener: string;
  opener_signal_ids: number[];
  already_answered: { question: string; answer: string; signal_ids: number[] }[];
  still_unknown: { question: string; why_unknown: string }[];
  cited_signal_ids: number[];
  caveats: string[];
}

export const BRIEF_JSON_SCHEMA = {
  type: "object",
  properties: {
    paragraph_1: { type: "string", description: "How they build: languages, CI, infra, cloud. Name the source type behind each claim." },
    paragraph_2: { type: "string", description: "How actively they build, what changed recently, where the product is relevant." },
    opener: { type: "string", description: "One sentence, max 30 words, or empty string." },
    opener_signal_ids: { type: "array", items: { type: "integer" } },
    already_answered: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: { question: { type: "string" }, answer: { type: "string" }, signal_ids: { type: "array", items: { type: "integer" } } },
        required: ["question", "answer", "signal_ids"],
      },
    },
    still_unknown: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        properties: { question: { type: "string" }, why_unknown: { type: "string" } },
        required: ["question", "why_unknown"],
      },
    },
    cited_signal_ids: { type: "array", items: { type: "integer" } },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["paragraph_1", "paragraph_2", "opener", "opener_signal_ids", "already_answered", "still_unknown", "cited_signal_ids", "caveats"],
} as const;

const BriefZ = z.object({
  paragraph_1: z.string().min(1),
  paragraph_2: z.string().min(1),
  opener: z.string(),
  opener_signal_ids: z.array(z.number().int()),
  already_answered: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1), signal_ids: z.array(z.number().int()) })),
  still_unknown: z.array(z.object({ question: z.string().min(1), why_unknown: z.string().min(1) })),
  cited_signal_ids: z.array(z.number().int()),
  caveats: z.array(z.string()),
});

export interface BriefSignal {
  id: number;
  source: string;
  kind: string;
  name: string;
  detail: Record<string, unknown>;
  confidence: string | null;
  requirement_level: string | null;
  url: string | null;
  date: string;
}

/** Compact, de-duplicated signal list sent to Gemini (one representative per source+technology). */
export function selectBriefSignals(signals: Signal[], computed: Computed): BriefSignal[] {
  const conf = new Map(computed.techs.map((t) => [t.name, t.confidence]));
  const out: BriefSignal[] = [];
  const add = (s: Signal, extra: Record<string, unknown> = {}) => {
    if (s.id == null) return;
    const detail: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ ...s.detail, ...extra })) {
      if (v == null || v === "") continue;
      detail[k] = typeof v === "string" ? v.slice(0, 300) : Array.isArray(v) ? v.slice(0, 10) : v;
    }
    out.push({
      id: s.id,
      source: s.source,
      kind: s.kind,
      name: s.name,
      detail,
      confidence: conf.get(s.name) ?? null,
      requirement_level: s.requirementLevel ?? null,
      url: s.evidenceUrl,
      date: s.observedAt.slice(0, 10),
    });
  };
  const byRecent = (a: Signal, b: Signal) => b.observedAt.localeCompare(a.observedAt);
  for (const s of signals.filter((s) => ["org", "activity", "job_count", "language", "competitor", "hosting"].includes(s.kind))) add(s);
  const techGroups = new Map<string, Signal[]>();
  for (const s of signals.filter((s) => s.kind === "tech")) {
    const k = `${s.source}|${s.name}`;
    techGroups.set(k, [...(techGroups.get(k) ?? []), s]);
  }
  for (const group of techGroups.values()) {
    group.sort((a, b) => (a.requirementLevel === "requirement" ? -1 : 0) - (b.requirementLevel === "requirement" ? -1 : 0) || byRecent(a, b));
    const posts = new Set(group.map((g) => g.evidenceUrl)).size;
    add(group[0], group[0].source === "jobs" ? { job_posts_mentioning: posts } : {});
  }
  for (const s of signals.filter((s) => s.kind === "initiative").sort(byRecent).slice(0, 10)) add(s);
  for (const s of signals.filter((s) => s.kind === "blog_post").sort(byRecent).slice(0, 5)) add(s);
  for (const s of signals.filter((s) => s.kind === "hn_story").sort(byRecent).slice(0, 5)) add(s);
  for (const s of signals.filter((s) => s.kind === "job_post").sort(byRecent).slice(0, 8)) add(s);
  return out;
}

export const BRIEF_SYSTEM = `You write call-prep briefs for an account executive. You ONLY rewrite facts from the provided signals into prose.
Rules:
- Every factual claim must come from the signals. Cite signal ids. Never mention a technology, product, or vendor that does not appear in the signals.
- Name the source type behind each claim ("their public GitHub", "their job posts", "their engineering blog", "a Hacker News story", "DNS/HTTP headers").
- Hedge inferences: write "their job posts mention X", not "they run X". Public GitHub often shows SDKs and open-source tools rather than the internal stack; job posts are stronger evidence of the internal stack. If sdk_heavy is true or a contradiction is listed, say so.
- Hosting signals describe public-facing hosting only, never the backend.
- paragraph_1: how they build (languages, CI, infrastructure, cloud), naming the source behind each claim. 3-5 sentences.
- paragraph_2: how actively they build, what changed recently, and where the product is relevant. 3-5 sentences.
- opener: ONE sentence, at most 30 words, that references one specific recent signal and links it to the product's problem. Prefer the most recent owned content (a blog post or a job-post initiative) over repo statistics. If nothing connects, return an empty string.
- already_answered: exactly 3 discovery questions the evidence already answers, each with a short answer and the signal ids behind it.
- still_unknown: exactly 2 important discovery questions the signals cannot answer, with why.
- caveats: short notes on evidence limits (sdk_heavy, unverified sources, contradictions, thin coverage).
- Do not write signal ids or brackets in any text field; put ids only in the *_signal_ids / signal_ids arrays.
- No templates, no flattery, no generic praise, no exclamation marks, no emoji.`;

export function buildBriefPrompt(profile: ProductProfile, sigs: BriefSignal[], computed: Computed, events: ChangeEvent[], unverified: string[]): string {
  const c = {
    languages_pct: computed.languages.slice(0, 6).map((l) => `${l.name} ${l.pct}%`),
    activity: computed.activity,
    sdk_heavy: computed.sdkHeavy,
    fit_score: computed.fit.score,
    fit_reasons: computed.fit.reasons.map((r) => r.reason),
    coverage: computed.coverage,
    competitors_present: computed.competitors.map((x) => x.name),
    technologies: computed.techs.slice(0, 40).map((t) => ({ name: t.name, category: t.category, confidence: t.confidence, sources: t.sources, job_posts: t.jobPosts })),
  };
  return [
    `PRODUCT:\n${JSON.stringify({ name: profile.product_name, pitch: profile.one_line_pitch, problem: profile.problem_it_solves, ideal_customer_signals: profile.ideal_customer_signals })}`,
    `SIGNALS (cite by id):\n${JSON.stringify(sigs)}`,
    `COMPUTED FIELDS:\n${JSON.stringify(c)}`,
    `CONTRADICTIONS:\n${JSON.stringify(computed.contradictions.map((x) => x.note))}`,
    `CHANGE EVENTS SINCE LAST REFRESH:\n${JSON.stringify(events.slice(0, 10).map((e) => ({ type: e.type, title: e.title, date: e.date.slice(0, 10), signal_ids: e.signalIds })))}`,
    `UNVERIFIED SOURCES (auto-discovered, mention as a caveat): ${JSON.stringify(unverified)}`,
    `Today is ${new Date().toISOString().slice(0, 10)}. Return the JSON object only.`,
  ].join("\n\n");
}

/** Technologies (dictionary entries, patterns excluded) that appear anywhere in the input signals. */
export function allowedTechs(sigs: BriefSignal[], dict: DictEntry[]): Set<string> {
  const allowed = new Set<string>();
  const nonPattern = dict.filter((e) => e.category !== "pattern");
  const names = new Set(nonPattern.map((e) => e.canonical_name));
  for (const s of sigs) {
    if (names.has(s.name)) allowed.add(s.name);
    for (const m of matchText(`${s.name}\n${JSON.stringify(s.detail)}`, nonPattern)) allowed.add(m.entry.canonical_name);
  }
  return allowed;
}

/** Remove inline citation brackets like " [12, 13]" that the model sometimes leaves in prose. */
export function stripInlineIds(s: string): string {
  return s
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  brief: Brief | null;
}

/** Code validation of every Gemini output. */
export function validateBrief(raw: string, sigs: BriefSignal[], dict: DictEntry[]): ValidationResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["Response is not valid JSON"], brief: null };
  }
  const r = BriefZ.safeParse(parsed);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `Schema: ${i.path.join(".")} ${i.message}`), brief: null };
  const b = r.data as Brief;
  const ids = new Set(sigs.map((s) => s.id));
  const cited = [...b.opener_signal_ids, ...b.cited_signal_ids, ...b.already_answered.flatMap((a) => a.signal_ids)];
  const bad = [...new Set(cited.filter((id) => !ids.has(id)))];
  if (bad.length) errors.push(`Unknown signal ids cited: ${bad.join(", ")}`);
  if (b.already_answered.length !== 3) errors.push(`already_answered must have exactly 3 items (got ${b.already_answered.length})`);
  if (b.still_unknown.length !== 2) errors.push(`still_unknown must have exactly 2 items (got ${b.still_unknown.length})`);
  b.already_answered.forEach((a, i) => {
    if (!a.signal_ids.length) errors.push(`already_answered[${i}] has no signal_ids`);
  });
  if (b.opener && words(b.opener) > 30) errors.push(`opener has ${words(b.opener)} words (max 30)`);
  if (b.opener && !b.opener_signal_ids.length) errors.push("opener has no opener_signal_ids");

  const allowed = allowedTechs(sigs, dict);
  const nonPattern = dict.filter((e) => e.category !== "pattern");
  const texts = [
    b.paragraph_1,
    b.paragraph_2,
    b.opener,
    ...b.already_answered.flatMap((a) => [a.question, a.answer]),
    ...b.still_unknown.flatMap((u) => [u.question, u.why_unknown]),
    ...b.caveats,
  ].join("\n");
  const unknownTech = [...new Set(matchText(texts, nonPattern).map((m) => m.entry.canonical_name).filter((n) => !allowed.has(n)))];
  if (unknownTech.length) errors.push(`Mentions technologies not in the signals: ${unknownTech.join(", ")}`);

  // strip any inline id brackets the model left in prose
  const strip = stripInlineIds;
  b.paragraph_1 = strip(b.paragraph_1);
  b.paragraph_2 = strip(b.paragraph_2);
  b.opener = strip(b.opener);
  b.already_answered.forEach((a) => (a.answer = strip(a.answer)));
  // keep cited ids complete
  b.cited_signal_ids = [...new Set(cited.filter((id) => ids.has(id)))];
  return { ok: errors.length === 0, errors, brief: errors.length ? null : b };
}

export type BriefOutcome =
  | { status: "ok"; brief: Brief; attempts: number }
  | { status: "invalid"; errors: string[]; attempts: number }
  | { status: "quota"; attempts: number }
  | { status: "error"; error: string; attempts: number };

/** One Gemini call; on validation failure retry once with the errors appended. */
export async function generateBrief(args: {
  gemini: GeminiCall;
  profile: ProductProfile;
  dict: DictEntry[];
  sigs: BriefSignal[];
  computed: Computed;
  events: ChangeEvent[];
  unverified: string[];
  onCall?: (r: { inputTokens: number; outputTokens: number; model: string; status: string }) => Promise<void>;
}): Promise<BriefOutcome> {
  const base = buildBriefPrompt(args.profile, args.sigs, args.computed, args.events, args.unverified);
  let prompt = base;
  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await args.gemini({ system: BRIEF_SYSTEM, prompt, schema: BRIEF_JSON_SCHEMA, task: "brief" });
    } catch (e) {
      if (e instanceof GeminiQuotaError) {
        await args.onCall?.({ inputTokens: 0, outputTokens: 0, model: "", status: "quota" });
        return { status: "quota", attempts: attempt };
      }
      await args.onCall?.({ inputTokens: 0, outputTokens: 0, model: "", status: "error" });
      return { status: "error", error: e instanceof Error ? e.message.slice(0, 200) : String(e), attempts: attempt };
    }
    const v = validateBrief(res.text, args.sigs, args.dict);
    await args.onCall?.({ inputTokens: res.inputTokens, outputTokens: res.outputTokens, model: res.model, status: v.ok ? "ok" : "invalid" });
    if (v.ok && v.brief) return { status: "ok", brief: v.brief, attempts: attempt };
    lastErrors = v.errors;
    prompt = `${base}\n\nYOUR PREVIOUS ANSWER WAS REJECTED BY THE VALIDATOR. Fix these problems and answer again:\n- ${v.errors.join("\n- ")}`;
  }
  return { status: "invalid", errors: lastErrors, attempts: 2 };
}

// ---------- blog extraction ----------
export const BLOG_JSON_SCHEMA = {
  type: "object",
  properties: {
    topic: { type: "string" },
    tech_mentions: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, quote: { type: "string" } }, required: ["name", "quote"] },
    },
  },
  required: ["topic", "tech_mentions"],
} as const;

export const BLOG_SYSTEM = `Extract technology mentions from an engineering blog post.
Return the post topic in under 12 words, and every programming language, framework, cloud, infrastructure, CI, test framework, database or observability tool the company itself uses or evaluates.
For each mention, "quote" must be copied EXACTLY, character for character, from the text (one sentence or clause, under 200 characters) and must contain the technology name.
Do not include technologies only mentioned as examples of what others use. Do not invent quotes.`;
