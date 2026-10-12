import { describe, expect, it } from "vitest";
import { brandOf, isGenericDomain, looksParked, registrableDomain, resolveCompanyDomain, validateDomainInput } from "../src/lib/domain";
import { isEmail } from "../src/lib/email";
import { carriesBrand, extractLinks, linksToDomain, onDomain, proveOwnership } from "../src/lib/ownership";
import { findFeedLinks, mediumFeed } from "../src/collectors/blog";
import { isSampleCode, orgWebsiteProves } from "../src/collectors/github";
import { renderDigestHtml } from "../src/lib/digest";
import { gmailComposeUrl, mailtoUrl, outreachEmail } from "../src/lib/outreach";
import profileJson from "../data/product-profile.json";

/**
 * Fake network. `dns`: names with records. `sites`: URL -> { final URL after redirects, status, body }.
 * Any URL not listed fails like a dead host.
 */
type Site = { to?: string; status?: number; body?: string };
function fakeFetch(dns: Record<string, boolean>, sites: Record<string, Site>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://cloudflare-dns.com/")) {
      const name = new URL(url).searchParams.get("name")!;
      return new Response(JSON.stringify({ Status: dns[name] ? 0 : 3, Answer: dns[name] ? [{}] : [] }));
    }
    const site = sites[url];
    if (!site) throw new TypeError("fetch failed");
    const r = new Response(site.body ?? "<html></html>", { status: site.status ?? 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(r, "url", { value: site.to ?? url });
    return r;
  }) as typeof fetch;
}

describe("email validation", () => {
  it.each(["name@company.com", "first.last+tag@sub.acme.co.in", "a_b@x.io"])("accepts %s", (e) => expect(isEmail(e)).toBe(true));
  it.each(["", "plainaddress", "a@b", "a@b.c", "@x.com", "a@.com", "a..b@x.com", ".a@x.com", "a@x..com", "a@-x.com", "a b@x.com", "a@x.com>", "a@x.c0m", "test@example.com", "me@foo.test"])(
    "rejects %j",
    (e) => expect(isEmail(e)).toBe(false),
  );
});

describe("domain input (layer 1: syntax)", () => {
  it.each([
    ["stripe.com", "stripe.com"],
    ["https://www.Stripe.com/about?x=1#top", "stripe.com"],
    ["STRIPE.COM.", "stripe.com"],
    ["engineering.atlassian.com", "atlassian.com"],
    ["shop.tata.co.in", "tata.co.in"],
    ["razorpay.com:443", "razorpay.com"],
    ["  'zerodha.com'  ", "zerodha.com"],
    ["münchen.de", "xn--mnchen-3ya.de"],
  ])("accepts %j as %s", (input, domain) => expect(validateDomainInput(input)).toEqual({ ok: true, domain }));

  it.each([
    ["", "empty"],
    ["ritika@gmail.com", "email"],
    ["https://user@stripe.com", "invalid"],
    ["not a domain", "spaces"],
    ["localhost", "local"],
    ["intranet.local", "local"],
    ["10.0.0.1", "ip"],
    ["foo", "local"],
    ["hackedhere.something", "unknown_ending"],
    ["-bad-.com", "invalid"],
    ["a..b.com", "invalid"],
    ["x".repeat(64) + ".com", "invalid"],
    ["ritzy.com.com", "typo"],
    ["acme.in.in", "typo"],
    ["www.com", "typo"],
    ["myapp.vercel.app", "shared_host"],
    ["someone.github.io", "shared_host"],
    ["gmail.com", "not_company"],
    ["mailinator.com", "not_company"],
    ["bit.ly", "not_company"],
  ])("rejects %j (%s) with a message", (input, code) => {
    const r = validateDomainInput(input);
    expect(r).toMatchObject({ ok: false, code });
    if (!r.ok) expect(r.error.length).toBeGreaterThan(15);
  });

  it("suggests the likely domain for a doubled ending", () => {
    const r = validateDomainInput("ritzy.com.com");
    expect(!r.ok && r.error).toContain("Did you mean ritzy.com?");
  });

  it("knows registrable domains and brands from the Public Suffix List", () => {
    expect(registrableDomain("www.apple.com")).toBe("apple.com");
    expect(registrableDomain("blog.flipkart.tech")).toBe("flipkart.tech");
    expect(brandOf("tata.co.in")).toBe("tata");
    expect(isGenericDomain("stripe.com")).toBe(false);
  });
});

describe("domain resolution (layer 2: network)", () => {
  it("maps a domain that redirects to the same brand elsewhere (apple.in -> apple.com)", async () => {
    const r = await resolveCompanyDomain("apple.in", fakeFetch({ "apple.in": true }, { "https://apple.in": { to: "https://www.apple.com/in/" } }));
    expect(r).toEqual({ ok: true, value: { domain: "apple.com", redirectedFrom: "apple.in" } });
  });
  it("keeps a domain that redirects within itself", async () => {
    const r = await resolveCompanyDomain("stripe.com", fakeFetch({ "stripe.com": true }, { "https://stripe.com": { to: "https://stripe.com/in" } }));
    expect(r).toEqual({ ok: true, value: { domain: "stripe.com", redirectedFrom: null } });
  });
  it("accepts a site behind bot protection (403 is still a website)", async () => {
    const r = await resolveCompanyDomain("acme.com", fakeFetch({ "acme.com": true }, { "https://acme.com": { status: 403 } }));
    expect(r.ok).toBe(true);
  });
  it("tries www and http before giving up", async () => {
    const r = await resolveCompanyDomain("acme.com", fakeFetch({ "www.acme.com": true }, { "http://acme.com": {} }));
    expect(r.ok).toBe(true);
  });
  it("rejects a redirect to an unrelated site (com.com -> gen.xyz style)", async () => {
    const r = await resolveCompanyDomain("acme.com", fakeFetch({ "acme.com": true }, { "https://acme.com": { to: "https://othercorp.io/" } }));
    expect(r).toMatchObject({ ok: false, code: "redirect_other" });
  });
  it("rejects registrar and parking destinations", async () => {
    const r = await resolveCompanyDomain("com.com", fakeFetch({ "com.com": true }, { "https://com.com": { to: "https://gen.xyz/" } }));
    expect(r).toMatchObject({ ok: false, code: "parked" });
  });
  it("rejects a for-sale page on the domain itself", async () => {
    const r = await resolveCompanyDomain("acme.com", fakeFetch({ "acme.com": true }, { "https://acme.com": { body: "<h1>This domain is for sale!</h1>" } }));
    expect(r).toMatchObject({ ok: false, code: "parked" });
  });
  it("rejects a domain that resolves but serves no website (randommail.com style)", async () => {
    const r = await resolveCompanyDomain("acme.com", fakeFetch({ "acme.com": true }, {}));
    expect(r).toMatchObject({ ok: false, code: "unreachable" });
  });
  it("rejects a homepage that answers 404 on every variant (randommail.com)", async () => {
    const dead = { status: 404, body: "<p>Not found</p>" };
    const r = await resolveCompanyDomain("acme.com", fakeFetch({ "acme.com": true }, { "https://acme.com": dead, "https://www.acme.com": dead, "http://acme.com": dead }));
    expect(r).toMatchObject({ ok: false, code: "unreachable" });
    expect(!r.ok && r.error).toContain("HTTP 404");
  });
  it("rejects a domain with no DNS records", async () => {
    const r = await resolveCompanyDomain("nosuchcompany-xyz.com", fakeFetch({}, {}));
    expect(r).toMatchObject({ ok: false, code: "no_dns" });
  });
  it("detects parked page text", () => {
    expect(looksParked("Buy this domain today")).toBe(true);
    expect(looksParked("We build payments infrastructure")).toBe(false);
  });
});

describe("ownership rule", () => {
  it("parses quoted and unquoted links", () => {
    const html = `<a href="https://a.com/x">a</a> <a href=https://zerodha.com>z</a> <a href='/careers'>c</a> <a href="mailto:x@y.com">m</a>`;
    expect(extractLinks(html, "https://zerodha.tech/")).toEqual(["https://a.com/x", "https://zerodha.com/", "https://zerodha.tech/careers"]);
    expect(linksToDomain(html, "https://zerodha.tech/", "zerodha.com")).toBe(true);
  });
  it("matches domains and brands", () => {
    expect(onDomain("https://blog.swiggy.com/feed", "swiggy.com")).toBe(true);
    expect(onDomain("https://swiggy.com.evil.io", "swiggy.com")).toBe(false);
    expect(carriesBrand("flipkartcareers.com", "flipkart.com")).toBe(true);
    expect(carriesBrand("zerodha.tech", "zerodha.com")).toBe(true);
    expect(carriesBrand("gs.com", "goldmansachs.com")).toBe(false);
  });
  it("rule 1: on the company's domain", async () => expect((await proveOwnership("https://engineering.cred.club/feed", { domain: "cred.club" })).owned).toBe(true));
  it("rule 2: reached by a redirect from the company's domain", async () =>
    expect(await proveOwnership("https://blog.flipkart.tech/feed", { domain: "flipkart.com" }, { redirectedFrom: "https://tech.flipkart.com" })).toMatchObject({ owned: true }));
  it("rule 3: linked from the company's own page", async () =>
    expect(await proveOwnership("https://medium.com/feed/acme-eng", { domain: "acme.com" }, { linkedFrom: "https://www.acme.com/" })).toMatchObject({ owned: true }));
  it("rule 4: brand domain that links back", async () => {
    const f = fakeFetch({}, { "https://zerodha.tech": { body: `<a href=https://zerodha.com>Zerodha</a>` } });
    expect(await proveOwnership("https://zerodha.tech/index.xml", { domain: "zerodha.com" }, { fetchImpl: f })).toMatchObject({ owned: true });
  });
  it("rejects a brand domain that does not link back, and unrelated sites", async () => {
    const f = fakeFetch({}, { "https://zerodhafans.net": { body: "<p>fan site</p>" } });
    expect((await proveOwnership("https://zerodhafans.net/feed", { domain: "zerodha.com" }, { fetchImpl: f })).owned).toBe(false);
    expect((await proveOwnership("https://medium.com/feed/someone", { domain: "zerodha.com" }, { fetchImpl: f })).owned).toBe(false);
  });
  it("GitHub org website through a redirect (gs.com -> goldmansachs.com) or a brand domain", async () => {
    expect(await orgWebsiteProves("https://gs.com/opensource", "goldmansachs.com", fakeFetch({}, { "https://gs.com/opensource": { to: "https://www.goldmansachs.com/" } }))).toBe(true);
    expect(await orgWebsiteProves("https://zerodha.tech/projects", "zerodha.com", fakeFetch({}, { "https://zerodha.tech/projects": {}, "https://zerodha.tech": { body: `<a href="https://zerodha.com">` } }))).toBe(true);
    expect(await orgWebsiteProves("https://example.org", "goldmansachs.com", fakeFetch({}, {}))).toBe(false);
    expect(await orgWebsiteProves(null, "goldmansachs.com", fakeFetch({}, {}))).toBe(false);
  });
});

describe("collector details", () => {
  it("finds feed links with unquoted attributes (Hugo sites)", () => {
    expect(findFeedLinks(`<link rel=alternate type=application/rss+xml href=https://zerodha.tech/index.xml title="Zerodha Tech Blog">`, "https://zerodha.tech/")).toEqual(["https://zerodha.tech/index.xml"]);
  });
  it("maps Medium publications to their feed", () => {
    expect(mediumFeed("https://medium.com/swiggy-bytes")).toBe("https://medium.com/feed/swiggy-bytes");
    expect(mediumFeed("https://medium.com/@someone/post-123")).toBe("https://medium.com/feed/@someone");
    expect(mediumFeed("https://medium.com/tag/kafka")).toBeNull();
  });
  it("ignores example apps, fixtures and vendored code as stack evidence", () => {
    expect(isSampleCode("examples/example-expo-57/android/app/build.gradle")).toBe(true);
    expect(isSampleCode("packages/web/fixtures/Dockerfile")).toBe(true);
    expect(isSampleCode("vendor/github.com/x/y/go.mod")).toBe(true);
    expect(isSampleCode(".github/workflows/ci.yml")).toBe(false);
    expect(isSampleCode("services/api/Dockerfile")).toBe(false);
  });
});

describe("digest email draft", () => {
  const acc = [{ companyId: 7, name: "Stripe", domain: "stripe.com", fitScore: 95, score: 99, whyNow: "New talk", whyType: "new_talk", evidenceUrl: "https://infoq.com/x", momentum: 1, events: [] }] as never;
  it("opens every link in a new tab and explains fit", () => {
    const html = renderDigestHtml(acc, "2026-10-12", "https://app.example", "FlakeGuard");
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a).toContain('target="_blank"');
    expect(html).toContain("https://app.example/company/7");
    expect(html).toContain("what FlakeGuard needs");
  });
});

describe("outreach email draft", () => {
  const computed = {
    languages: [{ name: "Python", pct: 30, signalId: 1 }, { name: "Go", pct: 60, signalId: 2 }],
    techs: [
      { name: "GitHub Actions", category: "ci" },
      { name: "pytest", category: "test_framework" },
      { name: "Docker", category: "infra" },
    ],
  } as never;
  const d = outreachEmail({ company: "Acme", opener: "Your post on cutting CI time with Bazel caught my eye.", computed, profile: profileJson as never });
  it("starts with the opener and uses only verified facts", () => {
    expect(d.body.split("\n\n")[1]).toBe("Your post on cutting CI time with Bazel caught my eye.");
    expect(d.body).toContain("builds mostly in Go and Python, runs GitHub Actions and tests with pytest");
    expect(d.body).not.toContain("Docker");
    expect(d.body.endsWith("Best,\nNikhil")).toBe(true);
    expect(d.subject).toBe("Acme's GitHub Actions pipeline and FlakeGuard");
  });
  it("leaves out the facts line when nothing is known", () => {
    const e = outreachEmail({ company: "Acme", opener: "Hello.", computed: { languages: [], techs: [] } as never, profile: profileJson as never });
    expect(e.body).not.toContain("From what your team shares");
    expect(e.subject).toBe("Acme's engineering team and FlakeGuard");
  });
  it("builds Gmail and mail-app links with the draft encoded", () => {
    expect(gmailComposeUrl(d)).toContain("su=Acme's%20GitHub%20Actions");
    expect(mailtoUrl(d).startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(mailtoUrl(d).split("&body=")[1])).toBe(d.body);
  });
});
