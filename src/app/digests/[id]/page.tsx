import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { TOP_N, digestSubject, digestText, type RankedAccount } from "@/lib/digest";
import { CopyTextButton } from "@/components/client";
import { Ext, FitRing, Mint, SkeletonPage, cx, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Digest" };

const WHY_LABEL: Record<string, string> = {
  new_initiative: "New initiative",
  hiring_spike: "Hiring spike",
  new_tech: "New tech",
  dropped_tech: "Dropped tech",
  new_blog_post: "New blog post",
  new_hn_story: "On Hacker News",
  new_talk: "New talk",
};

export default function DigestPage(props: PageProps<"/digests/[id]">) {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<SkeletonPage rows={6} />}>
        <Digest {...props} />
      </Suspense>
    </div>
  );
}

async function Digest({ params }: PageProps<"/digests/[id]">) {
  await connection();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const [d] = await db.select().from(schema.digests).where(eq(schema.digests.id, id));
  if (!d) notFound();
  const all = d.rankedAccounts as RankedAccount[];
  const top = all.slice(0, TOP_N);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/digests" className="text-sm text-muted no-underline hover:text-ink">
          ← All digests
        </Link>
        <p className="mt-4 text-sm font-medium text-faint">Week of {fmtDate(d.weekOf)}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-[-0.025em] text-ink sm:text-[40px]">
          Who to call <Mint>this week.</Mint>
        </h1>
        <p className="mt-2 text-sm text-muted">Ranked by fit; changes from the last 7 days add up to 10 points, so they break near-ties. Computed in code, no AI.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a href={`/api/digests/${d.id}/eml`} download className="rounded-lg bg-btn px-3 py-2 text-sm font-medium text-btn-fg no-underline">
            Download as email draft
          </a>
          <CopyTextButton text={`Subject: ${digestSubject(top.length, d.weekOf)}

${digestText(all, d.weekOf, process.env.APP_URL?.replace(/\/$/, ""))}`} label="Copy as text" />
        </div>
      </div>

      <PriorityMap accounts={all} />

      <section aria-labelledby="top">
        <h2 id="top" className="mb-3 font-display text-lg font-semibold tracking-tight text-ink">
          Top {top.length} to call
        </h2>
        <ol className="space-y-3">
          {top.map((a, i) => (
            <li key={a.companyId} className="flex items-start gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
              <span className="font-display text-3xl font-bold leading-none text-accent-ink tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/company/${a.companyId}`} className="font-display text-lg font-semibold text-ink no-underline hover:underline">
                    {a.name}
                  </Link>
                  {a.whyType ? (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-ink">{WHY_LABEL[a.whyType] ?? "Change"}</span>
                  ) : (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">Strong fit</span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-snug text-muted">
                  {a.whyNow}
                  {a.evidenceUrl && (
                    <>
                      {" "}
                      <Ext href={a.evidenceUrl} className="whitespace-nowrap">
                        source
                      </Ext>
                    </>
                  )}
                </p>
                <Link href={`/company/${a.companyId}`} className="mt-3 inline-block rounded-lg bg-btn px-3 py-1.5 text-sm font-semibold text-btn-fg no-underline">
                  View brief
                </Link>
              </div>
              <FitRing score={a.fitScore} size={48} />
            </li>
          ))}
          {!top.length && <p className="text-sm text-muted">No accounts with briefs when this digest was built.</p>}
        </ol>
      </section>

    </div>
  );
}

// grid order: top-left, top-right, bottom-left, bottom-right (up = changed this week, right = stronger fit)
const QUADRANTS = [
  { label: "Watch", sub: "changing, weaker fit", strong: false },
  { label: "Call now", sub: "strong fit + something changed", strong: true },
  { label: "Later", sub: "weaker fit, quiet week", strong: false },
  { label: "Nurture", sub: "strong fit, quiet week", strong: false },
];

/** Push overlapping dots apart vertically so every account stays visible and tappable. */
function spread<T extends { x: number; y: number }>(pts: T[]): T[] {
  const placed: T[] = [];
  for (const p of [...pts].sort((a, b) => a.y - b.y)) {
    let y = p.y;
    for (let guard = 0; guard < 12 && placed.some((q) => Math.abs(q.x - p.x) < 7 && Math.abs(q.y - y) < 10); guard++) y += 10;
    placed.push({ ...p, y: Math.min(88, y) });
  }
  return placed;
}

/** 2×2 priority map: fit score (right = stronger) vs this week's change weight (up = more changed). Plain HTML. */
function PriorityMap({ accounts }: { accounts: RankedAccount[] }) {
  if (!accounts.length) return null;
  const momentum = (a: RankedAccount) => a.momentum ?? Math.max(0, a.score - a.fitScore);
  const maxM = Math.max(10, ...accounts.map(momentum));
  const pts = spread(
    accounts.map((a, i) => ({
      ...a,
      rank: i + 1,
      x: Math.min(93, Math.max(7, a.fitScore)),
      y: 10 + 78 * Math.sqrt(momentum(a) / maxM),
    })),
  );
  return (
    <section aria-labelledby="map" className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="map" className="font-display text-lg font-semibold tracking-tight text-ink">
          Priority map
        </h2>
        <span className="text-xs text-faint">→ fit score · ↑ what changed this week · {accounts.length} accounts</span>
      </div>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-line sm:aspect-[16/8]">
        <div aria-hidden className="absolute inset-0 grid grid-cols-2 grid-rows-2">
          {QUADRANTS.map((q) => (
            <div key={q.label} className={cx("grid place-items-center text-center", q.strong ? "bg-accent-soft/60" : "bg-surface-2/30")}>
              <div className="px-2">
                <p className={cx("font-display text-lg font-bold sm:text-2xl", q.strong ? "text-accent-ink/70" : "text-faint/50")}>{q.label}</p>
                <p className="hidden text-[11px] text-faint/70 sm:block">{q.sub}</p>
              </div>
            </div>
          ))}
        </div>
        <div aria-hidden className="absolute inset-y-0 left-1/2 border-l border-dashed border-line" />
        <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
        {pts.map((p) => (
          <Link
            key={p.companyId}
            href={`/company/${p.companyId}`}
            aria-label={`${p.name}: fit ${p.fitScore}. ${p.whyNow}`}
            title={`${p.name}: fit ${p.fitScore}. ${p.whyNow}`}
            className="group absolute -translate-x-1/2 translate-y-1/2 no-underline"
            style={{ left: `${p.x}%`, bottom: `${p.y}%` }}
          >
            <span
              className={cx(
                "grid h-8 w-8 place-items-center rounded-full border-2 border-surface font-display text-[11px] font-bold shadow-sm transition-transform group-hover:scale-110",
                p.rank <= TOP_N ? "bg-accent text-accent-fg" : "bg-surface text-muted ring-1 ring-line",
              )}
            >
              {p.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2)}
            </span>
            <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-btn px-1.5 py-0.5 text-[11px] font-medium text-btn-fg group-hover:block group-focus:block">
              {p.name}
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-faint">Mint dots are this week&apos;s top {TOP_N}. Tap a dot to open its brief.</p>
    </section>
  );
}
