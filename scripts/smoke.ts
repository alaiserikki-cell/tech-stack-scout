// End-to-end smoke test against a deployed instance (read-only unless --writes is passed).
// Usage: npx tsx scripts/smoke.ts [baseUrl] [--writes]
// --writes also exercises write endpoints (logging in with DEMO_PASSCODE first if the site requires it)
// (refresh is expected to return a cached run if one ran in the last 10 minutes).
import "dotenv/config";

const base = (process.argv.slice(2).find((a) => a.startsWith("http")) ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const writes = process.argv.includes("--writes");
let failures = 0;
let passes = 0;

function check(name: string, ok: boolean, detail = "") {
  ok ? passes++ : failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function get(path: string, init?: RequestInit) {
  const res = await fetch(base + path, { redirect: "manual", ...init });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

async function main() {
  console.log(`Smoke testing ${base}\n`);

  // pages
  for (const p of ["/", "/dashboard", "/digests", "/activity", "/settings", "/how-it-works"]) {
    const r = await get(p);
    check(`GET ${p}`, r.status === 200 && !/Application error|Internal Server Error/.test(r.text), `HTTP ${r.status}`);
  }
  const home = await get("/dashboard");
  const ids = [...new Set([...home.text.matchAll(/\/company\/(\d+)/g)].map((m) => Number(m[1])))];
  check("dashboard lists companies", ids.length > 0, `${ids.length} companies`);
  const old = await fetch(base + "/watchlist", { redirect: "manual" });
  check("/watchlist redirects to /dashboard", [307, 308].includes(old.status) && (old.headers.get("location") ?? "").endsWith("/dashboard"), `HTTP ${old.status}`);
  for (const id of ids.slice(0, 3)) {
    const r = await get(`/company/${id}`);
    check(`GET /company/${id}`, r.status === 200 && /Info/.test(r.text) && /Fit/.test(r.text) && /Outreach email draft/.test(r.text), `HTTP ${r.status}`);
  }

  // api
  const health = await get("/api/health");
  check("GET /api/health is healthy", health.status === 200 && /"ok":true/.test(health.text), health.text.slice(0, 160));
  const run = await get("/api/runs/1");
  check("GET /api/runs/1 returns JSON", run.status === 200 && /"status"/.test(run.text));
  check("GET /api/runs/999999 is 404", (await get("/api/runs/999999")).status === 404);
  check("cron rejects missing secret", (await get("/api/cron/daily")).status === 401);
  const post = (path: string, body: unknown, cookie?: string) =>
    get(path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  // open mode (default): writes need no passcode, invalid input -> 400; passcode mode -> 401
  const probe = (await post("/api/companies", { domain: "not a domain" })).status;
  const open = probe !== 401;
  console.log(`      mode: ${open ? "open (no passcode)" : "passcode required"}`);
  check("invalid domain rejected (400) or guarded (401)", probe === 400 || probe === 401, `HTTP ${probe}`);
  const typo = await post("/api/companies", { domain: "ritzy.com.com" });
  check("doubled ending rejected as a typo", typo.status === 400 && /typo/.test(typo.text), typo.text.slice(0, 90));
  const twin = await post("/api/companies", { domain: "amazon.in" });
  check("same company on another domain asks first (409)", twin.status === 409 && /same_brand/.test(twin.text), twin.text.slice(0, 90));
  check("digest send endpoint is gone", (await post("/api/digests/1/send", { email: "a@b.co" })).status === 404);
  check("wrong passcode is rejected", (await post("/api/auth", { passcode: "not-the-passcode" })).status === 401);

  if (writes) {
    let cookie = "";
    if (!open) {
      const auth = await fetch(base + "/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.DEMO_PASSCODE ?? "" }) });
      cookie = (auth.headers.get("set-cookie") ?? "").split(";")[0];
      check("correct passcode sets httpOnly cookie", auth.status === 200 && /httponly/i.test(auth.headers.get("set-cookie") ?? ""));
    }
    const rf = await post(`/api/companies/${ids[0]}/refresh`, {}, cookie);
    check("refresh returns a run (or the cached one within 10 min)", rf.status === 200 && /runId/.test(rf.text), rf.text.slice(0, 80));
    const bad = await post("/api/companies", { domain: "not a domain" }, cookie);
    check("invalid domain rejected", bad.status === 400);
  }

  console.log(`\n${failures ? `FAILED: ${failures} of ${passes + failures}` : `ALL ${passes} SMOKE CHECKS PASSED`}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("SMOKE CRASHED:", e);
  process.exit(1);
});
