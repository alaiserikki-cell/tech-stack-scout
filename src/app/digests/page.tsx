import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { TOP_N, weekOfIST, type RankedAccount } from "@/lib/digest";
import { BuildDigestButton } from "@/components/client";
import { Empty, Mint, PageTitle, SkeletonPage, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Digests" };

export default function DigestsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle eyebrow="Monday digest" title={<>Who to call, <Mint>every Monday.</Mint></>} sub="Each Monday morning (India time) the top accounts to call are ranked. Open a week for its priority map; download it as an email draft or copy it as text." />
      <Suspense fallback={<SkeletonPage rows={4} />}>
        <DigestList />
      </Suspense>
    </div>
  );
}

async function DigestList() {
  await connection();
  const rows = await getDb().select().from(schema.digests).orderBy(desc(schema.digests.weekOf)).limit(52);
  const thisWeek = weekOfIST();
  const hasThisWeek = rows.some((r) => r.weekOf === thisWeek);
  return (
    <div className="space-y-4">
      {!hasThisWeek && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line bg-surface/60 p-5">
          <p className="text-sm text-muted">This week&apos;s digest is built on Monday. Want a preview now?</p>
          <BuildDigestButton />
        </div>
      )}
      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((d, idx) => {
            const ranked = (d.rankedAccounts as RankedAccount[]).slice(0, TOP_N);
            const lead = ranked[0];
            return (
              <li key={d.id}>
                <Link href={`/digests/${d.id}`} className="group block rounded-2xl border border-line bg-surface p-5 text-ink no-underline shadow-card transition-colors hover:border-accent/50">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-faint">{idx === 0 && d.weekOf === thisWeek ? "This week" : "Week of"}</p>
                      <p className="font-display text-lg font-bold tracking-tight">{fmtDate(d.weekOf)}</p>
                    </div>
                    <div className="flex -space-x-2">
                      {ranked.map((a) => (
                        <span key={a.companyId} title={a.name} className="grid h-9 w-9 place-items-center rounded-full border-2 border-surface bg-accent-soft font-display text-xs font-bold text-accent-ink">
                          {a.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2)}
                        </span>
                      ))}
                    </div>
                  </div>
                  {lead && (
                    <p className="mt-3 text-sm text-muted">
                      <span className="font-semibold text-ink">1. {lead.name}</span> · {lead.whyNow}
                    </p>
                  )}
                  <p className="mt-3 text-sm font-semibold text-accent-ink group-hover:underline">Open priority map →</p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty title="No digests yet." />
      )}
    </div>
  );
}
