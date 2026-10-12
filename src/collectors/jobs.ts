import type { Collector, CollectorContext, CollectorResult, CompanyUpdates, DictEntry, RequirementLevel, Signal } from "@/lib/types";
import { fetchJson, fetchText } from "@/lib/http";
import { carriesBrand, extractLinks, onDomain } from "@/lib/ownership";
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

type Provider = "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters";

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

async function fetchSmartRecruiters(ctx: CollectorContext, slug: string): Promise<JobPost[] | null> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`;
  const { status, data } = await fetchJson<{ content: any[]; totalFound: number }>(`${base}?limit=100`, { fetchImpl: ctx.fetch, timeoutMs: 20000 });
  if (status !== 200 || !data?.content || !data.totalFound) return null;
  const eng = data.content.filter((p) => isEngineeringRole(p.name)).slice(0, 25);
  const out: JobPost[] = [];
  for (const p of eng) {
    const d = await fetchJson<any>(`${base}/${p.id}`, { fetchImpl: ctx.fetch, timeoutMs: 10000, retries: 1 }).catch(() => ({ data: null }));
    const s = d.data?.jobAd?.sections ?? {};
    const lines: TextLine[] = [];
    for (const key of ["jobDescription", "qualifications", "additionalInformation"]) {
      if (!s[key]?.text) continue;
      lines.push({ text: String(s[key].title ?? key), heading: true });
      lines.push(...htmlToLines(s[key].text));
    }
    out.push({ id: p.id, title: p.name, url: `https://jobs.smartrecruiters.com/${slug}/${p.id}`, department: p.department?.label ?? null, location: p.location?.city ?? null, postedAt: p.releasedDate ?? null, lines });
  }
  // keep non-engineering titles too so the job count reflects the board
  for (const p of data.content.filter((p) => !isEngineeringRole(p.name)))
    out.push({ id: p.id, title: p.name, url: `https://jobs.smartrecruiters.com/${slug}/${p.id}`, department: null, location: null, postedAt: p.releasedDate ?? null, lines: [] });
  return out;
}

/** Workday "posted" labels: "Posted Today", "Posted Yesterday", "Posted 5 Days Ago", "Posted 30+ Days Ago". */
export function workdayPostedDate(label: string | undefined, now: Date): string | null {
  if (!label) return null;
  if (/today/i.test(label)) return now.toISOString();
  if (/yesterday/i.test(label)) return new Date(now.getTime() - 86_400_000).toISOString();
  const m = label.match(/(\d+)\+?\s+days?/i);
  return m ? new Date(now.getTime() - Number(m[1]) * 86_400_000).toISOString() : null;
}

/** Workday slug format: "tenant/wdN/site", e.g. "stryker/wd1/StrykerCareers". */
async function fetchWorkday(ctx: CollectorContext, slug: string): Promise<JobPost[] | null> {
  const [tenant, wd, site] = slug.split("/");
  if (!tenant || !wd || !site) return null;
  const host = `https://${tenant}.${wd}.myworkdayjobs.com`;
  const api = `${host}/wday/cxs/${tenant}/${site}`;
  const found = new Map<string, any>();
  let reachable = false;
  for (const q of ["software engineer", "engineer", "developer", "data", "devops"]) {
    const { status, data } = await fetchJson<{ total: number; jobPostings: any[] }>(`${api}/jobs`, {
      fetchImpl: ctx.fetch,
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: q }),
      timeoutMs: 12000,
      retries: 1,
    }).catch(() => ({ status: 0, data: null }));
    if (status !== 200 || !data) continue;
    reachable = true;
    for (const p of data.jobPostings ?? []) if (p.externalPath && !found.has(p.externalPath)) found.set(p.externalPath, p);
  }
  if (!reachable) return null;
  const eng = [...found.values()].filter((p) => isEngineeringRole(p.title)).slice(0, 20);
  const out: JobPost[] = [];
  for (const p of eng) {
    const d = await fetchJson<any>(`${api}${p.externalPath}`, { fetchImpl: ctx.fetch, headers: { accept: "application/json" }, timeoutMs: 10000, retries: 1 }).catch(() => ({ data: null }));
    const info = d.data?.jobPostingInfo;
    out.push({
      id: p.externalPath,
      title: p.title,
      url: info?.externalUrl ?? `${host}/${site}${p.externalPath}`,
      department: null,
      location: p.locationsText ?? info?.location ?? null,
      postedAt: info?.startDate ? new Date(info.startDate).toISOString() : workdayPostedDate(p.postedOn, ctx.now),
      lines: htmlToLines(info?.jobDescription ?? ""),
    });
  }
  return out;
}

/** Find a job board linked from the company's own careers pages (works for any supported provider). */
export function atsFromHtml(html: string): { provider: Provider; slug: string } | null {
  const wd = html.match(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i);
  if (wd && wd[3].toLowerCase() !== "wday") return { provider: "workday", slug: `${wd[1].toLowerCase()}/${wd[2].toLowerCase()}/${wd[3]}` };
  const gh = html.match(/(?:boards|job-boards)(?:-api)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/i);
  if (gh && !["embed", "v1"].includes(gh[1].toLowerCase())) return { provider: "greenhouse", slug: gh[1].toLowerCase() };
  const lv = html.match(/jobs\.lever\.co\/([a-z0-9_.-]+)/i);
  if (lv) return { provider: "lever", slug: lv[1].toLowerCase() };
  const ab = html.match(/jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/i);
  if (ab) return { provider: "ashby", slug: ab[1] };
  const sr = html.match(/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9]+)/i);
  if (sr) return { provider: "smartrecruiters", slug: sr[1] };
  return null;
}

const CAREERS_LINK = /career|\/jobs?\b|\bjobs\.|opening|position|join[-_]?us|hiring|work[-_]with[-_]us|vacanc/i;

/**
 * Find a job board linked from the company's own careers pages (works for any supported provider).
 * Looks at the usual careers URLs, then follows careers-looking links one level deep, including careers sites on
 * another domain that the company links to (flipkart.com -> flipkartcareers.com) or that carry its brand.
 */
async function discoverFromCareersPages(ctx: CollectorContext, checked: string[]): Promise<{ provider: Provider; slug: string } | null> {
  const d = ctx.company.domain;
  const seen = new Set<string>();
  const deeper: string[] = [];
  const visit = async (u: string) => {
    if (seen.has(u)) return null;
    seen.add(u);
    checked.push(u);
    const r = await fetchText(u, { fetchImpl: ctx.fetch, timeoutMs: 8000, retries: 0 }).catch(() => null);
    if (!r?.text) return null;
    const hit = atsFromHtml(r.text);
    if (hit) return hit;
    const fromCompany = onDomain(r.finalUrl || u, d);
    for (const l of extractLinks(r.text, r.finalUrl || u)) {
      if (!CAREERS_LINK.test(l) || seen.has(l)) continue;
      // follow links on the company's domain, links the company itself publishes, and brand-named careers sites
      if (onDomain(l, d) || fromCompany || carriesBrand(new URL(l).hostname, d)) deeper.push(l);
    }
    return null;
  };
  for (const u of [`https://careers.${d}`, `https://${d}/careers`, `https://www.${d}/careers`, `https://jobs.${d}`, `https://${d}/jobs`, `https://${d}/company/careers`, `https://${d}`]) {
    const hit = await visit(u);
    if (hit) return hit;
  }
  for (const u of [...new Set(deeper)].slice(0, 6)) {
    const hit = await visit(u);
    if (hit) return hit;
  }
  return null;
}

const ADAPTERS: Record<Provider, (ctx: CollectorContext, slug: string) => Promise<JobPost[] | null>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workday: fetchWorkday,
  smartrecruiters: fetchSmartRecruiters,
};

export const boardUrl = (p: string, slug: string) => {
  if (p === "greenhouse") return `https://boards.greenhouse.io/${slug}`;
  if (p === "lever") return `https://jobs.lever.co/${slug}`;
  if (p === "smartrecruiters") return `https://jobs.smartrecruiters.com/${slug}`;
  if (p === "workday") {
    const [tenant, wd, site] = slug.split("/");
    return `https://${tenant}.${wd}.myworkdayjobs.com/${site}`;
  }
  return `https://jobs.ashbyhq.com/${slug}`;
};

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
  timeoutMs: 100_000,
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
      // a board found by guessing its slug becomes verified once the company's own careers page links to it
      if (posts && !ctx.company.atsVerified) {
        const linked = await discoverFromCareersPages(ctx, []);
        if (linked && linked.provider === provider && linked.slug.toLowerCase() === slug.toLowerCase()) {
          updates.atsVerified = true;
          checked.push("Board verified: linked from the company's careers page");
        }
      }
    } else {
      const linked = await discoverFromCareersPages(ctx, checked);
      if (linked) {
        const r = await ADAPTERS[linked.provider](ctx, linked.slug).catch(() => null);
        checked.push(`${linked.provider} board "${linked.slug}" linked from the careers page`);
        if (r) {
          posts = r;
          provider = linked.provider;
          slug = linked.slug;
          updates.atsProvider = provider;
          updates.atsSlug = slug;
          updates.atsVerified = true; // linked from the company's own site
        }
      }
    }
    if (!posts && !(ctx.company.atsProvider && ctx.company.atsSlug)) {
      for (const s of slugCandidates(ctx.company.companyName, ctx.company.domain)) {
        for (const p of ["greenhouse", "lever", "ashby", "smartrecruiters"] as Provider[]) {
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
      checked.push("No public Greenhouse, Lever, Ashby, Workday or SmartRecruiters board found");
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
