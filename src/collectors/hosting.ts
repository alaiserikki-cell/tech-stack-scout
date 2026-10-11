import type { Collector, CollectorResult, Signal } from "@/lib/types";
import { fetchJson, fetchRetry } from "@/lib/http";

/** Patterns describe PUBLIC-FACING hosting only (CDN / edge / web host), never the backend. */
const CNAME_PATTERNS: [RegExp, string][] = [
  [/cloudfront\.net\.?$/i, "Amazon CloudFront"],
  [/vercel-dns\.com\.?$|vercel\.app\.?$/i, "Vercel"],
  [/netlify\.(app|com)\.?$/i, "Netlify"],
  [/herokudns\.com\.?$|herokuapp\.com\.?$/i, "Heroku"],
  [/azurewebsites\.net\.?$|azureedge\.net\.?$|azurefd\.net\.?$|trafficmanager\.net\.?$/i, "Microsoft Azure"],
  [/googleusercontent\.com\.?$|ghs\.googlehosted\.com\.?$|appspot\.com\.?$/i, "Google Cloud"],
  [/fastly\.net\.?$|fastlylb\.net\.?$/i, "Fastly"],
  [/akamai(edge)?\.net\.?$|edgekey\.net\.?$|edgesuite\.net\.?$/i, "Akamai"],
  [/cdn\.cloudflare\.net\.?$/i, "Cloudflare"],
  [/github\.io\.?$/i, "GitHub Pages"],
  [/elb\.amazonaws\.com\.?$|amazonaws\.com\.?$/i, "AWS"],
  [/wpengine\.com\.?$/i, "WP Engine"],
  [/webflow\.io\.?$|proxy-ssl\.webflow\.com\.?$/i, "Webflow"],
];

const HEADER_PATTERNS: [(h: Headers) => boolean, string, string][] = [
  [(h) => h.has("x-amz-cf-id") || /cloudfront/i.test(h.get("via") ?? ""), "Amazon CloudFront", "x-amz-cf-id / via header"],
  [(h) => h.has("x-vercel-id") || /vercel/i.test(h.get("server") ?? ""), "Vercel", "x-vercel-id header"],
  [(h) => h.has("x-nf-request-id") || /netlify/i.test(h.get("server") ?? ""), "Netlify", "x-nf-request-id header"],
  [(h) => /vegur|heroku/i.test(h.get("via") ?? "") , "Heroku", "via: vegur header"],
  [(h) => h.has("cf-ray") || /cloudflare/i.test(h.get("server") ?? ""), "Cloudflare", "cf-ray / server header"],
  [(h) => /AmazonS3|awselb/i.test(h.get("server") ?? ""), "AWS", "server header"],
  [(h) => /gws|Google Frontend|gfe/i.test(h.get("server") ?? "") || h.has("x-goog-generation"), "Google Cloud", "server header"],
  [(h) => h.has("x-azure-ref") || /Microsoft-IIS|Kestrel/i.test(h.get("server") ?? ""), "Microsoft Azure", "x-azure-ref / server header"],
  [(h) => /fastly/i.test(h.get("x-served-by") ?? "") || h.has("x-fastly-request-id"), "Fastly", "x-served-by header"],
  [(h) => /akamai/i.test(h.get("server") ?? "") || h.has("x-akamai-transformed"), "Akamai", "server header"],
  [(h) => h.has("x-github-request-id"), "GitHub Pages", "x-github-request-id header"],
];

export function classifyCname(target: string): string | null {
  for (const [re, name] of CNAME_PATTERNS) if (re.test(target)) return name;
  return null;
}

export function classifyHeaders(h: Headers): { provider: string; evidence: string }[] {
  return HEADER_PATTERNS.filter(([test]) => test(h)).map(([, provider, evidence]) => ({ provider, evidence }));
}

export const hostingCollector: Collector = {
  name: "hosting",
  step: "Reading blog",
  timeoutMs: 20_000,
  async collect(ctx): Promise<CollectorResult> {
    const d = ctx.company.domain;
    const found = new Map<string, string>();
    for (const host of [`www.${d}`, d]) {
      for (const type of ["CNAME", "A"]) {
        const { data } = await fetchJson<{ Answer?: { type: number; data: string }[] }>(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
          { fetchImpl: ctx.fetch, headers: { accept: "application/dns-json" }, timeoutMs: 6000, retries: 1 },
        ).catch(() => ({ data: null }));
        for (const a of data?.Answer ?? []) {
          if (a.type !== 5) continue; // CNAME records (also returned when following A)
          const p = classifyCname(a.data);
          if (p && !found.has(p)) found.set(p, `DNS CNAME ${host} -> ${a.data.replace(/\.$/, "")}`);
        }
      }
    }
    try {
      const res = await fetchRetry(`https://${d}`, { method: "HEAD", fetchImpl: ctx.fetch, timeoutMs: 8000, retries: 0, redirect: "follow", passStatuses: [403, 404, 405, 301, 302] });
      for (const { provider, evidence } of classifyHeaders(res.headers)) if (!found.has(provider)) found.set(provider, `HTTP HEAD https://${d}: ${evidence}`);
    } catch {
      /* HEAD failures are not fatal */
    }
    const signals: Signal[] = [...found.entries()].map(([provider, evidence]) => ({
      source: "hosting",
      kind: "hosting",
      name: provider,
      detail: { scope: "public-facing hosting", evidence },
      evidenceUrl: `https://${d}`,
      observedAt: ctx.now.toISOString(),
    }));
    return { signals, checked: [`DNS (CNAME, A) for ${d} and www.${d}`, `HEAD https://${d}`] };
  },
};
