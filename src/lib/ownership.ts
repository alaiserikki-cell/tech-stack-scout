import { brandOf, registrableDomain } from "./domain";
import { decodeEntities } from "./text";

/**
 * One rule for "does this website belong to the company?", used by every collector (GitHub org website,
 * blog feed, careers site). A site is the company's when one of these holds, checked in this order:
 *   1. it is on the company's domain                          blog.swiggy.com            for swiggy.com
 *   2. a page on the company's domain redirects to it         tech.flipkart.com -> blog.flipkart.tech
 *   3. a page on the company's domain links to it             flipkart.com links flipkartcareers.com
 *   4. its domain carries the company's brand AND its own     zerodha.tech links to zerodha.com
 *      homepage links back to the company's domain
 * Anything else (a name match, a search hit) stays unverified and is never used.
 */
export interface Proof {
  owned: boolean;
  how: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

export function onDomain(urlOrHost: string, domain: string): boolean {
  try {
    const host = urlOrHost.includes("/") ? new URL(urlOrHost).hostname : urlOrHost;
    return registrableDomain(host) === registrableDomain(domain);
  } catch {
    return false;
  }
}

/** Absolute http(s) links in a page; handles quoted and unquoted href values. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const raw = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript):/i.test(raw)) continue;
    try {
      const u = new URL(raw, baseUrl);
      if (u.protocol === "http:" || u.protocol === "https:") out.add(u.toString());
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

export function linksToDomain(html: string, baseUrl: string, domain: string): boolean {
  return extractLinks(html, baseUrl).some((l) => onDomain(l, domain));
}

/** The brand appears in the other domain's name (flipkartcareers.com, zerodha.tech for zerodha.com). */
export function carriesBrand(otherDomain: string, companyDomain: string): boolean {
  const brand = brandOf(companyDomain);
  return brand.length >= 3 && brandOf(otherDomain).includes(brand);
}

export async function proveOwnership(
  url: string,
  company: { domain: string },
  opts: { fetchImpl?: typeof fetch; linkedFrom?: string | null; redirectedFrom?: string | null } = {},
): Promise<Proof> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { owned: false, how: "not a valid URL" };
  }
  const d = company.domain;
  if (onDomain(host, d)) return { owned: true, how: `hosted on ${d}` };
  if (opts.redirectedFrom && onDomain(opts.redirectedFrom, d)) return { owned: true, how: `${new URL(opts.redirectedFrom).hostname} redirects to it` };
  if (opts.linkedFrom && onDomain(opts.linkedFrom, d)) return { owned: true, how: `linked from ${opts.linkedFrom}` };
  const other = registrableDomain(host);
  if (carriesBrand(other, d)) {
    const home = `https://${host}`;
    try {
      const r = await (opts.fetchImpl ?? fetch)(home, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
      if (onDomain(r.url || home, d)) return { owned: true, how: `${host} redirects to ${d}` };
      const html = r.ok ? await r.text() : "";
      if (linksToDomain(html, r.url || home, d)) return { owned: true, how: `${other} carries the brand and links back to ${d}` };
    } catch {
      /* unreachable: not proven */
    }
  }
  return { owned: false, how: `${other} is not proven to belong to ${d}` };
}
