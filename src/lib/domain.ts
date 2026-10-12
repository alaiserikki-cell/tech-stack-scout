/** Second-level suffixes where the registrable domain has three labels (e.g. example.co.in). */
const MULTI_PART_SUFFIXES = new Set([
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "gov.in",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "co.jp", "co.kr", "co.za", "com.br", "com.mx", "com.sg", "com.my", "com.cn", "com.hk", "com.tw", "com.tr", "com.ar", "co.id",
]);

/** The registrable domain ("eTLD+1"): engineering.stripe.com -> stripe.com, shop.example.co.in -> example.co.in. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const last2 = parts.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(last2) ? parts.slice(-3).join(".") : last2;
}

export type DomainCheck = { ok: true; domain: string } | { ok: false; error: string };

/** Validate what someone typed into "Add company" before anything is fetched. */
export function validateDomainInput(input: string): DomainCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter a company website, e.g. stripe.com." };
  if (/^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(raw) || raw.includes("@"))
    return { ok: false, error: "That looks like an email address. Enter the company's website instead, e.g. stripe.com." };
  if (/\s/.test(raw)) return { ok: false, error: "A domain cannot contain spaces. Enter something like stripe.com." };
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { ok: false, error: "That is not a valid web address. Enter something like stripe.com." };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return { ok: false, error: "Enter the company's domain name, not an IP address." };
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".test"))
    return { ok: false, error: "Enter a public company website, not a local address." };
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || !/\.[a-z]{2,}$/.test(host)) return { ok: false, error: "That is not a valid domain. Enter something like stripe.com." };
  if (host.split(".").some((l) => l.startsWith("-") || l.endsWith("-") || l.length > 63)) return { ok: false, error: "That is not a valid domain. Enter something like stripe.com." };
  return { ok: true, domain: registrableDomain(host) };
}

/** Free email / generic hosting domains are not companies. */
const NOT_COMPANIES = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "proton.me", "protonmail.com", "rediffmail.com", "github.io", "vercel.app", "netlify.app", "herokuapp.com", "blogspot.com", "wordpress.com", "medium.com", "notion.site"]);

export function isGenericDomain(domain: string): boolean {
  return NOT_COMPANIES.has(domain);
}

export interface Resolved {
  domain: string; // canonical registrable domain
  redirectedFrom: string | null; // set when the typed domain redirects to another company domain
}

/**
 * Resolve the company's canonical domain: the domain must exist (DNS) and, if its website redirects to a
 * different registrable domain (apple.in -> apple.com), the destination is the real company domain.
 */
export async function resolveCompanyDomain(domain: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; value: Resolved } | { ok: false; error: string }> {
  const dns = async (name: string, type: string) => {
    try {
      const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(6000) });
      const j = (await r.json()) as { Status: number; Answer?: unknown[] };
      return j.Status === 0 && (j.Answer?.length ?? 0) > 0;
    } catch {
      return null; // DNS lookup itself failed: do not block on our own network problems
    }
  };
  const exists = [await dns(domain, "A"), await dns(`www.${domain}`, "A"), await dns(domain, "AAAA")];
  if (exists.every((x) => x === false)) return { ok: false, error: `We couldn't find a website at ${domain}. Check the spelling.` };

  for (const start of [`https://${domain}`, `https://www.${domain}`]) {
    try {
      const r = await fetchImpl(start, { method: "GET", redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (FlakeGuard domain check)" }, signal: AbortSignal.timeout(8000) });
      const finalHost = new URL(r.url || start).hostname.toLowerCase().replace(/^www\./, "");
      const finalDomain = registrableDomain(finalHost);
      if (finalDomain && finalDomain !== domain && !isGenericDomain(finalDomain)) return { ok: true, value: { domain: finalDomain, redirectedFrom: domain } };
      return { ok: true, value: { domain, redirectedFrom: null } };
    } catch {
      /* try the www variant, then fall through */
    }
  }
  return { ok: true, value: { domain, redirectedFrom: null } };
}

/** Back-compat helper used by older callers: validation only. */
export function normalizeDomain(input: string): string | null {
  const r = validateDomainInput(input);
  return r.ok ? r.domain : null;
}
