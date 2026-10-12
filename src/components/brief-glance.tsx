import type { Computed, TechSummary } from "@/lib/compute";
import { Ext, cx } from "./ui";

/** Key points built in code from computed fields: no AI tokens, nothing that is not in the signals. */
export interface GlancePoint {
  label: string;
  value: string;
  href?: string | null;
  tone?: "warn";
}

export function glancePoints(c: Computed): GlancePoint[] {
  const pts: GlancePoint[] = [];
  const names = (cat: string, n = 3) => c.techs.filter((t) => t.category === cat).slice(0, n).map((t) => t.name);

  const langs = c.languages.slice(0, 2).map((l) => `${l.name} ${Math.round(l.pct)}%`);
  const jobLangs = c.jobLanguages.slice(0, 2).map((l) => l.name);
  if (langs.length || jobLangs.length)
    pts.push({ label: "Builds in", value: langs.length ? `${langs.join(", ")} of public code${jobLangs.length ? `; jobs ask for ${jobLangs.join(", ")}` : ""}` : `Jobs ask for ${jobLangs.join(", ")}` });

  const ship = [...names("ci", 2), ...names("test_framework", 2)];
  if (ship.length) pts.push({ label: "Ships with", value: ship.join(", ") });

  const run = [...names("cloud", 2), ...names("infra", 3)];
  if (run.length) pts.push({ label: "Runs on", value: run.join(", ") });

  const a = c.activity;
  const momentum = [
    a.label !== "unknown" ? `${a.label[0].toUpperCase()}${a.label.slice(1)} activity` : null,
    a.engineeringJobs != null ? `${a.engineeringJobs} engineering openings` : null,
    a.pushed30 != null ? `${a.pushed30} repos pushed this month` : null,
  ].filter(Boolean);
  if (momentum.length) pts.push({ label: "Momentum", value: momentum.join(" · ") });

  const latest = [
    ...c.blogPosts.map((b) => ({ when: b.date, text: `Blog: ${b.title}`, href: b.url })),
    ...(c.talks ?? []).map((t) => ({ when: t.date, text: `Talk: ${t.title}`, href: t.url })),
    ...c.initiatives.map((i) => ({ when: i.date, text: `${i.label} (job post)`, href: i.evidenceUrl })),
  ].sort((x, y) => y.when.localeCompare(x.when))[0];
  if (latest) pts.push({ label: "Latest signal", value: latest.text, href: latest.href });

  const watch = [
    c.contradictions[0] ? `GitHub says ${c.contradictions[0].github}, jobs say ${c.contradictions[0].jobs}` : null,
    c.sdkHeavy ? "Public repos are mostly SDKs" : null,
  ].filter(Boolean);
  if (watch.length) pts.push({ label: "Watch out", value: watch.join(" · "), tone: "warn" });

  return pts;
}

export function AtAGlance({ c }: { c: Computed }) {
  const pts = glancePoints(c);
  if (!pts.length) return null;
  return (
    <section aria-labelledby="glance" className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <h2 id="glance" className="mb-4 font-display text-[15px] font-semibold tracking-tight text-ink">
        At a glance
      </h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {pts.map((p) => (
          <div key={p.label} className="min-w-0">
            <dt className={cx("text-[11px] font-semibold uppercase tracking-wide", p.tone === "warn" ? "text-warn" : "text-faint")}>{p.label}</dt>
            <dd className="mt-0.5 text-sm leading-snug text-ink">{p.href ? <Ext href={p.href}>{p.value}</Ext> : p.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const LANES: { key: string; title: string; cats: string[] }[] = [
  { key: "code", title: "Code", cats: ["language", "framework"] },
  { key: "build", title: "Build & test", cats: ["ci", "test_framework"] },
  { key: "ship", title: "Ship & run", cats: ["infra", "cloud"] },
  { key: "data", title: "Data & observe", cats: ["data", "observability"] },
];

/** Stack map: a four-lane diagram of the visible stack, drawn with plain HTML (no chart library, no tokens). */
export function StackMap({ c, productName }: { c: Computed; productName: string }) {
  const lanes = LANES.map((l) => ({ ...l, items: c.techs.filter((t) => l.cats.includes(t.category)) }));
  if (!lanes.some((l) => l.items.length)) return null;
  return (
    <section aria-labelledby="stackmap" className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="stackmap" className="font-display text-[15px] font-semibold tracking-tight text-ink">
          Stack map
        </h2>
        <span className="text-xs text-faint">tap a tool for its source · <span className="font-medium text-ink">bold</span> = seen in 2+ sources · <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" /> = new since last refresh</span>
      </div>
      <ol className="grid gap-2 md:grid-cols-4 md:gap-0">
        {lanes.map((l, i) => (
          <li key={l.key} className="flex flex-col md:flex-row md:items-stretch">
            <div className="flex-1 rounded-xl border border-line bg-surface-2/50 p-3">
              <p className="flex items-center justify-between gap-2 text-xs font-semibold text-ink">
                {l.title}
              </p>
              <Chips items={l.items} />
            </div>
            {i < lanes.length - 1 && (
              <span aria-hidden className="grid place-items-center py-0.5 text-faint md:px-1.5 md:py-0">
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Chips({ items }: { items: TechSummary[] }) {
  if (!items.length) return <p className="mt-2 text-xs text-faint">Nothing visible</p>;
  const shown = items.slice(0, 5);
  const rest = items.slice(5);
  return (
    <div className="mt-2">
      <ul className="flex flex-wrap gap-1">{shown.map((t) => <Chip key={t.name} t={t} />)}</ul>
      {rest.length > 0 && (
        <details className="group mt-1">
          <summary className="inline-block cursor-pointer list-none rounded-md px-1.5 py-0.5 text-xs font-medium text-accent-ink hover:bg-surface [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">+{rest.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="mt-1 flex flex-wrap gap-1">{rest.map((t) => <Chip key={t.name} t={t} />)}</ul>
        </details>
      )}
    </div>
  );
}

function Chip({ t }: { t: TechSummary }) {
  return (
    <li>
      <a
        href={t.evidenceUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        title={`${t.confidence} confidence${t.status === "new" ? " · new since the last refresh" : ""} · open the source`}
        className={cx("inline-block rounded-md px-1.5 py-0.5 text-xs no-underline", t.confidence === "high" ? "bg-surface font-medium text-ink shadow-sm" : "bg-surface/60 text-muted")}
      >
        {t.name}
        {t.status === "new" && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-label="new" />}
      </a>
    </li>
  );
}
