// End-to-end smoke test against a deployed instance (read-only unless --writes is passed).
// Usage: npx tsx scripts/smoke.ts [baseUrl] [--writes]
// --writes also logs in with DEMO_PASSCODE from .env and checks the guarded write endpoints
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
  for (const p of ["/", "/digests", "/system", "/costs", "/how-it-works", "/settings"]) {
    const r = await get(p);
    check(`GET ${p}`, r.status === 200 && !/Application error|Internal Server Error/.test(r.text), `HTTP ${r.status}`);
  }
  const home = await get("/");
  const ids = [...new Set([...home.text.matchAll(/\/company\/(\d+)/g)].map((m) => Number(m[1])))];
  check("watchlist lists companies", ids.length > 0, `${ids.length} companies`);
  for (const id of ids.slice(0, 3)) {
    const r = await get(`/company/${id}`);
    check(`GET /company/${id}`, r.status === 200 && /Evidence/.test(r.text), `HTTP ${r.status}`);
  }

  // api
  const run = await get("/api/runs/1");
  check("GET /api/runs/1 returns JSON", run.status === 200 && /"status"/.test(run.text));
  check("GET /api/runs/999999 is 404", (await get("/api/runs/999999")).status === 404);
  check("cron rejects missing secret", (await get("/api/cron/daily")).status === 401);
  const post = (path: string, body: unknown, cookie?: string) =>
    get(path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  check("add company without passcode is 401", (await post("/api/companies", { domain: "example.com" })).status === 401);
  check("refresh without passcode is 401", (await post(`/api/companies/${ids[0] ?? 1}/refresh`, {})).status === 401);
  check("wrong passcode is rejected", (await post("/api/auth", { passcode: "not-the-passcode" })).status === 401);

  if (writes) {
    const pass = process.env.DEMO_PASSCODE ?? "";
    const auth = await fetch(base + "/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: pass }) });
    const cookie = (auth.headers.get("set-cookie") ?? "").split(";")[0];
    check("correct passcode sets httpOnly cookie", auth.status === 200 && /httponly/i.test(auth.headers.get("set-cookie") ?? ""));
    const rf = await post(`/api/companies/${ids[0]}/refresh`, {}, cookie);
    check("refresh with passcode returns a run", rf.status === 200 && /runId/.test(rf.text), rf.text.slice(0, 80));
    const bad = await post("/api/companies", { domain: "not a domain" }, cookie);
    check("invalid domain rejected", bad.status === 400);
    const em = await post("/api/digests/1/send", { email: "nope" }, cookie);
    check("invalid email rejected", em.status === 400);
  }

  console.log(`\n${failures ? `FAILED: ${failures} of ${passes + failures}` : `ALL ${passes} SMOKE CHECKS PASSED`}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("SMOKE CRASHED:", e);
  process.exit(1);
});
