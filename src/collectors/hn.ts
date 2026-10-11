import type { Collector, CollectorResult, Signal } from "@/lib/types";
import { fetchJson } from "@/lib/http";
import { hostnameOf, sameSite } from "@/lib/text";

interface HnHit {
  objectID: string;
  title: string;
  url: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string;
}

export const hnCollector: Collector = {
  name: "hn",
  step: "Reading blog",
  timeoutMs: 20_000,
  async collect(ctx): Promise<CollectorResult> {
    const domains = new Set([ctx.company.domain.toLowerCase()]);
    const blogHost = ctx.company.blogFeedUrl && ctx.company.blogFeedUrl !== "none" ? hostnameOf(ctx.company.blogFeedUrl) : null;
    if (blogHost) domains.add(blogHost);
    const since = Math.floor(ctx.now.getTime() / 1000) - 365 * 86400;
    const signals: Signal[] = [];
    const seen = new Set<string>();
    for (const d of domains) {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(d)}&tags=story&restrictSearchableAttributes=url&numericFilters=created_at_i>${since}&hitsPerPage=50`;
      const { data } = await fetchJson<{ hits: HnHit[] }>(url, { fetchImpl: ctx.fetch, timeoutMs: 10000 });
      for (const h of data?.hits ?? []) {
        if (!h.url || seen.has(h.objectID)) continue;
        const host = hostnameOf(h.url);
        if (!host || ![...domains].some((x) => sameSite(host, x))) continue;
        seen.add(h.objectID);
        signals.push({
          source: "hn",
          kind: "hn_story",
          name: h.title,
          detail: { points: h.points ?? 0, comments: h.num_comments ?? 0, story_url: h.url, hn_url: `https://news.ycombinator.com/item?id=${h.objectID}` },
          evidenceUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
          observedAt: new Date(h.created_at).toISOString(),
        });
      }
    }
    signals.sort((a, b) => Number(b.detail.points) - Number(a.detail.points));
    return { signals: signals.slice(0, 15), checked: [`Hacker News stories linking to ${[...domains].join(", ")} (12 months)`] };
  },
};
