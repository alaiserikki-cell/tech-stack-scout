import type { Collector, CollectorResult, DictEntry, Signal } from "@/lib/types";
import { fetchJson } from "@/lib/http";
import { boundaryRegex, escapeRegex, hostnameOf, sameSite } from "@/lib/text";
import { matchText } from "@/lib/dictionary";

/**
 * Developer conference talks, found without any API key: Hacker News (Algolia) stories that link to a
 * talk host (YouTube, Vimeo, InfoQ, SpeakerDeck, ...) and name the company in an engineering context.
 */
export const TALK_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "infoq.com", "speakerdeck.com", "slideshare.net", "gotopia.tech", "media.ccc.de", "usenix.org"];

export interface HnHit {
  objectID: string;
  title: string;
  url: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string;
}

export function isTalkUrl(url: string | null): boolean {
  if (!url) return false;
  const host = hostnameOf(url);
  return Boolean(host && TALK_HOSTS.some((h) => sameSite(host, h)));
}

/** Engineering topics; used only together with a technology match (generic words alone are too noisy). */
const ENG_TOPICS = /\b(scal(e|ed|es|ing)|architecture|infrastructure|platform|migrat\w*|ci|testing|deploy\w*|microservices?|monorepo|observability|reliability|incident|rewrit\w*|performance)\b/i;

export function talkTechMatches(title: string, dict: DictEntry[]) {
  return matchText(title, dict).filter((m) => m.entry.category !== "pattern");
}

/**
 * The company must be the subject or owner of the talk: "at Stripe", "by Linear", "Stripe's ...",
 * "GitLab scaled/built/migrated ...", "Vercel engineering ...".
 */
export function companyOwnsTalk(title: string, companyName: string): boolean {
  const n = escapeRegex(companyName.trim());
  const re = new RegExp(
    `(?<![a-z0-9])(at|@|inside|by)\\s+${n}(?![a-z0-9])|(?<![a-z0-9])${n}('|’)s\\s|(?<![a-z0-9])${n}\\s+(engineering|eng|engineers|team|scaled|scales|built|builds|migrated|moved|rebuilt|runs)\\b`,
    "i",
  );
  return re.test(title);
}

/** A hit counts as a talk by/about the company when it links to a talk host and the company owns it, or it pairs the company with a technology and an engineering topic. */
export function selectTalks(hits: HnHit[], companyName: string, dict?: DictEntry[]): HnHit[] {
  const seen = new Set<string>();
  const named = boundaryRegex(companyName.trim().toLowerCase());
  return hits.filter((h) => {
    if (!isTalkUrl(h.url) || seen.has(h.url!) || !named.test(h.title)) return false;
    const techTalk = dict ? talkTechMatches(h.title, dict).length > 0 && ENG_TOPICS.test(h.title) : false;
    if (!companyOwnsTalk(h.title, companyName) && !techTalk) return false;
    seen.add(h.url!);
    return true;
  });
}

export const talksCollector: Collector = {
  name: "talks",
  step: "Reading blog",
  timeoutMs: 30_000,
  async collect(ctx): Promise<CollectorResult> {
    const name = ctx.company.companyName;
    const since = Math.floor(ctx.now.getTime() / 1000) - 3 * 365 * 86400;
    // several phrasings raise recall: talk URLs rarely contain the company name
    const hits: HnHit[] = [];
    for (const q of [name, `${name} talk`, `${name} conference`, `${name} youtube`, `${name} infoq`, `${name} video`]) {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=100`;
      const { data } = await fetchJson<{ hits: HnHit[] }>(url, { fetchImpl: ctx.fetch, timeoutMs: 8000, retries: 1 }).catch(() => ({ data: null }));
      hits.push(...(data?.hits ?? []));
    }
    const talks = selectTalks(hits, name, ctx.dict)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 8);
    const signals: Signal[] = [];
    for (const t of talks) {
      const observedAt = new Date(t.created_at).toISOString();
      signals.push({
        source: "talks",
        kind: "talk",
        name: t.title,
        detail: { host: hostnameOf(t.url!), talk_url: t.url, hn_url: `https://news.ycombinator.com/item?id=${t.objectID}`, points: t.points ?? 0 },
        evidenceUrl: t.url,
        observedAt,
      });
      for (const m of talkTechMatches(t.title, ctx.dict)) {
        signals.push({
          source: "talks",
          kind: "tech",
          name: m.entry.canonical_name,
          detail: { category: m.entry.category, talk_title: t.title },
          evidenceUrl: t.url,
          observedAt,
        });
      }
    }
    return { signals, checked: [`Conference talks (YouTube, Vimeo, InfoQ, SpeakerDeck…) naming "${name}" via Hacker News, last 3 years`] };
  },
};
