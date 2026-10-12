import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-fg shadow-sm">{children}</span>;
}

/** Display title; wrap a phrase in <Mint> for the green highlight. */
export function PageTitle({ title, sub, right, eyebrow }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow && <div className="mb-3"><Eyebrow>{eyebrow}</Eyebrow></div>}
        <h1 className="font-display text-3xl font-bold leading-[1.08] tracking-[-0.025em] text-ink sm:text-[40px]">{title}</h1>
        {sub && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-base">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Mint({ children }: { children: ReactNode }) {
  return <span className="text-accent-ink">{children}</span>;
}

export function Card({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={cx("rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6", className)}>{children}</As>;
}

export function H2({ children, right, id }: { children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-display text-[15px] font-semibold tracking-tight text-ink">
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "accent"; title?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    good: "bg-accent-soft text-accent-ink",
    warn: "bg-warn/10 text-warn",
    bad: "bg-bad/10 text-bad",
    accent: "bg-accent-soft text-accent-ink",
  };
  return (
    <span title={title} className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-4", tones[tone])}>
      {children}
    </span>
  );
}

/** Pill for activity / coverage levels. */
export function LevelPill({ level, kind }: { level: string; kind: "activity" | "coverage" }) {
  const strong = level === "high" || level === "rich";
  const mid = level === "medium" || level === "thin";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        strong ? "bg-accent-soft text-accent-ink" : mid ? "bg-surface-2 text-ink" : "bg-surface-2 text-faint",
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", strong ? "bg-accent" : mid ? "bg-muted" : "bg-faint")} aria-hidden />
      {level}
      <span className="sr-only"> {kind}</span>
    </span>
  );
}

/** Subtle three-step confidence marker. Never coloured. */
export function Confidence({ level }: { level: "high" | "medium" | "low" | null | undefined }) {
  if (!level) return null;
  const n = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-[2px] align-middle" title={`${level} confidence`} aria-label={`${level} confidence`} role="img">
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx("inline-block h-1.5 w-1.5 rounded-full", i < n ? "bg-muted" : "border border-line")} />
      ))}
    </span>
  );
}

export function Ext({ href, children, className }: { href: string | null | undefined; children: ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cx("underline decoration-line decoration-1 hover:decoration-accent", className)}>
      {children}
    </a>
  );
}

export function Dot({ tone, label }: { tone: "good" | "warn" | "bad" | "accent" | "neutral"; label: string }) {
  const c = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", accent: "bg-accent", neutral: "bg-faint" }[tone];
  return <span role="img" aria-label={label} title={label} className={cx("inline-block h-2 w-2 shrink-0 rounded-full", c)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

export function SkeletonPage({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="space-y-3 pt-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

const DAY = 86_400_000;
export function ago(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "never";
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  const s = Math.round((now.getTime() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function isStale(d: Date | string | null | undefined, now = new Date()): boolean {
  if (!d) return true;
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  return now.getTime() - t > 7 * DAY;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";
}

export const SOURCE_LABEL: Record<string, string> = {
  github: "GitHub",
  jobs: "Job posts",
  blog: "Blog",
  hn: "Hacker News",
  talks: "Talk",
  hosting: "DNS/HTTP",
};

/** Fit score as a mint ring (CSS conic-gradient, no chart library). */
export function FitRing({ score, size = 44 }: { score: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--surface-2) 0)` }}
      aria-hidden
    >
      <span className="grid place-items-center rounded-full bg-surface font-display font-bold tabular-nums text-ink" style={{ width: size - 8, height: size - 8, fontSize: size * 0.32 }}>
        {score}
      </span>
    </span>
  );
}

export function FitScore({ score, reasons, align = "left", size = 56 }: { score: number; reasons: { reason: string; points: number }[]; align?: "left" | "right"; size?: number }) {
  return (
    <details className="group relative inline-block">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full [&::-webkit-details-marker]:hidden" aria-label={`Fit score ${score} out of 100. Show reasons`}>
        <FitRing score={score} size={size} />
      </summary>
      <div className={cx("absolute z-20 mt-2 w-72 max-w-[80vw] rounded-xl border border-line bg-surface p-4 text-left text-xs shadow-card", align === "right" ? "right-0" : "left-0")}>
        <p className="mb-2 font-display text-sm font-semibold text-ink">Why {score}/100</p>
        {reasons.length ? (
          <ul className="space-y-1.5 text-muted">
            {reasons.slice(0, 3).map((r) => (
              <li key={r.reason} className="flex gap-2">
                <span className="shrink-0 rounded-full bg-accent-soft px-1.5 font-mono text-[11px] font-semibold text-accent-ink">+{r.points}</span>
                <span>{r.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No fit signals found yet.</p>
        )}
      </div>
    </details>
  );
}

/** Evidence score ring with its breakdown (each part shows points out of its maximum). */
export function EvidenceRing({ score, label, reasons, align = "right", size = 60 }: { score: number; label: string; reasons: { reason: string; points: number; max: number }[]; align?: "left" | "right"; size?: number }) {
  const color = label === "strong" ? "var(--accent)" : label === "moderate" ? "var(--muted)" : "var(--warn)";
  return (
    <details className="group relative inline-block">
      <summary className="flex cursor-pointer list-none items-center rounded-full [&::-webkit-details-marker]:hidden" aria-label={`Evidence score ${score} out of 100, ${label}. Show breakdown`}>
        <span className="relative inline-grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: `conic-gradient(${color} ${score * 3.6}deg, var(--surface-2) 0)` }} aria-hidden>
          <span className="grid place-items-center rounded-full bg-surface font-display font-bold tabular-nums text-ink" style={{ width: size - 8, height: size - 8, fontSize: size * 0.32 }}>
            {score}
          </span>
        </span>
      </summary>
      <div className={cx("absolute z-20 mt-2 w-80 max-w-[85vw] rounded-xl border border-line bg-surface p-4 text-left text-xs shadow-card", align === "right" ? "right-0" : "left-0")}>
        <p className="mb-2 font-display text-sm font-semibold text-ink">
          Evidence {score}/100 · <span className="capitalize">{label}</span>
        </p>
        <ul className="space-y-2 text-muted">
          {reasons.map((r) => (
            <li key={r.reason}>
              <div className="mb-0.5 flex justify-between gap-2">
                <span>{r.reason}</span>
                <span className="shrink-0 font-mono text-ink">
                  {r.points}/{r.max}
                </span>
              </div>
              <div className="h-1 rounded-full bg-surface-2">
                <div className="h-1 rounded-full bg-accent" style={{ width: `${(r.points / r.max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <a href="/#scores" className="mt-3 inline-block text-[11px]">
          How evidence is scored
        </a>
      </div>
    </details>
  );
}
