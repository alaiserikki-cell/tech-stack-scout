import { domainToASCII } from "node:url";
import { parse } from "tldts";

/**
 * Company domain handling, in two layers:
 *   1. validateDomainInput  - pure syntax checks on what was typed (no network), using the Public Suffix List
 *   2. resolveCompanyDomain - network checks: DNS, a website that responds, parked / for-sale pages, redirects
 * Every rejection carries a stable `code` (for tests and logs) and a message written for the person typing.
 */

export type DomainErrorCode =
  | "empty"
  | "email"
  | "spaces"
  | "invalid"
  | "ip"
  | "local"
  | "unknown_ending"
  | "shared_host"
  | "typo"
  | "not_company"
  | "no_dns"
  | "unreachable"
  | "parked"
  | "redirect_other";

export type DomainCheck = { ok: true; domain: string } | { ok: false; code: DomainErrorCode; error: string };

const fail = (code: DomainErrorCode, error: string): DomainCheck => ({ ok: false, code, error });

/** Labels that are endings themselves: "ritzy.com.com" leaves "com" as the name, which is a typo. */
const ENDING_LABELS = new Set(["com", "net", "org", "co", "in", "io", "ai", "app", "dev", "gov", "edu", "ac", "biz", "info", "us", "uk", "www"]);

/** Free email providers and link shorteners: real domains, but never "the company's website". */
const NOT_COMPANIES = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com", "zoho.in", "rediffmail.com", "mail.com", "gmx.com", "yandex.com", "tutanota.com",
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org", "tempmail.com", "yopmail.com", "sharklasers.com",
  "bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "rebrand.ly", "lnkd.in",
]);

export function isGenericDomain(domain: string): boolean {
  return NOT_COMPANIES.has(domain);
}

/** The registrable domain ("eTLD+1") from the Public Suffix List: engineering.stripe.com -> stripe.com, shop.tata.co.in -> tata.co.in. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return parse(h, { allowPrivateDomains: true }).domain ?? h;
}

/** The brand part of a domain: apple.co.in -> apple, notion.so -> notion. */
export function brandOf(domain: string): string {
  return parse(domain, { allowPrivateDomains: true }).domainWithoutSuffix ?? domain.split(".")[0];
}

/** Layer 1: syntax. Accepts "stripe.com", "https://www.Stripe.com/about", "engineering.stripe.com"; returns the registrable domain. */
export function validateDomainInput(input: string): DomainCheck {
  const raw = input.trim().replace(/^["'<]+|["'>]+$/g, "");
  if (!raw) return fail("empty", "Enter a company website, e.g. stripe.com.");
  if (raw.includes("@")) {
    const looksEmail = /^[^\s@/]+@[^\s@/]+$/.test(raw);
    return fail(looksEmail ? "email" : "invalid", looksEmail ? "That looks like an email address. Enter the company's website instead, e.g. stripe.com." : "That is not a valid web address. Enter something like stripe.com.");
  }
  if (/\s/.test(raw)) return fail("spaces", "A domain cannot contain spaces. Enter something like stripe.com.");
  if (raw.length > 300) return fail("invalid", "That is too long to be a domain. Enter something like stripe.com.");

  let host: string;
  try {
    // international names become punycode first (münchen.de -> xn--mnchen-3ya.de), independent of the runtime's URL parser
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const m = withScheme.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#:]+)(.*)$/i);
    const ascii = m ? domainToASCII(m[2].toLowerCase()) : "";
    if (m && !ascii) return fail("invalid", "That is not a valid domain. Enter something like stripe.com.");
    host = new URL(m ? `${m[1]}${ascii}${m[3]}` : withScheme).hostname.replace(/\.$/, "");
  } catch {
    return fail("invalid", "That is not a valid web address. Enter something like stripe.com.");
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..") || host.length > 253) return fail("invalid", "That is not a valid domain. Enter something like stripe.com.");
  if (host.split(".").some((l) => !l || l.length > 63 || l.startsWith("-") || l.endsWith("-")))
    return fail("invalid", "That is not a valid domain: a part is empty, too long or starts/ends with a hyphen.");

  const p = parse(host, { allowPrivateDomains: true });
  if (p.isIp) return fail("ip", "Enter the company's domain name, not an IP address.");
  if (!host.includes(".") || /\.(local|localhost|internal|lan|home|test|example|invalid)$/.test(host) || host === "localhost")
    return fail("local", "Enter a public company website, not a local or reserved name.");
  if (!p.domain || (!p.isIcann && !p.isPrivate)) return fail("unknown_ending", `"${host}" does not end in a real domain ending like .com, .in or .co.in.`);
  if (p.isPrivate) return fail("shared_host", `${host} is hosted on a shared platform (${p.publicSuffix}), not a company's own domain. Enter the company's website.`);
  const name = p.domainWithoutSuffix ?? "";
  if (ENDING_LABELS.has(name)) {
    const parts = (p.subdomain ?? "").split(".").filter(Boolean);
    const guess = parts.length && parts[parts.length - 1] !== "www" ? `${parts[parts.length - 1]}.${p.publicSuffix}` : null;
    return fail("typo", `"${host}" looks like a typo: "${name}" is a domain ending, not a name.${guess ? ` Did you mean ${guess}?` : ""}`);
  }
  if (isGenericDomain(p.domain)) return fail("not_company", `${p.domain} is a public email or link service, not a company. Enter the company's own website.`);
  return { ok: true, domain: p.domain };
}

/** Registrars, marketplaces and parking services that unregistered or for-sale domains point to. */
const PARKING = new Set([
  "gen.xyz", "sedo.com", "sedoparking.com", "bodis.com", "parkingcrew.net", "afternic.com", "dan.com", "hugedomains.com", "godaddy.com", "namecheap.com",
  "above.com", "undeveloped.com", "domainmarket.com", "buydomains.com", "uniregistry.com", "porkbun.com", "squadhelp.com", "atom.com", "brandbucket.com",
  "sav.com", "epik.com", "namebright.com", "parklogic.com", "domainnamesales.com", "efty.com", "spaceship.com", "dynadot.com", "name.com", "hostinger.com", "bigrock.in",
]);
const PARKED_TEXT = /\b(this domain (name )?(is|may be) for sale|buy this domain|domain (is )?parked|parked (free|domain)|domain parking|make an offer on this domain|is available for purchase)\b/i;

export function isParkingDomain(domain: string): boolean {
  return PARKING.has(domain);
}
export function looksParked(html: string): boolean {
  return PARKED_TEXT.test(html.slice(0, 50_000));
}

/** A homepage that works, or is a real site blocking bots / rate limiting (401, 403, 429, 503). 404, 410, 5xx do not count. */
export function usableStatus(status: number): boolean {
  return (status >= 200 && status < 400) || [401, 403, 429, 503].includes(status);
}

export interface Resolved {
  domain: string; // canonical registrable domain
  redirectedFrom: string | null; // set when the typed domain redirects to the same brand on another domain
}

/**
 * Layer 2: network. The domain must exist in DNS and serve a website. When the website redirects to another
 * domain of the same brand (apple.in -> apple.com, notion.so -> notion.com) the destination is the company's
 * canonical domain; a redirect to an unrelated site (com.com -> gen.xyz) or a parked page is rejected.
 */
export async function resolveCompanyDomain(domain: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; value: Resolved } | { ok: false; code: DomainErrorCode; error: string }> {
  const dns = async (name: string, type: string): Promise<boolean | null> => {
    try {
      const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(6000) });
      const j = (await r.json()) as { Status: number; Answer?: unknown[] };
      return j.Status === 0 && (j.Answer?.length ?? 0) > 0;
    } catch {
      return null; // the lookup itself failed: never block on our own network problems
    }
  };
  const found = await Promise.all([dns(domain, "A"), dns(`www.${domain}`, "A"), dns(domain, "AAAA"), dns(`www.${domain}`, "CNAME")]);
  if (found.every((x) => x === false)) return { ok: false, code: "no_dns", error: `${domain} does not exist (no DNS records). Check the spelling.` };

  let reached: { finalDomain: string; body: string } | null = null;
  let lastStatus: number | null = null;
  for (const start of [`https://${domain}`, `https://www.${domain}`, `http://${domain}`]) {
    try {
      const r = await fetchImpl(start, {
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", accept: "text/html" },
        signal: AbortSignal.timeout(9000),
      });
      const finalDomain = registrableDomain(new URL(r.url || start).hostname);
      const body = (r.headers.get("content-type") ?? "text/html").includes("html") ? (await r.text()).slice(0, 50_000) : "";
      // parked / for-sale wins over everything, whatever the status code
      if (isParkingDomain(finalDomain) || looksParked(body))
        return { ok: false, code: "parked", error: `${domain} is parked or for sale${finalDomain !== domain ? ` (it redirects to ${finalDomain})` : ""}, not a company website.` };
      if (usableStatus(r.status)) {
        reached = { finalDomain, body };
        break;
      }
      lastStatus = r.status; // e.g. a homepage that answers 404: try the next variant
    } catch {
      /* try the next variant */
    }
  }
  if (!reached)
    return {
      ok: false,
      code: "unreachable",
      error: lastStatus
        ? `${domain} exists, but its homepage does not work (HTTP ${lastStatus}). Check that it is the company's website.`
        : `${domain} exists, but no website responds there. Check that it is the company's website.`,
    };

  const { finalDomain } = reached;
  if (finalDomain === domain) return { ok: true, value: { domain, redirectedFrom: null } };
  if (brandOf(finalDomain) === brandOf(domain) && !isGenericDomain(finalDomain)) return { ok: true, value: { domain: finalDomain, redirectedFrom: domain } };
  return { ok: false, code: "redirect_other", error: `${domain} redirects to ${finalDomain}, a different website. If that is the company you meant, add ${finalDomain} instead.` };
}
