// Crawls every page of a deployed instance and checks every link on it.
// Internal links must return 2xx/3xx. External links are checked too; sites that block bots (401/403/429)
// are reported separately as "blocked", not as broken.
// Usage: npx tsx scripts/linkcheck.ts [baseUrl]
import "dotenv/config";

const base = (process.argv[2] ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const UA = "Mozilla/5.0 (FlakeGuard link check)";

async function status(url: string, method: "HEAD" | "GET" = "HEAD"): Promise<number> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    const r = await fetch(url, { method, redirect: "follow", headers: { "user-agent": UA }, signal: ac.signal });
    clearTimeout(t);
    if (method === "HEAD" && (r.status === 405 || r.status === 404 || r.status === 403)) return status(url, "GET");
    return r.status;
  } catch {
    return method === "HEAD" ? status(url, "GET") : 0;
  }
}

/** Hacker News throttles bursts of page requests (HTTP 419), so HN items are checked through HN's official API. */
async function checkExternal(url: string): Promise<number> {
  const hn = url.match(/^https:\/\/news\.ycombinator\.com\/item\?id=(\d+)$/);
  if (hn) {
    const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${hn[1]}.json`).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    return j && !j.deleted && !j.dead ? 200 : 404;
  }
  return status(url);
}

function links(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"#][^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

async function main() {
  const pages = new Set<string>(["/", "/watchlist", "/digests", "/activity", "/settings"]);
  const seen = new Set<string>();
  const internal = new Map<string, Set<string>>(); // link -> pages it appears on
  const external = new Map<string, Set<string>>();
  const queue = [...pages];
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const res = await fetch(base + p, { headers: { "user-agent": UA } });
    const html = await res.text();
    if (res.status >= 400) console.log(`PAGE FAIL ${p} -> ${res.status}`);
    for (const href of links(html)) {
      if (href.startsWith("mailto:")) continue;
      if (href.startsWith("/")) {
        const path = href.split("#")[0];
        if (!path) continue;
        (internal.get(path) ?? internal.set(path, new Set()).get(path)!).add(p);
        // crawl app pages (company briefs and digests too), not API routes
        if (!path.startsWith("/api") && !seen.has(path) && /^\/(watchlist|digests|activity|settings|company\/\d+|digests\/\d+)?$/.test(path)) queue.push(path);
      } else if (/^https?:\/\//.test(href)) {
        (external.get(href) ?? external.set(href, new Set()).get(href)!).add(p);
      }
    }
  }
  console.log(`Crawled ${seen.size} pages; ${internal.size} internal links, ${external.size} external links\n`);

  let broken = 0;
  for (const [href, on] of internal) {
    const s = await status(base + href, "GET");
    if (s === 0 || s >= 400) {
      broken++;
      console.log(`BROKEN internal ${href} -> ${s} (on ${[...on].slice(0, 3).join(", ")})`);
    }
  }
  const blocked: string[] = [];
  const ext = [...external.keys()];
  for (let i = 0; i < ext.length; i += 8) {
    const batch = ext.slice(i, i + 8);
    const res = await Promise.all(batch.map((u) => checkExternal(u)));
    batch.forEach((u, j) => {
      const s = res[j];
      if ([401, 403, 419, 429, 999].includes(s)) blocked.push(`${s} ${u}`);
      else if (s === 0 || s >= 400) {
        broken++;
        console.log(`BROKEN external ${u} -> ${s} (on ${[...external.get(u)!].slice(0, 2).join(", ")})`);
      }
    });
  }
  if (blocked.length) console.log(`\n${blocked.length} external links refused automated checks (bot protection), not counted as broken:\n  ${blocked.slice(0, 15).join("\n  ")}`);
  console.log(`\n${broken ? `FOUND ${broken} BROKEN LINKS` : `ALL ${internal.size + external.size - blocked.length} CHECKED LINKS WORK`}`);
  process.exit(broken ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
