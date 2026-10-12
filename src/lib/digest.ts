import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { ChangeEvent, Computed } from "./compute";
import { RecipientRestrictedError, sendMail } from "./email";
import { fitScore } from "./compute";
import { loadProfile } from "./repo";

export interface RankedAccount {
  companyId: number;
  name: string;
  domain: string;
  fitScore: number;
  score: number;
  whyNow: string;
  whyType?: string | null;
  momentum?: number;
  evidenceUrl: string | null;
}

const DAY = 86_400_000;

/** Monday (YYYY-MM-DD) of the current week in Asia/Kolkata. */
export function weekOfIST(d = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(ist.getTime() - dow * DAY);
  return monday.toISOString().slice(0, 10);
}

export function isMondayIST(d = new Date()): boolean {
  return new Date(d.getTime() + 5.5 * 3600_000).getUTCDay() === 1;
}

/**
 * Ranking (code only, no Gemini): score = sum of change-event weights from the past 7 days + fit score.
 * "Why now" is the strongest change event; if nothing changed, the top fit reason.
 */
export function rankAccounts(
  rows: { companyId: number; name: string; domain: string; fitScore: number; events: ChangeEvent[]; computed: Computed | null; generatedAt: Date }[],
  now = new Date(),
): RankedAccount[] {
  return rows
    .map((r) => {
      const recent = r.events.filter((e) => now.getTime() - Date.parse(e.date) <= 7 * DAY || now.getTime() - r.generatedAt.getTime() <= 7 * DAY);
      const top = [...recent].sort((a, b) => b.weight - a.weight)[0];
      const eventScore = recent.reduce((a, e) => a + e.weight, 0);
      const reason = r.computed?.fit.reasons[0]?.reason;
      return {
        companyId: r.companyId,
        name: r.name,
        domain: r.domain,
        fitScore: r.fitScore,
        score: eventScore + r.fitScore,
        momentum: eventScore,
        whyType: top?.type ?? null,
        whyNow: top ? top.title : reason ? `No new changes this week. Strongest fit signal: ${reason}.` : "No new changes this week.",
        evidenceUrl: top?.evidenceUrl ?? null,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** The email and the list show the top 5; the priority map plots every account. */
export const TOP_N = 5;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function digestSubject(n: number, weekOf: string): string {
  const d = new Date(weekOf + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `[Who to call this week] ${n} accounts · ${d}`;
}

export function renderDigestHtml(accounts: RankedAccount[], weekOf: string, appUrl: string): string {
  const rows = accounts
    .slice(0, TOP_N)
    .map(
      (a, i) => `
  <tr><td style="padding:16px 0;border-bottom:1px solid #e4e4e7">
    <div style="font:600 16px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">${i + 1}. ${esc(a.name)} <span style="font-weight:400;color:#71717a">· fit ${a.fitScore}</span></div>
    <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#3f3f46;margin-top:4px">${esc(a.whyNow)}${a.evidenceUrl ? ` <a href="${esc(a.evidenceUrl)}" style="color:#2952cc">evidence</a>` : ""}</div>
    <a href="${esc(appUrl)}/company/${a.companyId}" style="display:inline-block;margin-top:8px;padding:6px 12px;border-radius:6px;background:#2952cc;color:#fff;text-decoration:none;font:500 13px -apple-system,Segoe UI,Roboto,sans-serif">View brief</a>
  </td></tr>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#fafafa">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:8px 24px">
  <tr><td style="padding:16px 0 4px;font:600 18px -apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">Who to call this week</td></tr>
  <tr><td style="padding-bottom:8px;font:400 13px -apple-system,Segoe UI,Roboto,sans-serif;color:#71717a">Week of ${esc(weekOf)} · ranked by what changed plus fit score</td></tr>
  ${rows || `<tr><td style="padding:16px 0;color:#71717a">No accounts on the watchlist yet.</td></tr>`}
  <tr><td style="padding:16px 0;font:400 12px -apple-system,Segoe UI,Roboto,sans-serif;color:#a1a1aa">FlakeGuard · facts collected from public GitHub, job boards, blogs, Hacker News and DNS</td></tr>
</table></body></html>`;
}

export async function buildDigest(weekOf = weekOfIST()): Promise<typeof schema.digests.$inferSelect> {
  const db = getDb();
  const companies = await db.select().from(schema.watchlist).where(eq(schema.watchlist.active, true));
  const profile = await loadProfile(); // fit follows the current targeting in Settings
  const rows = [];
  for (const c of companies) {
    const [s] = await db.select().from(schema.snapshots).where(eq(schema.snapshots.companyId, c.id)).orderBy(desc(schema.snapshots.generatedAt)).limit(1);
    if (!s) continue;
    rows.push({ companyId: c.id, name: c.companyName, domain: c.domain, fitScore: fitScore(s.computed as Computed, profile).score, events: (s.changeEvents as ChangeEvent[]) ?? [], computed: s.computed as Computed, generatedAt: s.generatedAt });
  }
  const ranked = rankAccounts(rows);
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const html = renderDigestHtml(ranked, weekOf, appUrl);
  const [d] = await db
    .insert(schema.digests)
    .values({ weekOf, rankedAccounts: ranked, html })
    .onConflictDoUpdate({ target: schema.digests.weekOf, set: { rankedAccounts: ranked, html, createdAt: sql`now()` } })
    .returning();
  return d;
}

export const hashRecipient = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);

export async function sendDigest(digestId: number, to: string): Promise<"sent" | "failed" | "restricted"> {
  const db = getDb();
  const [d] = await db.select().from(schema.digests).where(eq(schema.digests.id, digestId));
  if (!d) throw new Error("digest not found");
  const ranked = d.rankedAccounts as RankedAccount[];
  let status: "sent" | "failed" | "restricted" = "sent";
  try {
    await sendMail(to, digestSubject(Math.min(TOP_N, ranked.length), d.weekOf), d.html);
  } catch (e) {
    status = e instanceof RecipientRestrictedError ? "restricted" : "failed";
  }
  await db.insert(schema.digestSends).values({ digestId, recipient: hashRecipient(to), status });
  return status;
}
