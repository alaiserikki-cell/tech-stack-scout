import type { BlogExtraction, Collector, CollectorContext, CollectorResult, CompanyUpdates, DictEntry, Signal } from "@/lib/types";
import { fetchText } from "@/lib/http";
import { articleText, decodeEntities, normalizeText, hostnameOf } from "@/lib/text";
import { resolveName, textMentions } from "@/lib/dictionary";

const DAY = 86_400_000;

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
}

/** Find <link rel="alternate" type="application/rss+xml|atom+xml"> in an HTML page. */
export function findFeedLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const u = new URL(decodeEntities(href), pageUrl).toString();
      if (!/comments/i.test(u)) out.push(u);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!m) return null;
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

/** Minimal RSS 2.0 / Atom parser. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const title = tag(b, "title");
    const link = tag(b, "link") ?? tag(b, "guid");
    const date = tag(b, "pubDate") ?? tag(b, "dc:date") ?? tag(b, "published");
    if (title && link) items.push({ title: normalizeText(title), url: link.trim(), publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null });
  }
  if (!blocks.length) {
    for (const m of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
      const b = m[0];
      const title = tag(b, "title");
      const href =
        b.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
        b.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1];
      const date = tag(b, "published") ?? tag(b, "updated");
      if (title && href) items.push({ title: normalizeText(title), url: decodeEntities(href), publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null });
    }
  }
  return items;
}

export interface VerifiedMention {
  entry: DictEntry;
  quote: string;
}

/**
 * Keep a Gemini mention only if: the quote appears verbatim in the text (whitespace/quote-style
 * normalised), the quote contains the name or an alias, and the name resolves to a dictionary entry.
 */
export function verifyMentions(extraction: BlogExtraction, text: string, dict: DictEntry[]): { kept: VerifiedMention[]; rejected: { name: string; reason: string }[] } {
  const kept: VerifiedMention[] = [];
  const rejected: { name: string; reason: string }[] = [];
  const hay = normalizeText(text);
  const seen = new Set<string>();
  for (const m of extraction.tech_mentions ?? []) {
    const entry = resolveName(m.name ?? "", dict);
    const quote = normalizeText(m.quote ?? "");
    if (!entry) {
      rejected.push({ name: m.name, reason: "not in dictionary" });
      continue;
    }
    if (quote.length < 8 || !hay.includes(quote)) {
      rejected.push({ name: m.name, reason: "quote not found verbatim" });
      continue;
    }
    if (!textMentions(quote, entry)) {
      rejected.push({ name: m.name, reason: "quote does not contain the name or an alias" });
      continue;
    }
    if (seen.has(entry.canonical_name)) continue;
    seen.add(entry.canonical_name);
    kept.push({ entry, quote });
  }
  return { kept, rejected };
}

async function discoverFeed(ctx: CollectorContext, checked: string[]): Promise<string | null> {
  const d = ctx.company.domain;
  const pages = [`https://${d}`, `https://${d}/blog`, `https://${d}/engineering`, `https://${d}/tech`, `https://engineering.${d}`, `https://blog.${d}`];
  for (const p of pages) {
    checked.push(p);
    const r = await fetchText(p, { fetchImpl: ctx.fetch, timeoutMs: 8000, retries: 0 }).catch(() => null);
    if (!r?.text) continue;
    const links = findFeedLinks(r.text, r.finalUrl);
    if (links.length) return links[0];
  }
  return null;
}

export const blogCollector: Collector = {
  name: "blog",
  step: "Reading blog",
  timeoutMs: 120_000,
  async collect(ctx): Promise<CollectorResult> {
    const checked: string[] = [];
    const updates: CompanyUpdates = {};
    const signals: Signal[] = [];
    let feed = ctx.company.blogFeedUrl;
    if (feed === "none") {
      checked.push("No blog feed (marked none)");
      return { signals, checked };
    }
    if (!feed) {
      feed = await discoverFeed(ctx, checked);
      if (!feed) {
        checked.push("No RSS or Atom feed found");
        return { signals, checked };
      }
      updates.blogFeedUrl = feed;
      updates.blogVerified = false;
    }
    checked.push(`Feed ${feed}`);
    const r = await fetchText(feed, { fetchImpl: ctx.fetch, timeoutMs: 15000 });
    if (!r.text) {
      checked.push(`Feed returned HTTP ${r.status}`);
      return { signals, checked, updates };
    }
    const items = parseFeed(r.text)
      .filter((i) => i.publishedAt && ctx.now.getTime() - Date.parse(i.publishedAt) <= 90 * DAY)
      .filter((i) => !ctx.seenBlogUrls.has(i.url))
      .slice(0, 5);
    checked.push(`${items.length} new posts from the last 90 days`);
    for (const item of items) {
      const page = await fetchText(item.url, { fetchImpl: ctx.fetch, timeoutMs: 15000, retries: 1 }).catch(() => null);
      const text = page?.text ? articleText(page.text).slice(0, 40_000) : "";
      let topic = "";
      let mentions: VerifiedMention[] = [];
      let extraction: "ok" | "skipped" | "failed" = "skipped";
      if (text && ctx.extractBlog) {
        const ex = await ctx.extractBlog(item.title, text.slice(0, 15_000)).catch(() => null);
        if (ex) {
          topic = String(ex.topic ?? "").slice(0, 200);
          mentions = verifyMentions(ex, text, ctx.dict).kept;
          extraction = "ok";
        } else extraction = "failed";
      }
      signals.push({
        source: "blog",
        kind: "blog_post",
        name: item.title,
        detail: { topic, host: hostnameOf(item.url), extraction },
        evidenceUrl: item.url,
        observedAt: item.publishedAt!,
      });
      for (const m of mentions) {
        signals.push({
          source: "blog",
          kind: "tech",
          name: m.entry.canonical_name,
          detail: { category: m.entry.category, quote: m.quote.slice(0, 300), post_title: item.title },
          evidenceUrl: item.url,
          observedAt: item.publishedAt!,
        });
      }
    }
    return { signals, checked, updates };
  },
};
