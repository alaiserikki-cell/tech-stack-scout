import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { RankedAccount } from "@/lib/digest";
import { weekOfIST } from "@/lib/digest";
import { BuildDigestButton } from "@/components/client";
import { Card, Empty, Mint, PageTitle, SkeletonPage, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Digests" };

export default function DigestsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle eyebrow="Monday digest" title={<>Who to call, <Mint>every Monday.</Mint></>} sub="Every Monday (India time) the daily job ranks which accounts to call this week and emails it. Ranking is computed in code: change-event weight plus fit score." />
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
  return (
    <div className="space-y-4">
      {!rows.some((r) => r.weekOf === thisWeek) && (
        <Card>
          <p className="mb-3 text-sm text-muted">This week&apos;s digest has not been built yet. It is built automatically on Monday; you can build it now to preview.</p>
          <BuildDigestButton />
        </Card>
      )}
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((d) => {
            const ranked = d.rankedAccounts as RankedAccount[];
            return (
              <li key={d.id}>
                <Link href={`/digests/${d.id}`} className="block rounded-xl border border-line bg-surface p-4 text-ink no-underline hover:border-accent">
                  <p className="font-medium">Week of {fmtDate(d.weekOf)}</p>
                  <p className="mt-1 text-sm text-muted">
                    {ranked.length} accounts: {ranked.map((r) => r.name).join(", ") || "none"}
                  </p>
                  <p className="mt-1 text-xs text-faint">Email: {d.emailStatus.replace("_", " ")}</p>
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
