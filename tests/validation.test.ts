import { describe, expect, it } from "vitest";
import { isGenericDomain, registrableDomain, resolveCompanyDomain, validateDomainInput } from "../src/lib/domain";
import { isEmail } from "../src/lib/email";

describe("email validation", () => {
  it.each(["name@company.com", "first.last+tag@sub.example.co.in", "a_b@x.io"])("accepts %s", (e) => expect(isEmail(e)).toBe(true));
  it.each(["", "plainaddress", "a@b", "a@b.c", "@x.com", "a@.com", "a..b@x.com", ".a@x.com", "a@x..com", "a@-x.com", "a b@x.com", "a@x.com>", "a@x.c0m"])(
    "rejects %j",
    (e) => expect(isEmail(e)).toBe(false),
  );
});

describe("company domain validation", () => {
  it("normalises URLs and subdomains to the registrable domain", () => {
    expect(validateDomainInput("https://www.Stripe.com/about")).toEqual({ ok: true, domain: "stripe.com" });
    expect(validateDomainInput("engineering.atlassian.com")).toEqual({ ok: true, domain: "atlassian.com" });
    expect(validateDomainInput("shop.tata.co.in")).toEqual({ ok: true, domain: "tata.co.in" });
    expect(registrableDomain("www.apple.com")).toBe("apple.com");
  });
  it.each(["", "ritika@gmail.com", "not a domain", "localhost", "192.168.0.1", "foo", "-bad-.com", "x.123"])("rejects %j with a message", (d) => {
    const r = validateDomainInput(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
  });
  it("flags shared email / hosting domains", () => {
    expect(isGenericDomain("gmail.com")).toBe(true);
    expect(isGenericDomain("stripe.com")).toBe(false);
  });
});

/** Fake fetch: DNS answers from `dns`, websites redirect per `redirects`. */
function fakeFetch(dns: Record<string, boolean>, redirects: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://cloudflare-dns.com/")) {
      const name = new URL(url).searchParams.get("name")!;
      return new Response(JSON.stringify({ Status: dns[name] ? 0 : 3, Answer: dns[name] ? [{}] : [] }));
    }
    const final = redirects[url] ?? url;
    const r = new Response("ok");
    Object.defineProperty(r, "url", { value: final });
    return r;
  }) as typeof fetch;
}

describe("canonical company domain", () => {
  it("maps a domain that redirects to another company domain (apple.in -> apple.com)", async () => {
    const r = await resolveCompanyDomain("apple.in", fakeFetch({ "apple.in": true }, { "https://apple.in": "https://www.apple.com/in/" }));
    expect(r).toEqual({ ok: true, value: { domain: "apple.com", redirectedFrom: "apple.in" } });
  });
  it("keeps a domain that redirects within itself", async () => {
    const r = await resolveCompanyDomain("stripe.com", fakeFetch({ "stripe.com": true }, { "https://stripe.com": "https://stripe.com/in" }));
    expect(r).toEqual({ ok: true, value: { domain: "stripe.com", redirectedFrom: null } });
  });
  it("rejects a domain with no DNS records", async () => {
    const r = await resolveCompanyDomain("nosuchcompany-xyz.com", fakeFetch({}, {}));
    expect(r.ok).toBe(false);
  });
});

describe("GitHub org proof through redirects", () => {
  it("accepts an org website that redirects to the company domain (gs.com -> goldmansachs.com)", async () => {
    const { orgWebsiteProves } = await import("../src/collectors/github");
    const f = fakeFetch({}, { "https://gs.com/opensource": "https://www.goldmansachs.com/" });
    expect(await orgWebsiteProves("https://gs.com/opensource", "goldmansachs.com", f)).toBe(true);
    expect(await orgWebsiteProves("https://example.org", "goldmansachs.com", fakeFetch({}, {}))).toBe(false);
    expect(await orgWebsiteProves(null, "goldmansachs.com", f)).toBe(false);
  });
});

describe("scores use verified sources only", () => {
  it("scores from the verified-only copy until the excluded source is confirmed", async () => {
    const { scoringBasis } = await import("../src/lib/scores");
    const verifiedOnly = { tag: "verified" } as never;
    const computed = { tag: "full", excludedSources: ["github"], verifiedOnly } as never;
    const flags = { githubOrgVerified: false, atsVerified: true, blogVerified: true };
    expect(scoringBasis(computed, flags)).toBe(verifiedOnly);
    expect(scoringBasis(computed, { ...flags, githubOrgVerified: true })).toBe(computed);
    const plain = { tag: "full" } as never;
    expect(scoringBasis(plain, flags)).toBe(plain);
  });
});
