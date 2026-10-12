import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { loadDictionary, loadProfile } from "@/lib/repo";
import { isAuthed } from "@/lib/auth";
import { FIT_COMPONENTS } from "@/lib/compute";
import { latestSnapshotsByCompany } from "@/lib/queries";
import { liveScores } from "@/lib/scores";
import { PasscodeForm, VerifyButton } from "@/components/client";
import { TargetingForm } from "@/components/targeting-form";
import { Card, FitRing, H2, Mint, PageTitle, SkeletonPage } from "@/components/ui";

export const metadata: Metadata = { title: "Targeting" };

const COMMON_LANGS = ["Go", "Java", "Kotlin", "Python", "TypeScript", "JavaScript", "Ruby", "C#", "Rust", "Scala", "PHP", "Swift", "C++", "Elixir"];

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle
        eyebrow="Targeting"
        title={
          <>
            Tell us what you sell. <Mint>We rank who fits.</Mint>
          </>
        }
        sub="Your answers drive the fit score on every account, the Monday ranking, and the angle of every opener. Change anything and the dashboard re-ranks instantly."
      />
      <Suspense fallback={<SkeletonPage rows={6} />}>
        <SettingsData />
      </Suspense>
    </div>
  );
}

async function SettingsData() {
  await connection();
  const db = getDb();
  const [profile, dict, unverified, authed, companies, snaps] = await Promise.all([
    loadProfile(),
    loadDictionary(),
    db.select().from(schema.techDictionary).where(eq(schema.techDictionary.verify, true)),
    isAuthed(),
    db.select().from(schema.watchlist).where(eq(schema.watchlist.active, true)),
    latestSnapshotsByCompany(),
  ]);
  const names = (cat: string) => dict.filter((d) => d.category === cat && !d.verify).map((d) => d.canonical_name);
  const langs = names("language");
  const options = {
    languages: [...COMMON_LANGS.filter((l) => langs.includes(l)), ...profile.target_languages.filter((l) => !COMMON_LANGS.includes(l))],
    ci: names("ci").filter((n) => !["Renovate", "Dependabot", "pre-commit", "Codecov", "SonarQube"].includes(n)),
    clouds: names("cloud").filter((n) => !["AWS Lambda", "Amazon ECS", "Amazon EKS", "Google Kubernetes Engine"].includes(n)),
    themes: names("pattern"),
    components: FIT_COMPONENTS,
  };
  const now = new Date();
  const ranked = companies
    .map((c) => {
      const s = snaps.get(c.id);
      return s ? { c, live: liveScores(s.computed, profile, c, now) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => b.live.fit.score - a.live.fit.score);
  const unverifiedCompetitors = profile.competitors_and_adjacent.filter((c) => c.verify);

  return (
    <div className="space-y-6">
      {!authed && (
        <Card>
          <p className="mb-2 text-sm text-muted">Reading is open. Saving changes needs the demo passcode.</p>
          <PasscodeForm />
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <TargetingForm profile={profile} options={options} />
        </Card>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <H2>Best matches right now</H2>
            <ol className="space-y-2">
              {ranked.slice(0, 6).map(({ c, live }, i) => (
                <li key={c.id} className="flex items-center gap-3">
                  <span className="w-4 text-right font-display text-sm font-bold text-faint">{i + 1}</span>
                  <FitRing score={live.fit.score} size={34} />
                  <Link href={`/company/${c.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-ink no-underline hover:underline">
                    {c.companyName}
                  </Link>
                  <span className="text-[11px] text-faint">info {live.info.score}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-faint">Fit with the targeting above · info = how much verified information we have. Save to re-rank.</p>
          </Card>
          <Card>
            <H2>Entries waiting for verification</H2>
            {unverified.length || unverifiedCompetitors.length ? (
              <ul className="divide-y divide-line">
                {unverified.map((d) => (
                  <li key={d.canonicalName} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{d.canonicalName}</p>
                      <p className="break-words text-xs text-muted">Detected by {d.detectionFiles.join(", ") || d.dependencyNames.join(", ") || "aliases"}; too generic to trust yet.</p>
                    </div>
                    <VerifyButton type="dictionary" name={d.canonicalName} />
                  </li>
                ))}
                {unverifiedCompetitors.map((c) => (
                  <li key={c.name} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{c.name}</p>
                      <p className="break-words text-xs text-muted">Detection {c.detection.join(", ") || "none"} not confirmed in vendor docs.</p>
                    </div>
                    <VerifyButton type="competitor" name={c.name} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Everything is verified.</p>
            )}
            <p className="mt-2 text-xs text-faint">Unverified entries are never used for matching.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
