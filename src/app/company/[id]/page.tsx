import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Brief } from "@/lib/brief";
import type { ChangeEvent, Computed, TechSummary } from "@/lib/compute";
import { companyRuns, droppedTechs, recentSnapshots } from "@/lib/queries";
import { AutoRunProgress, OpenerActions, RefreshButton, RemoveButton, SourceControl } from "@/components/client";
import { Badge, Card, Confidence, Empty, Ext, FitScore, H2, SOURCE_LABEL, Skeleton, ago, cx, fmtDate, isStale } from "@/components/ui";
import { boardUrl } from "@/collectors/jobs";

export const metadata: Metadata = { title: "Company brief" };

export default function CompanyPage(props: PageProps<"/company/[id]">) {
  return (
    <Suspense fallback={<BriefSkeleton />}>
      <CompanyBrief {...props} />
    </Suspense>
  );
}

function BriefSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5" aria-busy="true" aria-label="Loading brief">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

type SigRow = typeof schema.signals.$inferSelect;

async function CompanyBrief({ params, searchParams }: PageProps<"/company/[id]">) {
  await connection();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;
  const db = getDb();
  const [company] = await db.select().from(schema.watchlist).where(eq(schema.watchlist.id, id));
  if (!company) notFound();
  const [[snap], runs, history, dropped] = await Promise.all([
    db.select().from(schema.snapshots).where(eq(schema.snapshots.companyId, id)).orderBy(desc(schema.snapshots.generatedAt)).limit(1),
    companyRuns(id, 5),
    recentSnapshots(id, 6),
    droppedTechs(id),
  ]);
  const sigs: SigRow[] = snap?.runId ? await db.select().from(schema.signals).where(eq(schema.signals.runId, snap.runId)) : [];
  const byId = new Map(sigs.map((s) => [s.id, s]));
  const computed = snap?.computed as Computed | undefined;
  const brief = snap?.briefStatus === "ok" ? (snap.brief as Brief) : null;
  const now = new Date();
  const activeRun = runs.find((r) => ["queued", "running"].includes(r.status) && now.getTime() - r.startedAt.getTime() < 10 * 60_000);
  const runParam = Number(sp.run);
  const progressRunId = activeRun?.id ?? (Number.isInteger(runParam) && runs.some((r) => r.id === runParam && ["queued", "running"].includes(r.status)) ? runParam : null);

  const cite = (ids: number[] | undefined) => <Citations ids={ids ?? []} byId={byId} />;

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      {/* header */}
      <header className="space-y-3">
        <Link href="/" className="text-sm text-muted no-underline hover:underline">
          ← Watchlist
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{company.companyName}</h1>
            <p className="text-sm text-muted">
              <Ext href={`https://${company.domain}`}>{company.domain}</Ext>
              {computed && (
                <>
                  {" · "}
                  <span className="capitalize">{computed.activity.label}</span> activity · <span className="capitalize">{computed.coverage}</span> coverage
                </>
              )}
            </p>
          </div>
          {computed && (
            <div className="text-right">
              <p className="text-xs text-faint">Fit score</p>
              <FitScore score={computed.fit.score} reasons={computed.fit.reasons} />
            </div>
          )}
        </div>
        <p className="text-xs">
          <span className={isStale(company.lastRefreshedAt, now) ? "text-bad" : "text-muted"}>Refreshed {ago(company.lastRefreshedAt, now)}</span>
          {!company.active && <span className="text-warn"> · Removed from watchlist</span>}
        </p>
        {progressRunId != null && <AutoRunProgress runId={progressRunId} />}
      </header>

      {!snap && progressRunId == null && <Empty title="No brief yet.">Press Refresh now at the bottom of the page to collect signals and write the brief.</Empty>}

      {snap && (
        <>
          {/* opener */}
          <Card className="border-accent/30">
            <H2>Opener</H2>
            {brief?.opener ? (
              <>
                <p className="text-xl font-medium leading-snug tracking-tight sm:text-[22px]">{brief.opener}</p>
                <p className="mt-2 text-xs text-muted">Based on {cite(brief.opener_signal_ids)}</p>
                <div className="mt-4">
                  <OpenerActions snapshotId={snap.id} opener={brief.opener} />
                </div>
              </>
            ) : (
              <BriefStatusNote status={snap.briefStatus} hasBrief={Boolean(brief)} />
            )}
          </Card>

          {brief && (
            <div className="grid gap-4 sm:grid-cols-2">
              <section aria-labelledby="answered">
                <H2 id="answered">Already answered</H2>
                <ul className="space-y-2">
                  {brief.already_answered.map((a) => (
                    <li key={a.question} className="rounded-lg border border-line bg-surface p-3">
                      <p className="text-sm font-medium">{a.question}</p>
                      <p className="mt-1 text-sm text-muted">{a.answer}</p>
                      <p className="mt-1 text-xs text-faint">{cite(a.signal_ids)}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-labelledby="unknown">
                <H2 id="unknown">Still unknown</H2>
                <ul className="space-y-2">
                  {brief.still_unknown.map((u) => (
                    <li key={u.question} className="rounded-lg border border-dashed border-line p-3">
                      <p className="text-sm font-medium">{u.question}</p>
                      <p className="mt-1 text-sm text-muted">{u.why_unknown}</p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {brief && (
            <Card>
              <H2>Engineering summary</H2>
              <div className="space-y-3 text-[15px] leading-relaxed">
                <p>{brief.paragraph_1}</p>
                <p>{brief.paragraph_2}</p>
              </div>
              <p className="mt-3 text-xs text-faint">Sources: {cite(brief.cited_signal_ids)}</p>
              {brief.caveats.length > 0 && (
                <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-muted">
                  {brief.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {snap.briefStatus === "none" && computed && (
            <Card>
              <H2>Sources checked</H2>
              <CheckedList checked={computed.checked} />
            </Card>
          )}

          {computed && <WhatChanged history={history.map((h) => ({ events: (h.changeEvents as ChangeEvent[]) ?? [], at: h.generatedAt }))} dropped={dropped.map((d) => ({ tech: d.tech, at: d.lastSeen }))} />}

          {computed && <Evidence c={computed} company={company} />}

          {computed && computed.contradictions.length > 0 && (
            <Card>
              <H2>Contradictions</H2>
              {computed.contradictions.map((x) => (
                <p key={x.note} className="text-sm">
                  {x.note} <span className="text-xs text-faint">{cite(x.signalIds)}</span>
                </p>
              ))}
            </Card>
          )}
        </>
      )}

      <SourceWarnings company={company} />

      <Card>
        <H2>Refresh</H2>
        <RefreshButton companyId={company.id} />
        <RunList runs={runs} />
      </Card>

      {computed && snap?.briefStatus !== "none" && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">What was checked on the last refresh</summary>
          <div className="mt-2">
            <CheckedList checked={computed.checked} />
          </div>
        </details>
      )}
      <RemoveButton companyId={company.id} />
    </article>
  );
}

function BriefStatusNote({ status }: { status: string; hasBrief: boolean }) {
  if (status === "none")
    return (
      <p className="text-base">
        Not enough public engineering signal for this company. <span className="text-muted">The sources that were checked are listed below.</span>
      </p>
    );
  if (status === "pending") return <p className="text-base text-muted">Summary pending, will retry on next refresh. The collected signals are shown below.</p>;
  if (status === "failed") return <p className="text-base text-muted">The written brief did not pass validation twice, so it is not shown. The collected signals and computed fields are below.</p>;
  return <p className="text-base text-muted">Nothing in the evidence connects clearly to the product, so there is no opener this time.</p>;
}

function Citations({ ids, byId }: { ids: number[]; byId: Map<number, SigRow> }) {
  const items = [...new Set(ids)].map((id) => byId.get(id)).filter((s): s is SigRow => Boolean(s));
  if (!items.length) return <span>no linked evidence</span>;
  return (
    <span className="inline">
      {items.slice(0, 6).map((s, i) => (
        <span key={s.id}>
          {i > 0 && " · "}
          <Ext href={s.evidenceUrl}>
            {SOURCE_LABEL[s.source] ?? s.source}: {label(s)}
          </Ext>
        </span>
      ))}
      {items.length > 6 && ` +${items.length - 6} more`}
    </span>
  );
}

function label(s: SigRow): string {
  const d = s.detail as Record<string, unknown>;
  if (s.kind === "activity") return "repo activity";
  if (s.kind === "job_count") return `${d.engineering} engineering roles`;
  if (s.kind === "language") return `${s.name} ${d.pct}%`;
  if (s.kind === "tech" && s.source === "jobs") return `${s.name} in "${String(d.job_title ?? "").slice(0, 40)}"`;
  if (s.kind === "initiative") return `${s.name}`;
  const t = s.name.length > 48 ? s.name.slice(0, 46) + "…" : s.name;
  return t;
}

function WhatChanged({ history, dropped }: { history: { events: ChangeEvent[]; at: Date }[]; dropped: { tech: string; at: Date }[] }) {
  const seen = new Set<string>();
  const items: (ChangeEvent & { at: Date })[] = [];
  for (const h of history)
    for (const e of h.events) {
      if (seen.has(e.title)) continue;
      seen.add(e.title);
      items.push({ ...e, at: h.at });
    }
  const top = items.slice(0, 10);
  return (
    <Card>
      <H2>What changed</H2>
      {top.length || dropped.length ? (
        <ol className="relative space-y-3 border-l border-line pl-4">
          {top.map((e) => (
            <li key={e.title + e.at.toISOString()} className="text-sm">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-muted" aria-hidden />
              <p className="text-xs text-faint">{fmtDate(e.type === "new_blog_post" || e.type === "new_hn_story" || e.type === "new_initiative" ? e.date : e.at)}</p>
              <p>
                {e.type === "new_tech" && <Badge tone="good">new</Badge>} {e.type === "dropped_tech" && <Badge tone="bad">dropped</Badge>}{" "}
                {e.type === "competitor_appeared" && <Badge tone="warn">competitor</Badge>} {e.evidenceUrl ? <Ext href={e.evidenceUrl}>{e.title}</Ext> : e.title}
              </p>
            </li>
          ))}
          {dropped
            .filter((d) => !seen.has(`${d.tech} no longer seen in two consecutive refreshes`))
            .map((d) => (
              <li key={d.tech} className="text-sm">
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-muted" aria-hidden />
                <p className="text-xs text-faint">last seen {fmtDate(d.at)}</p>
                <p>
                  <Badge tone="bad">dropped</Badge> {d.tech}
                </p>
              </li>
            ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">No changes since the first refresh. Changes appear here after the next refresh finds something new.</p>
      )}
    </Card>
  );
}

function Chips({ items }: { items: TechSummary[] }) {
  if (!items.length) return <p className="text-sm text-faint">None seen</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <li key={t.name}>
          <a
            href={t.evidenceUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink no-underline hover:border-accent"
            title={`${t.confidence} confidence · ${t.sources.map((s) => SOURCE_LABEL[s]).join(", ")}${t.jobPosts ? ` · ${t.jobPosts} job posts` : ""}${t.requirementLevel === "nice_to_have" ? " · nice to have" : ""}`}
          >
            {t.name}
            <Confidence level={t.confidence} />
            {t.status === "new" && <span className="text-[10px] font-semibold uppercase text-good">new</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

const LANG_SHADES = ["bg-accent", "bg-muted", "bg-faint", "bg-line", "bg-surface-2"];

function Evidence({ c, company }: { c: Computed; company: typeof schema.watchlist.$inferSelect }) {
  const cat = (k: string) => c.techs.filter((t) => t.category === k);
  const topLangs = c.languages.slice(0, 5);
  const other = Math.max(0, 100 - topLangs.reduce((a, l) => a + l.pct, 0));
  return (
    <section aria-labelledby="evidence" className="space-y-4">
      <h2 id="evidence" className="pt-2 text-lg font-semibold tracking-tight">
        Evidence
      </h2>

      <Card>
        <H2 right={c.githubOrg ? <Ext href={`https://github.com/${c.githubOrg}`} className="text-xs">github.com/{c.githubOrg}</Ext> : null}>Languages in recent public code</H2>
        {topLangs.length ? (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={topLangs.map((l) => `${l.name} ${l.pct}%`).join(", ")}>
              {topLangs.map((l, i) => (
                <div key={l.name} className={cx(LANG_SHADES[i], i > 0 && "border-l border-surface")} style={{ width: `${l.pct}%` }} />
              ))}
              {other > 0 && <div className="bg-surface-2" style={{ width: `${other}%` }} />}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {topLangs.map((l, i) => (
                <li key={l.name} className="inline-flex items-center gap-1.5">
                  <span className={cx("inline-block h-2 w-2 rounded-full border border-line", LANG_SHADES[i])} aria-hidden />
                  {l.name} <span className="font-mono">{l.pct}%</span>
                </li>
              ))}
            </ul>
            {c.sdkHeavy && <p className="mt-2 text-xs text-warn">Most recently pushed repos look like SDKs or client libraries, so these languages may reflect what customers use rather than the internal stack.</p>}
            {c.activity.pushed30 != null && (
              <p className="mt-2 text-xs text-muted">
                {c.activity.pushed30} repos pushed in 30 days · {c.activity.pushed90} in 90 days · {c.activity.created90} created in 90 days · {c.activity.totalRepos} public repos
              </p>
            )}
          </>
        ) : (
          <EmptySource source="github" c={c} />
        )}
        {c.jobLanguages.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Job posts ask for: {c.jobLanguages.slice(0, 6).map((l) => `${l.name} (${l.posts})`).join(", ")}
          </p>
        )}
      </Card>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <H2>CI</H2>
            <Chips items={cat("ci")} />
          </div>
          <div>
            <H2>Infrastructure</H2>
            <Chips items={cat("infra")} />
          </div>
          <div>
            <H2>Cloud</H2>
            <Chips items={cat("cloud")} />
          </div>
          <div>
            <H2>Test frameworks</H2>
            <Chips items={cat("test_framework")} />
          </div>
          <div>
            <H2>Data and observability</H2>
            <Chips items={[...cat("data"), ...cat("observability")]} />
          </div>
          <div>
            <H2>Frameworks</H2>
            <Chips items={cat("framework")} />
          </div>
        </div>
        <p className="mt-4 text-[11px] text-faint">
          Markers: <Confidence level="high" /> high (2+ sources or 3+ recent job posts) · <Confidence level="medium" /> medium · <Confidence level="low" /> low. Each chip links to its source.
        </p>
      </Card>

      <Card>
        <H2 right={c.jobBoard ? <Ext href={c.jobBoard} className="text-xs">job board</Ext> : null}>Initiatives in job posts</H2>
        {c.activity.engineeringJobs != null && <p className="mb-2 text-xs text-muted">{c.activity.engineeringJobs} open engineering roles</p>}
        {c.initiatives.length ? (
          <ul className="space-y-3">
            {c.initiatives.slice(0, 8).map((i) => (
              <li key={i.label + i.sentence} className="text-sm">
                <p className="text-xs font-medium text-faint">
                  {i.label} · <Ext href={i.evidenceUrl}>{i.jobTitle}</Ext> · {fmtDate(i.date)}
                </p>
                <blockquote className="mt-0.5 border-l-2 border-line pl-3 text-muted">{i.sentence}</blockquote>
              </li>
            ))}
          </ul>
        ) : c.activity.engineeringJobs == null ? (
          <EmptySource source="jobs" c={c} />
        ) : (
          <p className="text-sm text-muted">No migration, platform, CI reliability, build time or test infrastructure language found in current engineering posts.</p>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <H2>Recent blog posts</H2>
          {c.blogPosts.length ? (
            <ul className="space-y-2 text-sm">
              {c.blogPosts.slice(0, 5).map((b) => (
                <li key={b.url ?? b.title}>
                  <Ext href={b.url}>{b.title}</Ext>
                  <p className="text-xs text-faint">
                    {fmtDate(b.date)}
                    {b.topic && ` · ${b.topic}`}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptySource source="blog" c={c} />
          )}
        </Card>
        <Card>
          <H2>Hacker News</H2>
          {c.hnStories.length ? (
            <ul className="space-y-2 text-sm">
              {c.hnStories.slice(0, 5).map((h) => (
                <li key={h.url ?? h.title}>
                  <Ext href={h.url}>{h.title}</Ext>
                  <p className="text-xs text-faint">
                    {fmtDate(h.date)} · {h.points} points · {h.comments} comments
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No stories linking to {company.domain} in the last 12 months.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <H2>Public-facing hosting</H2>
          {c.hosting.length ? (
            <ul className="space-y-1 text-sm">
              {c.hosting.map((h) => (
                <li key={h.name}>
                  {h.name} <span className="block text-xs text-faint">{h.evidence}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No known CDN or host pattern in DNS or response headers.</p>
          )}
          <p className="mt-2 text-[11px] text-faint">Describes the public website only, not where the backend runs.</p>
        </Card>
        <Card>
          <H2>Competitors and adjacent tools</H2>
          {c.competitors.length ? (
            <ul className="space-y-1 text-sm">
              {c.competitors.map((x) => (
                <li key={x.name}>
                  <span className="text-warn">{x.name}</span> <span className="text-xs text-faint">matched </span>
                  <Ext href={x.evidenceUrl} className="font-mono text-xs">
                    {x.match}
                  </Ext>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None detected in recent repos' manifests and workflows.</p>
          )}
        </Card>
      </div>
    </section>
  );
}

function EmptySource({ source, c }: { source: "github" | "jobs" | "blog"; c: Computed }) {
  const msg = { github: "No public GitHub found.", jobs: "No public job board found.", blog: "No recent blog posts found." }[source];
  const checked = c.checked?.[source] ?? [];
  if (!checked.length)
    return <p className="text-sm text-muted">This source could not be read on the last refresh (see run history below). It will be retried on the next refresh.</p>;
  return (
    <div className="text-sm text-muted">
      <p>{msg} Here&apos;s what we checked:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-faint">
        {checked.slice(0, 10).map((x) => (
          <li key={x} className="break-all">
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckedList({ checked }: { checked: Record<string, string[]> }) {
  return (
    <dl className="space-y-2 text-sm">
      {Object.entries(checked ?? {}).map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-faint">{SOURCE_LABEL[k] ?? k}</dt>
          <dd className="text-muted">
            <ul className="list-disc pl-5 text-xs">
              {v.map((x) => (
                <li key={x} className="break-all">
                  {x}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SourceWarnings({ company }: { company: typeof schema.watchlist.$inferSelect }) {
  const items: ReactNode[] = [];
  if (company.githubOrg && !company.githubOrgVerified)
    items.push(<SourceControl key="gh" companyId={company.id} field="github" label="GitHub org" value={company.githubOrg} hint="Enter the GitHub org login (e.g. acme-inc)." />);
  if (company.atsProvider && company.atsProvider !== "none" && !company.atsVerified)
    items.push(
      <SourceControl
        key="ats"
        companyId={company.id}
        field="ats"
        label="Job board"
        value={`${company.atsProvider}/${company.atsSlug}`}
        hint={`Use provider/slug (greenhouse, lever or ashby), or none. Current board: ${boardUrl(company.atsProvider, company.atsSlug ?? "")}`}
      />,
    );
  if (company.blogFeedUrl && company.blogFeedUrl !== "none" && !company.blogVerified)
    items.push(<SourceControl key="blog" companyId={company.id} field="blog" label="Blog feed" value={company.blogFeedUrl} hint="Enter the full RSS or Atom URL, or none." />);
  if (!items.length) return null;
  return (
    <Card className="border-warn/40">
      <H2>Unverified sources</H2>
      <p className="mb-3 text-sm text-muted">These were matched automatically. Confirm them, or correct them so the next refresh reads the right company.</p>
      <div className="space-y-4">{items}</div>
    </Card>
  );
}

function RunList({ runs }: { runs: (typeof schema.refreshRuns.$inferSelect)[] }) {
  if (!runs.length) return null;
  return (
    <ul className="mt-4 space-y-1 text-xs text-muted">
      {runs.map((r) => (
        <li key={r.id}>
          {fmtDate(r.startedAt)} {r.startedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST · {r.trigger.replace("_", " ")} ·{" "}
          <span className={r.status === "failed" ? "text-bad" : r.status === "partial" ? "text-warn" : ""}>{r.status.replace("_", " ")}</span>
          {Object.keys(r.collectorErrors ?? {}).length > 0 && <span className="text-faint"> ({Object.keys(r.collectorErrors).join(", ")} issues)</span>}
        </li>
      ))}
    </ul>
  );
}
