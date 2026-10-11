import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={cx("rounded-xl border border-line bg-surface p-4 sm:p-5", className)}>{children}</As>;
}

export function H2({ children, right, id }: { children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-xs font-semibold uppercase tracking-wider text-faint">
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "accent"; title?: string }) {
  const tones = {
    neutral: "border-line text-muted",
    good: "border-good/40 text-good",
    warn: "border-warn/40 text-warn",
    bad: "border-bad/40 text-bad",
    accent: "border-accent/40 text-accent",
  };
  return (
    <span title={title} className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", tones[tone])}>
      {children}
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
  hosting: "DNS/HTTP",
};

export function FitScore({ score, reasons, align = "left" }: { score: number; reasons: { reason: string; points: number }[]; align?: "left" | "right" }) {
  return (
    <details className="group relative inline-block">
      <summary className="cursor-pointer list-none rounded font-mono text-sm tabular-nums [&::-webkit-details-marker]:hidden" aria-label={`Fit score ${score}. Show reasons`}>
        <span className="font-semibold text-ink">{score}</span>
        <span className="text-faint">/100</span>
      </summary>
      <div className={cx("absolute z-20 mt-1 w-72 max-w-[80vw] rounded-lg border border-line bg-surface p-3 text-left text-xs shadow-lg", align === "right" ? "right-0" : "left-0")}>
        <p className="mb-1 font-semibold text-ink">Top reasons</p>
        {reasons.length ? (
          <ul className="space-y-1 text-muted">
            {reasons.slice(0, 3).map((r) => (
              <li key={r.reason}>
                <span className="font-mono text-ink">+{r.points}</span> {r.reason}
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
