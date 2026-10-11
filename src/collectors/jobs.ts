import type { Collector, CollectorContext, CollectorResult, CompanyUpdates, DictEntry, RequirementLevel, Signal } from "@/lib/types";
import { fetchJson } from "@/lib/http";
import { htmlToLines, splitSentences, type TextLine } from "@/lib/text";
import { matchText } from "@/lib/dictionary";

export interface JobPost {
  id: string;
  title: string;
  url: string;
  department: string | null;
  location: string | null;
  postedAt: string | null;
  lines: TextLine[];
}

type Provider = "greenhouse" | "lever" | "ashby";

// ---------- provider adapters ----------

async function fetchGreenhouse(ctx: CollectorContext, slug: string): Promise<JobPost[] | null> {
  const { status, data } = await fetchJson<{ jobs: any[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
    { fetchImpl: ctx.fetch, timeoutMs: 25000 },
  );
  if (status !== 200 || !data?.jobs) return null;
  return data.jobs.map((j) => ({
    id: String(j.id),
    title: j.title,
    url: j.absolute_url,
    department: j.departments?.[0]?.name ?? null,
    location: j.location?.name ?? null,
    postedAt: j.first_published ?? j.updated_at ?? null,
    lines: htmlToLines(j.content ?? ""),
  }));
}

async function fetchLever(ctx: CollectorContext, slug: string): Promise<JobPost[] | null> {
  const { status, data } = await fetchJson<any[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`, {
    fetchImpl: ctx.fetch,
    timeoutMs: 25000,
  });
  if (status !== 200 || !Array.isArray(data)) return null;
  return data.map((j) => {
    const lines: TextLine[] = [...htmlToLines(j.description ?? j.descriptionPlain ?? "")];
    for (const l of j.lists ?? []) {
      lines.push({ text: String(l.text ?? ""), heading: true });
      lines.push(...htmlToLines(l.content ?? ""));
    }
    lines.push(...htmlToLines(j.additional ?? ""));
    return {
      id: j.id,
      title: j.text,
      url: j.hostedUrl,
      department: j.categories?.department ?? j.categories?.team ?? null,
      location: j.categories?.location ?? null,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      lines,
    };
  });
}

async function fetchAshby(ctx: CollectorContext, slug: string): Promise<JobPost[] | null> {
  const { status, data } = await fetchJson<{ jobs: any[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=false`,
    { fetchImpl: ctx.fetch, timeoutMs: 25000 },
  );
  if (status !== 200 || !data?.jobs) return null;
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      id: j.id,
      title: j.title,
      url: j.jobUrl,
      department: j.department ?? j.team ?? null,
      location: j.location ?? null,
      postedAt: j.publishedAt ?? null,
      lines: htmlToLines(j.descriptionHtml ?? ""),
    }));
}

const ADAPTERS: Record<Provider, (ctx: CollectorContext, slug: string) => Promise<JobPost[] | null>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
};

export const boardUrl = (p: string, slug: string) =>
  p === "greenhouse"
    ? `https://boards.greenhouse.io/${slug}`
    : p === "lever"
      ? `https://jobs.lever.co/${slug}`
      : `https://jobs.ashbyhq.com/${slug}`;

export function slugCandidates(name: string, domain: string): string[] {
  const n = name.toLowerCase();
  const stem = domain.toLowerCase().split(".")[0];
  return [...new Set([n.replace(/[^a-z0-9]/g, ""), n.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), stem, stem.replace(/-/g, "")])].filter(Boolean);
}

// ---------- pure helpers (unit tested) ----------

const ENG_RE = /\b(engineer|engineering|developer|sre|site reliability|platform|devops|infrastructure|qa|quality assurance|test|sdet|data|machine learning|ml|architect|programmer)\b/i;
const NON_ENG_RE = /\b(sales engineer|solutions engineer|account|recruit|marketing|legal|counsel|finance|designer)\b/i;
export function isEngineeringRole(title: string): boolean {
  return ENG_RE.test(title) && !NON_ENG_RE.test(title);
}

const NICE_RE = /(nice[- ]to[- ]have|bonus|preferred|good to have|pluses|plus if|extra credit|it'?s a plus|would be great|desirable)/i;
const REQ_RE = /(requirement|must[- ]have|you have|qualifications|what you bring|you'?ll need|what we'?re looking for|about you|skills|experience)/i;

export function sectionLevel(heading: string): RequirementLevel | null {
  if (NICE_RE.test(heading)) return "nice_to_have";
  if (REQ_RE.test(heading)) return "requirement";
  return null;
}

export interface JobTechMatch {
  entry: DictEntry;
  level: RequirementLevel;
  line: string;
}

/** Match dictionary aliases in a job post, tagging each from the section heading it sits under (default requirement). */
export function matchJobTech(lines: TextLine[], dict: DictEntry[]): JobTechMatch[] {
  const found = new Map<string, JobTechMatch>();
  let level: RequirementLevel = "requirement";
  for (const l of lines) {
    if (l.heading) {
      level = sectionLevel(l.text) ?? "requirement";
      // inline "Bonus: Kafka" style headings also carry tech
      if (l.text.length > 40) continue;
    }
    const inlineNice = !l.heading && /^(-\s*)?(bonus|nice to have|preferred|a plus)\b/i.test(l.text);
    const lineLevel: RequirementLevel = inlineNice || /\b(is a plus|are a plus|a bonus|nice to have|preferred)\b/i.test(l.text) ? "nice_to_have" : level;
    for (const m of matchText(l.text, dict)) {
      const prev = found.get(m.entry.canonical_name);
      if (!prev || (prev.level === "nice_to_have" && lineLevel === "requirement"))
        found.set(m.entry.canonical_name, { entry: m.entry, level: lineLevel, line: l.text });
    }
  }
  return [...found.values()];
}

const INITIATIVES: { label: string; re: RegExp }[] = [
  { label: "Migration", re: /\bmigrat(?:e|es|ing|ion)\s+(?:\w+\s+){0,4}?from\s+[\w .#+/-]{2,40}?\s+to\s+[\w .#+/-]{2,40}/i },
  { label: "Migration", re: /\bmoving\s+(?:\w+\s+){0,3}?(?:from\s+[\w .#+/-]{2,40}?\s+)?to\s+(?:a\s+|the\s+)?[\w .#+/-]{2,40}/i },
  { label: "Re-architecture", re: /\bre-?architect(?:ing|ure)?\b/i },
  { label: "Monolith breakup", re: /\b(?:break(?:ing)?|split(?:ting)?)\s+(?:up|apart|down)?\s*(?:the|our|a)\s+monolith|\bmonolith\s+(?:to|into)\s+(?:micro)?services/i },
  { label: "Platform team", re: /\b(?:build(?:ing)?|grow(?:ing)?|form(?:ing)?|scal(?:e|ing))\s+(?:out\s+)?(?:a|our|the|its)\s+(?:new\s+)?(?:developer\s+)?platform\s+(?:engineering\s+)?team/i },
  { label: "CI reliability", re: /\b(?:improv\w*|increas\w*)\s+(?:the\s+)?(?:ci|ci\/cd|build|pipeline)\s+reliability|\bflaky\s+tests?\b/i },
  { label: "Build times", re: /\b(?:reduc\w*|cut\w*|improv\w*|speed\w*\s+up|faster)\s+(?:our\s+|the\s+)?(?:ci\s+|build|compile)\w*\s*(?:and\s+test\s+)?times?\b|\bbuild\s+times?\b/i },
  { label: "Test infrastructure", re: /\btest(?:ing)?\s+infrastructure\b|\btest\s+infra\b/i },
  { label: "Developer productivity", re: /\bdeveloper\s+(?:productivity|experience)\b|\bengineering\s+productivity\b/i },
];

export interface InitiativeMatch {
  label: string;
  sentence: string;
}

export function detectInitiatives(text: string): InitiativeMatch[] {
  const out: InitiativeMatch[] = [];
  const seen = new Set<string>();
  for (const s of splitSentences(text)) {
    if (s.length > 400) continue;
    for (const p of INITIATIVES) {
      if (p.re.test(s)) {
        const key = p.label + "|" + s;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ label: p.label, sentence: s });
        }
        break;
      }
    }
  }
  return out;
}

// ---------- collector ----------

export const jobsCollector: Collector = {
  name: "jobs",
  step: "Reading job posts",
  timeoutMs: 60_000,
  async collect(ctx): Promise<CollectorResult> {
    const checked: string[] = [];
    const updates: CompanyUpdates = {};
    const signals: Signal[] = [];
    let provider = ctx.company.atsProvider as Provider | "none" | null;
    let slug = ctx.company.atsSlug;
    let posts: JobPost[] | null = null;

    if (provider === "none") {
      checked.push("No public job board (marked none)");
      return { signals, checked };
    }
    if (provider && slug && provider in ADAPTERS) {
      posts = await ADAPTERS[provider as Provider](ctx, slug);
      checked.push(`${provider} board "${slug}"`);
    } else {
      for (const s of slugCandidates(ctx.company.companyName, ctx.company.domain)) {
        for (const p of ["greenhouse", "lever", "ashby"] as Provider[]) {
          checked.push(`${p}/${s}`);
          const r = await ADAPTERS[p](ctx, s).catch(() => null);
          if (r) {
            posts = r;
            provider = p;
            slug = s;
            updates.atsProvider = p;
            updates.atsSlug = s;
            updates.atsVerified = false;
            break;
          }
        }
        if (posts) break;
      }
    }
    if (!posts || !provider || !slug) {
      checked.push("No public Greenhouse, Lever or Ashby board found");
      return { signals, checked, updates };
    }

    const nowIso = ctx.now.toISOString();
    const eng = posts.filter((p) => isEngineeringRole(p.title));
    signals.push({
      source: "jobs",
      kind: "job_count",
      name: "engineering_jobs",
      detail: { engineering: eng.length, total: posts.length, provider, slug },
      evidenceUrl: boardUrl(provider, slug),
      observedAt: nowIso,
    });
    // Sentences repeated across most postings are company boilerplate, not initiatives.
    const sample = eng.slice(0, 60);
    const perPost = sample.map((p) => detectInitiatives(p.lines.map((l) => l.text).join("\n")));
    const freq = new Map<string, number>();
    for (const list of perPost) for (const s of new Set(list.map((i) => i.sentence))) freq.set(s, (freq.get(s) ?? 0) + 1);
    const boilerplate = (s: string) => sample.length >= 4 && (freq.get(s) ?? 0) > Math.max(2, sample.length / 2);
    const seenInitiatives = new Set<string>();
    for (const [idx, p] of sample.entries()) {
      const observedAt = p.postedAt && !Number.isNaN(Date.parse(p.postedAt)) ? new Date(p.postedAt).toISOString() : nowIso;
      signals.push({
        source: "jobs",
        kind: "job_post",
        name: p.title,
        detail: { department: p.department, location: p.location },
        evidenceUrl: p.url,
        observedAt,
      });
      for (const m of matchJobTech(p.lines, ctx.dict)) {
        signals.push({
          source: "jobs",
          kind: "tech",
          name: m.entry.canonical_name,
          detail: { category: m.entry.category, job_title: p.title, line: m.line.slice(0, 240) },
          requirementLevel: m.level,
          evidenceUrl: p.url,
          observedAt,
        });
      }
      for (const i of perPost[idx]) {
        if (boilerplate(i.sentence) || seenInitiatives.has(i.label + i.sentence)) continue;
        seenInitiatives.add(i.label + i.sentence);
        signals.push({
          source: "jobs",
          kind: "initiative",
          name: i.label,
          detail: { sentence: i.sentence.slice(0, 400), job_title: p.title },
          evidenceUrl: p.url,
          observedAt,
        });
      }
    }
    checked.push(`${posts.length} postings, ${eng.length} engineering`);
    return { signals, checked, updates };
  },
};
