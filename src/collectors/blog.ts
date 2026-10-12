import type { BlogExtraction, Collector, CollectorContext, CollectorResult, CompanyUpdates, DictEntry, Signal } from "@/lib/types";
import { fetchText } from "@/lib/http";
import { articleText, decodeEntities, normalizeText, hostnameOf, sameSite } from "@/lib/text";
import { resolveName, textMentions } from "@/lib/dictionary";
import { extractLinks, proveOwnership, type Proof } from "@/lib/ownership";

const DAY = 86_400_000;
/** Engineering blogs post a few times a year, so a year of posts is read (the newest 5); recency is scored separately. */
export const BLOG_WINDOW_DAYS = 365;

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
}

/** Find <link rel="alternate" type="application/rss+xml|atom+xml"> in an HTML page (quoted or unquoted attributes). */
export function findFeedLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\brel\s*=\s*["']?alternate/i.test(tag) || !/\btype\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const hm = tag.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/i);
    const href = hm?.[1] ?? hm?.[2] ?? hm?.[3];
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

/** medium.com/<publication> (or /@user) -> its RSS feed; Medium custom domains serve /feed themselves. */
export function mediumFeed(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.)?medium\.com\/(@?[A-Za-z0-9_.-]+)/i);
  return m && !["feed", "m", "tag", "search", "about", "plans", "membership"].includes(m[1].toLowerCase()) ? `https://medium.com/feed/${m[1]}` : null;
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

const FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/feed.xml", "/index.xml", "/atom.xml"];
const BLOG_LINK = /blog|engineering|\btech\b|tech\.|bytes|developers?\b|medium\.com\//i;

async function validFeed(ctx: CollectorContext, url: string): Promise<boolean> {
  const r = await fetchText(url, { fetchImpl: ctx.fetch, timeoutMs: 8000, retries: 0 }).catch(() => null);
  return Boolean(r?.text && /<(rss|feed|rdf:RDF)\b/i.test(r.text.slice(0, 3000)) && parseFeed(r.text).length > 0);
}

/**
 * Find the company's engineering blog feed. Candidates, in order: engineering/tech/blog subdomains and paths,
 * blog-looking links on the homepage (Medium publications included) and the GitHub org's proven website.
 * Each page is checked for an advertised feed, then for the usual feed paths (Medium custom domains hide the
 * <link> tag behind bot protection but serve /feed). A feed is kept only when the ownership rule proves it.
 */
export async function discoverFeed(ctx: CollectorContext, checked: string[]): Promise<{ feed: string; proof: Proof } | null> {
  const d = ctx.company.domain;
  const home = `https://${d}`;
  const candidates: { page: string; linkedFrom?: string }[] = [`https://engineering.${d}`, `https://tech.${d}`, `https://blog.${d}`, `https://eng.${d}`, `${home}/blog`, `${home}/engineering`, `${home}/tech`, home].map((page) => ({ page }));
  const homeRes = await fetchText(home, { fetchImpl: ctx.fetch, timeoutMs: 8000, retries: 0 }).catch(() => null);
  if (homeRes?.text)
    for (const l of extractLinks(homeRes.text, homeRes.finalUrl).filter((l) => BLOG_LINK.test(l)).slice(0, 8)) candidates.push({ page: l, linkedFrom: homeRes.finalUrl });
  if (ctx.hints?.orgWebsite) {
    const site = /^https?:/i.test(ctx.hints.orgWebsite) ? ctx.hints.orgWebsite : `https://${ctx.hints.orgWebsite}`;
    candidates.push({ page: site });
    try {
      const origin = new URL(site).origin;
      candidates.push({ page: origin }, { page: `${origin}/blog` });
    } catch {
      /* not a URL */
    }
  }

  const seen = new Set<string>();
  const unique = candidates.filter((c) => !seen.has(c.page) && seen.add(c.page));
  // fetch every candidate page in parallel, then judge them in priority order
  const pages = await Promise.all(unique.map((c) => (c.page === home ? Promise.resolve(homeRes) : fetchText(c.page, { fetchImpl: ctx.fetch, timeoutMs: 8000, retries: 0 }).catch(() => null))));
  let fallback: { feed: string; proof: Proof } | null = null;
  for (let i = 0; i < unique.length; i++) {
    const { page, linkedFrom } = unique[i];
    const r = pages[i];
    checked.push(page);
    if (!r) continue; // no such host
    const finalUrl = r.finalUrl || page;
    const feeds = r.text ? findFeedLinks(r.text, finalUrl) : [];
    const mf = mediumFeed(finalUrl);
    if (mf) feeds.unshift(mf);
    if (!feeds.length && finalUrl !== homeRes?.finalUrl) {
      const base = finalUrl.replace(/[?#].*$/, "").replace(/\/$/, "");
      const probes = await Promise.all(FEED_PATHS.map(async (p) => ((await validFeed(ctx, base + p)) ? base + p : null)));
      const hit = probes.find(Boolean);
      if (hit) feeds.push(hit);
    }
    for (const feed of feeds.slice(0, 2)) {
      const proof = await proveOwnership(feed, { domain: d }, { fetchImpl: ctx.fetch, linkedFrom, redirectedFrom: !sameSite(hostnameOf(finalUrl) ?? "", hostnameOf(page) ?? "") ? page : null });
      if (proof.owned) {
        if (await validFeed(ctx, feed)) return { feed, proof };
      } else if (!fallback && (await validFeed(ctx, feed))) fallback = { feed, proof };
    }
  }
  return fallback;
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
      const found = await discoverFeed(ctx, checked);
      if (!found) {
        checked.push("No RSS or Atom feed found");
        return { signals, checked };
      }
      feed = found.feed;
      updates.blogFeedUrl = feed;
      updates.blogVerified = found.proof.owned;
      checked.push(`Feed ${found.proof.owned ? "verified" : "not verified"}: ${found.proof.how}`);
    } else if (!ctx.company.blogVerified) {
      const proof = await proveOwnership(feed, { domain: ctx.company.domain }, { fetchImpl: ctx.fetch });
      if (proof.owned) {
        updates.blogVerified = true;
        checked.push(`Feed verified: ${proof.how}`);
      }
    }
    checked.push(`Feed ${feed}`);
    const r = await fetchText(feed, { fetchImpl: ctx.fetch, timeoutMs: 15000 });
    if (!r.text) {
      checked.push(`Feed returned HTTP ${r.status}`);
      return { signals, checked, updates };
    }
    const items = parseFeed(r.text)
      .filter((i) => i.publishedAt && ctx.now.getTime() - Date.parse(i.publishedAt) <= BLOG_WINDOW_DAYS * DAY)
      .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!))
      .filter((i) => !ctx.seenBlogUrls.has(i.url))
      .slice(0, 5);
    checked.push(`${items.length} new posts from the last 12 months`);
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
