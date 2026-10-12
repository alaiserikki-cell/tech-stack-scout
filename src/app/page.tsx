import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { loadProfile } from "@/lib/repo";
import { latestSnapshotsByCompany } from "@/lib/queries";
import { liveScores } from "@/lib/scores";
import Link from "next/link";
import type { ReactNode } from "react";
import { FIT_COMPONENTS, FIT_WEIGHTS } from "@/lib/compute";
import { Eyebrow, FitRing, Skeleton, cx } from "@/components/ui";

export const metadata: Metadata = { title: { absolute: "FlakeGuard: know how every account builds" } };

/* ---------- small building blocks ---------- */

function Band({ tone, id, children }: { tone: "mint" | "butter" | "peach" | "plain"; id?: string; children: ReactNode }) {
  const bg = { mint: "bg-band-mint", butter: "bg-band-butter", peach: "bg-band-peach", plain: "" }[tone];
  return (
    <section id={id} className={cx("mx-[calc(50%-50vw)] scroll-mt-24 px-4 py-14 sm:py-20", bg)}>
      <div className="mx-auto max-w-5xl">{children}</div>
    </section>
  );
}

function Heading({ title, sub }: { title: ReactNode; sub?: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <h2 className="font-display text-3xl font-bold tracking-[-0.025em] text-ink sm:text-[44px] sm:leading-[1.05]">{title}</h2>
      {sub && <p className="mt-3 text-base text-muted sm:text-lg">{sub}</p>}
    </div>
  );
}

function Icon({ d, tone = "mint" }: { d: string; tone?: "mint" | "butter" | "peach" | "sky" }) {
  const bg = { mint: "bg-accent-soft text-accent-ink", butter: "bg-band-butter text-warn", peach: "bg-band-peach text-bad", sky: "bg-surface-2 text-ink" }[tone];
  return (
    <span className={cx("grid h-12 w-12 place-items-center rounded-2xl", bg)} aria-hidden>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}

const I = {
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  check: "M20 6 9 17l-5-5",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
  code: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  briefcase: "M3 7h18v13H3zM8 7V4h8v3",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
};

/* ---------- page ---------- */

export default function Landing() {
  return (
    <div className="-mt-8 sm:-mt-10">
      {/* hero */}
      <Band tone="plain">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>Account intelligence for sales</Eyebrow>
          <h1 className="mt-5 font-display text-[36px] font-bold leading-[1.04] tracking-[-0.03em] text-ink sm:text-[56px]">
            From a domain to a <span className="text-accent-ink">call-ready brief.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted sm:text-lg">
            FlakeGuard reads what a company publishes about how it builds software, checks every fact against its source, and turns it into a brief you can read in a minute.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/watchlist" className="rounded-xl bg-btn px-5 py-3 text-sm font-semibold text-btn-fg no-underline shadow-sm">
              Open the watchlist →
            </Link>
            <a href="#steps" className="rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink no-underline">
              See how it works
            </a>
          </div>
        </div>
      </Band>

      <Suspense fallback={<Skeleton className="mx-auto mb-4 h-28 max-w-5xl" />}>
        <RightNow />
      </Suspense>

      {/* problem */}
      <Band tone="peach">
        <Heading title="Sound familiar?" sub="Nikhil sells to engineering teams. His close rate is 30% higher when he mentions something real about how the company builds." />
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["“What do they even build with?”", "Twenty accounts this sprint, and no idea which ones run the CI and test setup his product needs."],
            ["“Two to three hours of digging.”", "Engineering blogs, job posts, GitHub, conference talks: tabs everywhere, none of it in the CRM."],
            ["“Fifteen minutes of discovery.”", "Without that prep, the first call opens with basics a well-prepared rep should already know."],
          ].map(([q, t]) => (
            <div key={q} className="rounded-2xl bg-surface p-6 shadow-card">
              <p className="font-display text-lg font-bold text-ink">{q}</p>
              <p className="mt-2 text-sm text-muted">{t}</p>
            </div>
          ))}
        </div>
      </Band>

      {/* steps */}
      <Band tone="butter" id="steps">
        <Heading title="Four steps. Fully automatic." sub="Add a company once; it stays current every week." />
        <ol className="relative grid gap-4 md:grid-cols-4">
          <span aria-hidden className="absolute left-[12%] right-[12%] top-[52px] hidden h-0.5 bg-accent/40 md:block" />
          {[
            { n: 1, icon: I.plus, tone: "mint" as const, title: "Add a company", text: "Type a domain, or add a row in the database. That's the only manual step." },
            { n: 2, icon: I.search, tone: "butter" as const, title: "We collect public signals", text: "GitHub, job boards, engineering blog, conference talks, Hacker News and DNS, with every fact saved alongside its link." },
            { n: 3, icon: I.shield, tone: "peach" as const, title: "We verify and score", text: "Code checks each source belongs to the company, then computes a fit score and an evidence score." },
            { n: 4, icon: I.doc, tone: "sky" as const, title: "You get a brief", text: "An opener, key points, a stack map and questions to ask, each linked to its source. Mondays bring a ranked digest." },
          ].map((s) => (
            <li key={s.n} className="relative rounded-2xl bg-surface p-6 text-center shadow-card">
              <span className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full bg-btn font-display text-xs font-bold text-btn-fg">{s.n}</span>
              <div className="mx-auto w-fit">
                <Icon d={s.icon} tone={s.tone} />
              </div>
              <h3 className="mt-4 font-display text-lg font-bold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </Band>

      {/* scores */}
      <Band tone="plain" id="scores">
        <Heading title={<>Two scores, <span className="text-accent-ink">two questions.</span></>} sub="One tells you whether the account fits what you sell. The other tells you how much to trust what we found." />
        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-accent/40 bg-surface p-6 shadow-card">
            <div className="flex items-center gap-3">
              <Icon d={I.target} />
              <div>
                <h3 className="font-display text-xl font-bold text-ink">Fit score</h3>
                <p className="text-sm text-muted">Is this a good account for what I sell?</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted">
              Built from <Link href="/settings">your targeting</Link>: the languages, CI systems, clouds and hiring themes you care about, and how much each factor matters to you. Change them and every account re-ranks
              instantly.
            </p>
            <table className="mt-4 w-full text-left text-sm">
              <thead className="text-xs text-faint">
                <tr>
                  <th scope="col" className="pb-2 font-medium">Factor</th>
                  <th scope="col" className="pb-2 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {FIT_COMPONENTS.map((c) => (
                  <tr key={c.key} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-ink">{c.label}</span>
                      <span className="block text-xs text-faint">{c.what}</span>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-ink">{FIT_WEIGHTS[c.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-faint">Computed from verified sources only. Importance off / normal / high multiplies a factor by 0, 1 or 2; the total is scaled back to 0-100.</p>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
            <div className="flex items-center gap-3">
              <Icon d={I.shield} tone="peach" />
              <div>
                <h3 className="font-display text-xl font-bold text-ink">Evidence score</h3>
                <p className="text-sm text-muted">How sure are we about this company&apos;s stack?</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted">The same for every user: it measures the data, not your product. Low evidence means &ldquo;go check before you quote it&rdquo;.</p>
            <ul className="mt-4 space-y-3 text-sm">
              {[
                ["Verified sources", 40, "Data from a GitHub org, job board and blog that are proven to belong to the company (15 + 15 + 10). Auto-matched sources count zero until there is proof or you confirm them."],
                ["Corroboration", 25, "Share of technologies, from verified sources, confirmed by two or more independent sources."],
                ["Freshness", 20, "Refreshed in the last 7 days (10) and recent activity in the last 90 days (10)."],
                ["Breadth", 15, "3 points per verified source type with data: GitHub, jobs, blog, talks, Hacker News, hosting."],
              ].map(([t, p, d]) => (
                <li key={t as string} className="border-t border-line pt-3">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium text-ink">{t}</span>
                    <span className="font-mono tabular-nums text-ink">{p}</span>
                  </div>
                  <p className="text-xs text-faint">{d}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-faint">70+ strong · 40-69 moderate · below 40 weak.</p>
          </div>
        </div>
        <div className="mx-auto mt-6 max-w-3xl rounded-2xl bg-band-mint p-5 text-sm text-ink">
          <p className="font-display font-semibold">Reading them together</p>
          <p className="mt-1 text-muted">
            High fit + strong evidence: call this week. High fit + weak evidence: promising, but confirm the sources first. Low fit + strong evidence: we know them well, and they are not a match today.
          </p>
        </div>
      </Band>

      {/* sources */}
      <Band tone="mint" id="sources">
        <Heading title="Where every fact comes from" sub="Only public sources, only free APIs. Every claim on a brief links back to one of these." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: I.code, title: "GitHub", read: "Languages of the 10 most recently pushed repos; CI, infrastructure and test files; dependencies in manifests.", verify: "Verified when the org's own website field is the company's domain.", href: "https://docs.github.com/rest" },
            { icon: I.briefcase, title: "Job boards", read: "Greenhouse, Lever, Ashby, SmartRecruiters and Workday postings: tools required vs nice to have, and initiatives such as migrations.", verify: "Verified when the board is linked from the company's own careers page.", href: "https://developers.greenhouse.io/job-board.html" },
            { icon: I.pen, title: "Engineering blog", read: "Posts from the last 90 days. Gemini extracts tech mentions, and code keeps a mention only if its quote appears word for word in the post.", verify: "Verified when the feed is hosted on the company's own domain.", href: "https://www.rssboard.org/rss-specification" },
            { icon: I.mic, title: "Conference talks", read: "Talks on YouTube, Vimeo, InfoQ and SpeakerDeck that the company gave or owns, from the last 3 years.", verify: "Kept only when the title shows the company owns the talk.", href: "https://hn.algolia.com/api" },
            { icon: I.chat, title: "Hacker News", read: "Stories linking to the company's domain in the last 12 months, with points and comments.", verify: "Matched on the link's domain, not the name.", href: "https://hn.algolia.com/api" },
            { icon: I.globe, title: "DNS and hosting", read: "DNS records and one HTTP request reveal the public-facing host or CDN (Cloudflare, Vercel, Shopify…).", verify: "Labelled public-facing only, never the backend.", href: "https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/" },
          ].map((s) => (
            <div key={s.title} className="rounded-2xl bg-surface p-6 shadow-card">
              <Icon d={s.icon} />
              <h3 className="mt-4 font-display text-lg font-bold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm text-muted">{s.read}</p>
              <p className="mt-3 flex gap-2 text-xs text-accent-ink">
                <span aria-hidden>✓</span>
                {s.verify}
              </p>
              <a href={s.href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs">
                API documentation ↗
              </a>
            </div>
          ))}
        </div>
      </Band>

      {/* AI */}
      <Band tone="plain" id="ai">
        <Heading title={<>Facts in code. <span className="text-accent-ink">Words by Gemini.</span></>} sub="The AI never decides what is true. It only writes from facts code already collected and checked." />
        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl bg-band-mint p-6">
            <h3 className="font-display text-lg font-bold text-ink">What code does</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink">
              {[
                "Collects every fact with its source link and date",
                "Proves each source belongs to the company",
                "Computes languages, tools, confidence, both scores and what changed",
                "Rejects any AI text that names a tool not in the facts, cites a fake source, or breaks the format",
                "Skips the AI entirely when nothing changed (no tokens spent)",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <span aria-hidden className="text-accent-ink">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-band-butter p-6">
            <h3 className="font-display text-lg font-bold text-ink">What Gemini Flash does</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink">
              {[
                "Pulls tech mentions out of blog posts, each with an exact quote",
                "Writes the opener, the two-paragraph summary and the questions",
                "Cites the source of every claim it makes",
                "Only ever sees facts from verified sources",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <span aria-hidden>✎</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Band>

      {/* audience */}
      <Band tone="peach" id="audience">
        <Heading title="Built for people who sell to engineers" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["“I have twenty accounts and one afternoon.”", "Account executives", "Know each company's stack and what changed before the first call."],
            ["“I need their CI setup before the demo.”", "Sales engineers", "See the exact CI, test and infrastructure tools, with the file they were found in."],
            ["“Who should the team call this week?”", "Sales managers", "The Monday digest ranks accounts by fit and momentum on one map."],
          ].map(([q, who, t]) => (
            <div key={who} className="rounded-2xl bg-surface p-6 shadow-card">
              <p className="font-display text-base font-bold text-ink">{q}</p>
              <p className="mt-4 text-sm font-semibold text-accent-ink">{who}</p>
              <p className="mt-1 text-sm text-muted">{t}</p>
            </div>
          ))}
        </div>
      </Band>

      {/* cost + CTA */}
      <Band tone="plain">
        <div className="mx-auto max-w-3xl rounded-3xl bg-btn p-8 text-center text-btn-fg sm:p-12">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Runs on free tiers. Costs ₹0.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm opacity-80">
            Vercel Hobby, Neon Postgres, Gemini Flash free tier, public APIs that need no paid key, and a once-a-day refresh. Briefs are only rewritten when something actually changed.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/watchlist#add" className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-fg no-underline">
              Add a company
            </Link>
            <Link href="/settings" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold text-btn-fg no-underline">
              Set your targeting
            </Link>
          </div>
        </div>
      </Band>
    </div>
  );
}

/** Live snapshot of the watchlist so the landing page leads straight into the work. */
async function RightNow() {
  await connection();
  const db = getDb();
  const [companies, snaps, profile] = await Promise.all([db.select().from(schema.watchlist).where(eq(schema.watchlist.active, true)), latestSnapshotsByCompany(), loadProfile()]);
  const now = new Date();
  const ranked = companies
    .map((c) => {
      const snap = snaps.get(c.id);
      return snap ? { c, live: liveScores(snap.computed, profile, c, now) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => b.live.fit.score - a.live.fit.score);
  if (!ranked.length) return null;
  const strong = ranked.filter((r) => r.live.evidence.label === "strong").length;
  return (
    <section aria-labelledby="now" className="mx-auto -mt-4 mb-10 max-w-5xl rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="now" className="font-display text-lg font-semibold tracking-tight text-ink">
          Right now: {ranked.length} accounts tracked · {strong} with strong evidence
        </h2>
        <Link href="/watchlist" className="text-sm font-semibold">
          See all accounts →
        </Link>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {ranked.slice(0, 3).map(({ c, live }, i) => (
          <li key={c.id}>
            <Link href={`/company/${c.id}`} className="flex items-center gap-3 rounded-xl border border-line p-3 text-ink no-underline transition-colors hover:border-accent/50">
              <span className="font-display text-xl font-bold text-faint">{i + 1}</span>
              <FitRing score={live.fit.score} size={40} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.companyName}</span>
                <span className="block text-xs text-faint capitalize">evidence {live.evidence.score} · {live.evidence.label}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
