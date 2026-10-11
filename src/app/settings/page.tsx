import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { loadProfile } from "@/lib/repo";
import { isAuthed } from "@/lib/auth";
import { PasscodeForm, ProfileEditor, VerifyButton } from "@/components/client";
import { Card, H2, PageTitle, SkeletonPage } from "@/components/ui";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="Settings" sub="The product profile shapes fit scores and briefs. Entries marked verify are excluded from matching until verified." />
      <Suspense fallback={<SkeletonPage rows={6} />}>
        <SettingsData />
      </Suspense>
    </div>
  );
}

async function SettingsData() {
  await connection();
  const [profile, unverified, authed] = await Promise.all([
    loadProfile(),
    getDb().select().from(schema.techDictionary).where(eq(schema.techDictionary.verify, true)),
    isAuthed(),
  ]);
  const unverifiedCompetitors = profile.competitors_and_adjacent.filter((c) => c.verify);
  return (
    <div className="space-y-6">
      {!authed && (
        <Card>
          <p className="mb-2 text-sm text-muted">Reading is open. Saving changes needs the demo passcode.</p>
          <PasscodeForm />
        </Card>
      )}
      <Card>
        <H2>Entries waiting for verification</H2>
        {unverified.length || unverifiedCompetitors.length ? (
          <ul className="divide-y divide-line">
            {unverified.map((d) => (
              <li key={d.canonicalName} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {d.canonicalName} <span className="text-xs font-normal text-faint">dictionary · {d.category}</span>
                  </p>
                  <p className="break-words text-xs text-muted">
                    Files: {d.detectionFiles.join(", ") || "none"} · Packages: {d.dependencyNames.join(", ") || "none"} · Aliases: {d.aliases.join(", ")}
                  </p>
                </div>
                <VerifyButton type="dictionary" name={d.canonicalName} />
              </li>
            ))}
            {unverifiedCompetitors.map((c) => (
              <li key={c.name} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {c.name} <span className="text-xs font-normal text-faint">competitor</span>
                  </p>
                  <p className="break-words text-xs text-muted">Detection: {c.detection.join(", ") || "none"}</p>
                </div>
                <VerifyButton type="competitor" name={c.name} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Everything is verified.</p>
        )}
      </Card>
      <Card>
        <H2>Product profile</H2>
        <ProfileEditor initial={JSON.stringify(profile, null, 2)} />
      </Card>
    </div>
  );
}
