import { onDomain, proveOwnership } from "@/lib/ownership";
import type { Collector, CollectorContext, CollectorResult, Signal, CompanyUpdates } from "@/lib/types";
import { fetchRetry, HttpError } from "@/lib/http";
import { matchFiles, matchDependencies, detectCompetitors } from "@/lib/dictionary";

const API = "https://api.github.com";
const DAY = 86_400_000;

export interface RepoInfo {
  name: string;
  full_name: string;
  html_url: string;
  fork: boolean;
  archived: boolean;
  pushed_at: string;
  created_at: string;
  default_branch: string;
  language: string | null;
}

export class GitHubRateLimitError extends Error {}

/** GitHub GET with token, ETag revalidation (304s are free) and rate-limit awareness. */
export async function gh<T>(ctx: CollectorContext, path: string): Promise<T | null> {
  const url = path.startsWith("http") ? path : API + path;
  const cached = await ctx.cache.get(url);
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (ctx.env.GITHUB_TOKEN) headers.authorization = `Bearer ${ctx.env.GITHUB_TOKEN}`;
  if (cached?.etag) headers["if-none-match"] = cached.etag;
  const res = await fetchRetry(url, { headers, fetchImpl: ctx.fetch, timeoutMs: 15000, retries: 2 });
  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? "1000");
  if (res.status === 304 && cached) return cached.body as T;
  if (res.status === 403 || res.status === 429) {
    if (remaining === 0 || res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      throw new GitHubRateLimitError(`GitHub rate limit reached${reset ? `, resets ${new Date(reset).toISOString()}` : ""}`);
    }
    throw new HttpError(403, url, "GitHub returned 403 (forbidden)");
  }
  if (res.status === 404 || res.status === 409 || res.status === 410) return null;
  if (!res.ok) throw new HttpError(res.status, url);
  const body = (await res.json()) as T;
  if (remaining < 20) throw new GitHubRateLimitError("GitHub rate limit nearly exhausted; stopping early");
  const etag = res.headers.get("etag");
  const size = JSON.stringify(body).length;
  if (etag && size < 300_000) await ctx.cache.set(url, etag, body);
  return body;
}

// ---------- pure helpers (unit tested) ----------

/** Sum bytes per language across repos and convert to percentages. */
export function aggregateLanguages(maps: Record<string, number>[]): { name: string; bytes: number; pct: number }[] {
  const total: Record<string, number> = {};
  for (const m of maps) for (const [k, v] of Object.entries(m)) total[k] = (total[k] ?? 0) + v;
  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  if (!sum) return [];
  return Object.entries(total)
    .map(([name, bytes]) => ({ name, bytes, pct: Math.round((bytes / sum) * 1000) / 10 }))
    .sort((a, b) => b.bytes - a.bytes);
}

const SDK_RE = /(sdk|client|^api-|-api$|-python$|-node$|-nodejs$|-go$|-golang$|-java$|-ruby$|-php$|-dotnet$|-js$|-swift$|-android$|-ios$)/i;
export function looksLikeClientLibrary(repoName: string): boolean {
  return SDK_RE.test(repoName);
}
/** sdk_heavy when more than half of the top repos look like client libraries. */
export function isSdkHeavy(repoNames: string[]): boolean {
  if (repoNames.length < 3) return false;
  const n = repoNames.filter(looksLikeClientLibrary).length;
  return n > repoNames.length / 2;
}

export const MANIFESTS = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "Gemfile",
];

/** Extract dependency names from a manifest file. */
export function parseManifest(file: string, content: string): string[] {
  const base = file.split("/").pop()!;
  const out = new Set<string>();
  try {
    if (base === "package.json") {
      const j = JSON.parse(content);
      for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])
        for (const n of Object.keys(j[k] ?? {})) out.add(n);
    } else if (base === "requirements.txt") {
      for (const line of content.split(/\r?\n/)) {
        const m = line.trim().match(/^([A-Za-z0-9_.-]+)/);
        if (m && !line.trim().startsWith("#") && !line.trim().startsWith("-")) out.add(m[1].toLowerCase());
      }
    } else if (base === "pyproject.toml") {
      for (const m of content.matchAll(/["']([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*(?:[<>=~!^;@][^"']*)?["']/g)) out.add(m[1].toLowerCase());
      let inDeps = false;
      for (const line of content.split(/\r?\n/)) {
        if (/^\s*\[/.test(line)) inDeps = /dependencies/i.test(line);
        else if (inDeps) {
          const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/);
          if (m && m[1] !== "python") out.add(m[1].toLowerCase());
        }
      }
    } else if (base === "go.mod") {
      for (const m of content.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v[\d.]+/gim)) out.add(m[1]);
    } else if (base === "pom.xml") {
      for (const m of content.matchAll(/<groupId>\s*([^<\s]+)\s*<\/groupId>\s*<artifactId>\s*([^<\s]+)\s*<\/artifactId>/g)) {
        out.add(m[1]);
        out.add(`${m[1]}:${m[2]}`);
        out.add(m[2]);
      }
    } else if (base.startsWith("build.gradle") || base.startsWith("settings.gradle")) {
      for (const m of content.matchAll(/["']([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::[^"']*)?["']/g)) {
        out.add(m[1]);
        out.add(`${m[1]}:${m[2]}`);
        out.add(m[2]);
      }
      for (const m of content.matchAll(/id\s*\(?\s*["']([A-Za-z0-9_.-]+)["']/g)) out.add(m[1]);
    } else if (base === "Gemfile") {
      for (const m of content.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) out.add(m[1]);
    }
  } catch {
    /* malformed manifest: ignore */
  }
  return [...out];
}

export function normalizeOrgCandidate(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

// ---------- org discovery ----------

/** Proof that a GitHub org belongs to the company: its profile website is on the company's domain. */
export function orgWebsiteMatches(blog: string | null | undefined, domain: string): boolean {
  if (!blog) return false;
  const url = /^https?:\/\//i.test(blog) ? blog : `https://${blog}`;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const d = domain.toLowerCase().replace(/^www\./, "");
    return host === d || host.endsWith(`.${d}`);
  } catch {
    return false;
  }
}

/** Example apps, fixtures, vendored and third-party code show what a repo demonstrates, not what the company runs. */
const SAMPLE_DIR = /(^|\/)(examples?|samples?|demos?|fixtures?|test[-_]?data|testdata|__fixtures__|vendor|third[-_]party|node_modules|docs?|playground|templates?|starters?|boilerplates?)\//i;
export function isSampleCode(path: string): boolean {
  return SAMPLE_DIR.test(path);
}

/**
 * The org's website proves the org belongs to the company, using the shared ownership rule: same domain, a redirect
 * (Goldman Sachs' org lists gs.com, which redirects to goldmansachs.com), or a brand domain that links back
 * (Zerodha's org lists zerodha.tech, which links to zerodha.com).
 */
export async function orgWebsiteProves(blog: string | null | undefined, domain: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!blog) return false;
  const url = /^https?:\/\//i.test(blog) ? blog : `https://${blog}`;
  if (orgWebsiteMatches(url, domain)) return true;
  try {
    const r = await fetchImpl(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (FlakeGuard org check)" }, signal: AbortSignal.timeout(8000) });
    if (onDomain(r.url || url, domain)) return true;
  } catch {
    /* fall through to the brand rule */
  }
  return (await proveOwnership(url, { domain }, { fetchImpl })).owned;
}

async function guessOrg(ctx: CollectorContext, checked: string[]): Promise<{ login: string; proven: boolean } | null> {
  const { companyName, domain } = ctx.company;
  const stem = domain.split(".")[0];
  const candidates = new Set<string>([
    normalizeOrgCandidate(stem),
    normalizeOrgCandidate(companyName.replace(/\s+/g, "")),
    normalizeOrgCandidate(companyName.replace(/\s+/g, "-")),
  ]);
  const search = await gh<{ items: { login: string; type: string }[] }>(
    ctx,
    `/search/users?q=${encodeURIComponent(`${companyName} type:org`)}&per_page=5`,
  ).catch(() => null);
  for (const it of search?.items ?? []) candidates.add(it.login);
  checked.push(`GitHub org search for "${companyName}" and "${stem}"`);
  let weak: { login: string; proven: boolean } | null = null;
  for (const login of candidates) {
    if (!login) continue;
    const org = await gh<{ login: string; blog: string | null; public_repos: number; type?: string }>(ctx, `/orgs/${login}`).catch(() => null);
    if (!org) continue;
    const blog = (org.blog ?? "").toLowerCase();
    if (await orgWebsiteProves(org.blog, domain)) return { login: org.login, proven: true }; // org website is (or redirects to) the company's domain
    if (!weak && org.login.toLowerCase() === normalizeOrgCandidate(stem) && org.public_repos > 0) weak = { login: org.login, proven: false };
  }
  return weak;
}

// ---------- collector ----------

export const githubCollector: Collector = {
  name: "github",
  step: "Reading GitHub",
  timeoutMs: 90_000,
  async collect(ctx): Promise<CollectorResult> {
    const checked: string[] = [];
    const updates: CompanyUpdates = {};
    const signals: Signal[] = [];
    try {
      return await collectGithub(ctx, checked, updates, signals);
    } catch (e) {
      // keep whatever was collected before GitHub rate-limited us
      if (e instanceof GitHubRateLimitError && signals.length) return { signals, checked, updates, error: e.message };
      throw e;
    }
  },
};

async function collectGithub(ctx: CollectorContext, checked: string[], updates: CompanyUpdates, signals: Signal[]): Promise<CollectorResult> {
    const now = ctx.now;
    const nowIso = now.toISOString();

    let org = ctx.company.githubOrg;
    if (!org) {
      const guess = await guessOrg(ctx, checked);
      org = guess?.login ?? null;
      if (!org) {
        checked.push("No public GitHub organization found");
        return { signals, checked };
      }
      updates.githubOrg = org;
      updates.githubOrgVerified = Boolean(guess?.proven);
      checked.push(guess?.proven ? `GitHub org ${org}: verified (its website belongs to ${ctx.company.domain})` : `GitHub org ${org}: unverified (name match only)`);
    }
    const orgUrl = `https://github.com/${org}`;
    const orgInfo = await gh<{ public_repos: number; login: string; blog?: string | null }>(ctx, `/orgs/${org}`);
    // an org set earlier but never verified gets verified once its website proves the link
    if (orgInfo && !ctx.company.githubOrgVerified && updates.githubOrgVerified !== true && (await orgWebsiteProves(orgInfo.blog, ctx.company.domain))) updates.githubOrgVerified = true;
    if (orgInfo?.blog && (ctx.company.githubOrgVerified || updates.githubOrgVerified)) ctx.hints = { ...ctx.hints, orgWebsite: orgInfo.blog };
    const userInfo = orgInfo ? null : await gh<{ public_repos: number; login: string }>(ctx, `/users/${org}`);
    const owner = orgInfo ?? userInfo;
    checked.push(`GitHub ${orgUrl}`);
    if (!owner) {
      checked.push(`GitHub account ${org} not found`);
      return { signals, checked, updates };
    }
    const base = orgInfo ? `/orgs/${org}/repos` : `/users/${org}/repos`;

    // repos by pushed date, excluding forks and archived; page until older than 90 days
    const repos: RepoInfo[] = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await gh<RepoInfo[]>(ctx, `${base}?sort=pushed&direction=desc&per_page=100&page=${page}&type=public`);
      if (!batch?.length) break;
      repos.push(...batch);
      const last = batch[batch.length - 1];
      if (batch.length < 100 || now.getTime() - Date.parse(last.pushed_at) > 90 * DAY) break;
    }
    const live = repos.filter((r) => !r.fork && !r.archived);
    const top10 = live.slice(0, 10);
    const top5 = live.slice(0, 5);

    signals.push({
      source: "github",
      kind: "org",
      name: org,
      detail: { public_repos: owner.public_repos, verified: ctx.company.githubOrgVerified && !updates.githubOrg },
      evidenceUrl: orgUrl,
      observedAt: nowIso,
    });

    // activity
    const pushed30 = live.filter((r) => now.getTime() - Date.parse(r.pushed_at) <= 30 * DAY).length;
    const pushed90 = live.filter((r) => now.getTime() - Date.parse(r.pushed_at) <= 90 * DAY).length;
    const created90 = live.filter((r) => now.getTime() - Date.parse(r.created_at) <= 90 * DAY).length;
    const sdkHeavy = isSdkHeavy(top10.map((r) => r.name));
    signals.push({
      source: "github",
      kind: "activity",
      name: "repo_activity",
      detail: {
        pushed_30d: pushed30,
        pushed_90d: pushed90,
        created_90d: created90,
        total_public_repos: owner.public_repos,
        top_repos: top10.map((r) => r.name),
        sdk_heavy: sdkHeavy,
        sdk_like_repos: top10.filter((r) => looksLikeClientLibrary(r.name)).map((r) => r.name),
      },
      evidenceUrl: `${orgUrl}?q=&type=all&sort=updated`,
      observedAt: nowIso,
    });

    // languages over the 10 most recently pushed repos
    const langMaps: Record<string, number>[] = [];
    for (const r of top10) {
      const l = await gh<Record<string, number>>(ctx, `/repos/${r.full_name}/languages`);
      if (l) langMaps.push(l);
    }
    for (const l of aggregateLanguages(langMaps)) {
      if (l.pct < 1) continue;
      signals.push({
        source: "github",
        kind: "language",
        name: l.name,
        detail: { bytes: l.bytes, pct: l.pct, repos_considered: top10.length },
        evidenceUrl: `${orgUrl}?language=${encodeURIComponent(l.name.toLowerCase())}`,
        observedAt: nowIso,
      });
    }

    // CI / infra via file trees of the 5 most recently pushed repos; manifests for dependencies
    const techSeen = new Map<string, Signal>();
    const depList: { name: string; where: string }[] = [];
    const texts: { text: string; where: string }[] = [];
    for (const r of top5) {
      const tree = await gh<{ tree: { path: string; type: string }[]; truncated: boolean }>(
        ctx,
        `/repos/${r.full_name}/git/trees/${encodeURIComponent(r.default_branch)}?recursive=1`,
      );
      if (!tree) continue;
      const paths = tree.tree.filter((t) => t.type === "blob" && !isSampleCode(t.path)).map((t) => t.path);
      for (const m of matchFiles(paths, ctx.dict)) {
        if (techSeen.has(m.entry.canonical_name)) continue;
        const s: Signal = {
          source: "github",
          kind: "tech",
          name: m.entry.canonical_name,
          detail: { category: m.entry.category, via: "file", repo: r.name, path: m.path },
          evidenceUrl: `${r.html_url}/blob/${r.default_branch}/${m.path}`,
          observedAt: nowIso,
        };
        techSeen.set(m.entry.canonical_name, s);
      }
      const rootManifests = paths.filter((p) => MANIFESTS.includes(p));
      const workflows = paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).slice(0, 3);
      for (const p of [...rootManifests, ...workflows]) {
        const file = await gh<{ content?: string; encoding?: string }>(ctx, `/repos/${r.full_name}/contents/${p}?ref=${encodeURIComponent(r.default_branch)}`);
        if (!file?.content) continue;
        const content = Buffer.from(file.content, (file.encoding as BufferEncoding) ?? "base64").toString("utf8");
        const where = `${r.html_url}/blob/${r.default_branch}/${p}`;
        texts.push({ text: content, where });
        if (!workflows.includes(p)) for (const d of parseManifest(p, content)) depList.push({ name: d, where });
      }
    }
    for (const m of matchDependencies(
      depList.map((d) => d.name),
      ctx.dict,
    )) {
      if (techSeen.has(m.entry.canonical_name)) continue;
      const where = depList.find((d) => d.name === m.dep)!.where;
      techSeen.set(m.entry.canonical_name, {
        source: "github",
        kind: "tech",
        name: m.entry.canonical_name,
        detail: { category: m.entry.category, via: "dependency", dependency: m.dep, repo: where.split("/")[4] },
        evidenceUrl: where,
        observedAt: nowIso,
      });
    }
    signals.push(...techSeen.values());

    for (const c of detectCompetitors(ctx.profile.competitors_and_adjacent, depList, texts)) {
      signals.push({
        source: "github",
        kind: "competitor",
        name: c.competitor,
        detail: { match: c.match },
        evidenceUrl: c.where,
        observedAt: nowIso,
      });
    }
    checked.push(`${top10.length} most recently pushed repos (languages), ${top5.length} file trees, ${texts.length} config files`);
    return { signals, checked, updates };
}
