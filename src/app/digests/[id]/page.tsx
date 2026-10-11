import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { digestSubject, type RankedAccount } from "@/lib/digest";
import { EmailDigestForm } from "@/components/client";
import { Card, Ext, H2, SkeletonPage, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Digest" };

export default function DigestPage(props: PageProps<"/digests/[id]">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<SkeletonPage rows={5} />}>
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
  const ranked = d.rankedAccounts as RankedAccount[];
  const sends = await db.select({ status: schema.digestSends.status, sentAt: schema.digestSends.sentAt }).from(schema.digestSends).where(eq(schema.digestSends.digestId, id));
  return (
    <div className="space-y-6">
      <div>
        <Link href="/digests" className="text-sm text-muted no-underline hover:underline">
          ← Digests
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Who to call this week</h1>
        <p className="text-sm text-muted">
          Week of {fmtDate(d.weekOf)} · subject “{digestSubject(ranked.length, d.weekOf)}”
        </p>
      </div>
      <ol className="space-y-3">
        {ranked.map((a, i) => (
          <li key={a.companyId} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium">
                {i + 1}. {a.name}
              </p>
              <p className="font-mono text-sm tabular-nums text-muted">fit {a.fitScore}</p>
            </div>
            <p className="mt-1 text-sm text-muted">
              {a.whyNow} {a.evidenceUrl && <Ext href={a.evidenceUrl}>evidence</Ext>}
            </p>
            <Link href={`/company/${a.companyId}`} className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg no-underline">
              View brief
            </Link>
          </li>
        ))}
        {!ranked.length && <p className="text-sm text-muted">No accounts with snapshots when this digest was built.</p>}
      </ol>
      <Card>
        <H2>The email itself</H2>
        <p className="mb-3 text-sm text-muted">This is exactly what lands in Nikhil's inbox every Monday (subject above).</p>
        <iframe
          title="Digest email preview"
          srcDoc={d.html}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="h-[620px] w-full rounded-lg border border-line bg-white"
        />
      </Card>
      <Card>
        <H2>Email</H2>
        <EmailDigestForm digestId={d.id} />
        <p className="mt-3 text-xs text-faint">
          Scheduled email: {d.emailStatus.replace("_", " ")} · {sends.filter((s) => s.status === "sent").length} sends recorded
        </p>
      </Card>
    </div>
  );
}
