"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FitRing, LevelPill } from "./ui";

// ---------------------------------------------------------------------------
// Passcode handling: writes return 401 until the httpOnly passcode cookie is set.
// ---------------------------------------------------------------------------
async function postJson(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export function PasscodeForm({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-wrap items-end gap-2"}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const r = await postJson("/api/auth", { passcode: v });
        setBusy(false);
        if (r.status === 200) {
          router.refresh();
          onDone?.();
        } else setErr(r.data.error ?? "Could not verify the passcode.");
      }}
    >
      <label className="flex flex-col text-xs text-muted">
        <span className={compact ? "sr-only" : "mb-1"}>Demo passcode</span>
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="three-word-passcode"
          autoComplete="off"
          className="w-56 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          required
        />
      </label>
      <button disabled={busy} className="rounded-lg bg-btn px-3 py-2 text-sm font-medium text-btn-fg disabled:opacity-60">
        {busy ? "Checking" : "Unlock"}
      </button>
      {err && (
        <p role="alert" className="w-full text-xs text-bad">
          {err}
        </p>
      )}
    </form>
  );
}

function useGuarded() {
  const [needPass, setNeedPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<null | (() => Promise<void>)>(null);
  const run = useCallback(async (fn: () => Promise<{ status: number; data: any }>, onOk: (d: any) => void) => {
    setError(null);
    const exec = async () => {
      const r = await fn();
      if (r.status === 401) {
        pending.current = exec;
        setNeedPass(true);
        return;
      }
      if (r.status >= 400) setError(r.data.error ?? "Something went wrong.");
      else onOk(r.data);
    };
    await exec();
  }, []);
  const gate = needPass ? (
    <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
      <p className="mb-2 text-sm text-muted">Enter the demo passcode to make changes.</p>
      <PasscodeForm
        compact
        onDone={() => {
          setNeedPass(false);
          pending.current?.();
        }}
      />
    </div>
  ) : null;
  const err = error ? (
    <p role="alert" className="mt-2 text-sm text-bad">
      {error}
    </p>
  ) : null;
  return { run, gate, err };
}

// ---------------------------------------------------------------------------
// Live refresh progress
// ---------------------------------------------------------------------------
const STEPS = ["Finding sources", "Reading GitHub", "Reading job posts", "Reading blog", "Writing brief"];

export function RunProgress({ runId, onFinish }: { runId: number; onFinish?: (status: string) => void }) {
  const [run, setRun] = useState<{ status: string; step: string | null; errors: Record<string, string> } | null>(null);
  const router = useRouter();
  const finishRef = useRef(onFinish);
  useEffect(() => {
    finishRef.current = onFinish;
  });
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" }).catch(() => null);
      const d = res && res.ok ? await res.json() : null;
      if (stop) return;
      if (d) setRun(d);
      if (d && !["queued", "running"].includes(d.status)) {
        router.refresh();
        finishRef.current?.(d.status);
        return;
      }
      timer = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [runId, router]);

  const idx = run ? STEPS.indexOf(run.step ?? "") : -1;
  const done = run && !["queued", "running"].includes(run.status);
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent-soft/40 p-4" aria-live="polite">
      <p className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-ink">
        {!done && <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />}
        {done ? `Refresh ${run!.status.replaceAll("_", " ")}` : run?.status === "queued" ? "Queued" : "Refreshing"}
      </p>
      <ol className="grid gap-2 text-sm sm:grid-cols-5">
        {STEPS.map((s, i) => {
          const state = done ? "done" : i < idx ? "done" : i === idx ? "now" : "todo";
          return (
            <li key={s} className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1.5">
              <span
                aria-hidden
                className={
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold " +
                  (state === "done" ? "bg-accent text-accent-fg" : state === "now" ? "animate-pulse bg-btn text-btn-fg" : "border border-line bg-surface text-faint")
                }
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className={state === "now" ? "font-semibold text-ink" : state === "done" ? "text-muted" : "text-faint"}>{s}</span>
              {state === "now" && <span className="sr-only">(in progress)</span>}
            </li>
          );
        })}
      </ol>
      {done && run && Object.keys(run.errors ?? {}).length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-warn">
          {Object.entries(run.errors).map(([k, v]) => (
            <li key={k}>
              {k}: {v}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RefreshButton({ companyId, activeRunId }: { companyId: number; activeRunId?: number | null }) {
  const [runId, setRunId] = useState<number | null>(activeRunId ?? null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { run, gate, err } = useGuarded();
  return (
    <div>
      <button
        disabled={busy || runId != null}
        onClick={async () => {
          setBusy(true);
          await run(
            () => postJson(`/api/companies/${companyId}/refresh`),
            (d) => {
              setRunId(d.runId);
              if (d.cached) setNote(d.message);
            },
          );
          setBusy(false);
        }}
        className="rounded-lg bg-btn px-4 py-2.5 text-sm font-semibold text-btn-fg shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Starting" : "Refresh now"}
      </button>
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
      {gate}
      {err}
      {runId != null && (
        <div className="mt-3">
          <RunProgress runId={runId} onFinish={() => setTimeout(() => setRunId(null), 4000)} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / remove company
// ---------------------------------------------------------------------------
export function AddCompanyForm({ hero, autoFocus, onAdded }: { hero?: boolean; autoFocus?: boolean; onAdded?: () => void }) {
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { run, gate, err } = useGuarded();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await run(
      () => postJson("/api/companies", { domain, name }),
      (d) => {
        setDomain("");
        router.push(`/company/${d.id}${d.runId ? `?run=${d.runId}` : ""}`);
        onAdded?.(); // close after navigation has been scheduled
      },
    );
    setBusy(false);
  };
  if (hero)
    return (
      <div>
        <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-card">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Company domain</span>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Company domain, e.g. sentry.io"
              autoFocus={autoFocus}
              inputMode="url"
              autoCapitalize="none"
              required
              className="w-full bg-transparent px-3 py-2 text-[15px] text-ink placeholder:text-faint focus:outline-none"
            />
          </label>
          <button disabled={busy} className="shrink-0 rounded-xl bg-btn px-4 py-2.5 text-sm font-semibold text-btn-fg shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50">
            {busy ? "Adding…" : "Build brief"}
          </button>
        </form>
        {gate}
        {err}
      </div>
    );
  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await run(
            () => postJson("/api/companies", { domain, name }),
            (d) => router.push(`/company/${d.id}${d.runId ? `?run=${d.runId}` : ""}`),
          );
          setBusy(false);
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col text-xs text-muted sm:flex-none">
          <span className="mb-1">Company domain</span>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
            inputMode="url"
            autoCapitalize="none"
            required
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink sm:w-56"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col text-xs text-muted sm:flex-none">
          <span className="mb-1">Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Example Inc" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink sm:w-44" />
        </label>
        <button disabled={busy} className="rounded-lg bg-btn px-4 py-2 text-sm font-medium text-btn-fg disabled:opacity-60">
          {busy ? "Adding" : "Add company"}
        </button>
      </form>
      {gate}
      {err}
    </div>
  );
}

export function RemoveButton({ companyId }: { companyId: number }) {
  const [confirm, setConfirm] = useState(false);
  const router = useRouter();
  const { run, gate, err } = useGuarded();
  return (
    <div>
      {confirm ? (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          Remove from watchlist?
          <button
            className="rounded-lg border border-bad/50 px-2 py-1 text-bad"
            onClick={() => run(() => postJson(`/api/companies/${companyId}`, undefined, "DELETE"), () => router.push("/"))}
          >
            Remove
          </button>
          <button className="rounded-lg border border-line px-2 py-1" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button className="text-sm text-muted underline" onClick={() => setConfirm(true)}>
          Remove from watchlist
        </button>
      )}
      {gate}
      {err}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opener + feedback
// ---------------------------------------------------------------------------
/** Clipboard API first; falls back to a hidden textarea + execCommand for browsers that deny clipboard access. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function OpenerActions({ snapshotId, opener }: { snapshotId: number; opener: string }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [mode, setMode] = useState<"idle" | "editing">("idle");
  const [text, setText] = useState(opener);
  const [saved, setSaved] = useState<string | null>(null);
  const { run, gate, err } = useGuarded();
  const send = (status: string, editedText?: string) =>
    run(
      () => postJson("/api/feedback", { snapshotId, status, editedText }),
      () => {
        setSaved(status);
        setMode("idle");
      },
    );
  const LABEL: Record<string, string> = { used: "used as written", edited: "used with your edits", rejected: "not used" };
  return (
    <div>
      <button
        className="rounded-lg bg-btn px-4 py-2 text-sm font-semibold text-btn-fg shadow-sm"
        onClick={async () => {
          setCopied((await copyText(opener)) ? "ok" : "failed");
          setTimeout(() => setCopied(null), 2500);
        }}
      >
        {copied === "ok" ? "Copied" : "Copy opener"}
      </button>
      <div className="mt-4 rounded-xl border border-line bg-surface-2/50 p-3">
        <p className="text-xs font-semibold text-ink">After the call: how did this opener go?</p>
        <p className="mb-2.5 text-xs text-faint">Your answer is logged in Activity, so you can see which openers actually get used.</p>
        <div className="flex flex-wrap gap-2">
          <button className={"rounded-lg border px-3 py-1.5 text-sm transition-colors " + (saved === "used" ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line hover:bg-surface-2")} onClick={() => send("used")} title="You said it as written">
            ✓ Used as written
          </button>
          <button className={"rounded-lg border px-3 py-1.5 text-sm transition-colors " + (saved === "edited" ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line hover:bg-surface-2")} onClick={() => setMode(mode === "editing" ? "idle" : "editing")} aria-expanded={mode === "editing"} title="You changed the wording; paste what you said">
            ✎ Used with edits
          </button>
          <button className={"rounded-lg border px-3 py-1.5 text-sm transition-colors " + (saved === "rejected" ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line hover:bg-surface-2")} onClick={() => send("rejected")} title="You did not use it">
            ✕ Didn&apos;t use it
          </button>
        </div>
      </div>
      {mode === "editing" && (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            send("edited", text);
          }}
        >
          <label className="mb-1 block text-xs text-muted" htmlFor="edited-opener">
            What you actually said (so better openers can be written next time)
          </label>
          <textarea id="edited-opener" value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-lg border border-line bg-surface p-2 text-sm" />
          <button className="mt-2 rounded-lg bg-btn px-3 py-1.5 text-sm font-medium text-btn-fg">Save what I said</button>
        </form>
      )}
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {copied === "failed" ? "Your browser blocked copying. Select the opener text above and copy it manually." : saved ? `Saved: opener ${LABEL[saved] ?? saved}.` : ""}
      </p>
      {gate}
      {err}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unverified source confirm / edit
// ---------------------------------------------------------------------------
export function SourceControl({ companyId, field, label, value, hint }: { companyId: number; field: "github" | "ats" | "blog"; label: string; value: string; hint: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();
  const { run, gate, err } = useGuarded();
  const submit = (action: "confirm" | "edit") =>
    run(
      () => postJson(`/api/companies/${companyId}/sources`, { field, action, value: v }),
      () => {
        setDone(action === "confirm" ? "Confirmed." : "Saved. Refresh to re-collect.");
        setEditing(false);
        router.refresh();
      },
    );
  return (
    <div className="text-sm">
      <p>
        <span className="font-medium">{label}</span> <span className="text-muted">was found automatically: </span>
        <code className="break-all font-mono text-xs">{value}</code>
      </p>
      {!done && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="rounded-lg border border-line px-2.5 py-1 hover:bg-surface-2" onClick={() => submit("confirm")}>
            Confirm
          </button>
          <button className="rounded-lg border border-line px-2.5 py-1 hover:bg-surface-2" onClick={() => setEditing(!editing)} aria-expanded={editing}>
            Edit
          </button>
        </div>
      )}
      {editing && (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit("edit");
          }}
        >
          <input aria-label={`New ${label}`} value={v} onChange={(e) => setV(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 font-mono text-xs" />
          <button className="rounded-lg bg-btn px-2.5 py-1 text-btn-fg">Save</button>
          <p className="w-full text-xs text-muted">{hint}</p>
        </form>
      )}
      {done && <p className="mt-1 text-xs text-muted">{done}</p>}
      {gate}
      {err}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watchlist table (sortable)
// ---------------------------------------------------------------------------
export interface WatchRow {
  id: number;
  name: string;
  domain: string;
  fit: number | null;
  fitReasons: { reason: string; points: number }[];
  evidence: number | null;
  evidenceLabel: string | null;
  techs: string[];
  activity: string;
  languages: string[];
  languagesFrom: "code" | "jobs" | null;
  competitor: string | null;
  lastRefreshed: string | null;
  lastRefreshedLabel: string;
  stale: boolean;
  coverage: string;
  changes: number;
  briefStatus: string | null;
  running: boolean;
}

type SortKey = "name" | "fit" | "evidence" | "activity" | "lastRefreshed" | "changes" | "coverage";
const ACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
const COV_RANK: Record<string, number> = { rich: 2, thin: 1, none: 0 };

function sortValue(r: WatchRow, k: SortKey): string | number {
  if (k === "name") return r.name.toLowerCase();
  if (k === "fit") return r.fit ?? -1;
  if (k === "evidence") return r.evidence ?? -1;
  if (k === "activity") return ACT_RANK[r.activity] ?? -1;
  if (k === "coverage") return COV_RANK[r.coverage] ?? -1;
  if (k === "changes") return r.changes;
  return r.lastRefreshed ?? "";
}

/** CSV of the visible rows: built in the browser, no server cost. */
function downloadCsv(rows: WatchRow[]) {
  const head = ["Company", "Domain", "Fit score", "Evidence score", "Evidence", "Activity", "Top languages", "Competitor", "Coverage", "Changes this week", "Last refreshed", "Technologies"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.name, r.domain, r.fit, r.evidence, r.evidenceLabel, r.activity, r.languages.join("; "), r.competitor, r.coverage, r.changes, r.lastRefreshed, r.techs.join("; ")].map(esc).join(","),
  );
  const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `watchlist-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function EvidencePill({ score, label }: { score: number | null; label: string | null }) {
  if (score == null) return <span className="text-faint">–</span>;
  const tone = label === "strong" ? "bg-accent-soft text-accent-ink" : label === "moderate" ? "bg-surface-2 text-ink" : "bg-warn/10 text-warn";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`} title={`Evidence ${score}/100 (${label})`}>
      <span className="font-mono tabular-nums">{score}</span>
      <span className="font-medium capitalize opacity-80">{label}</span>
    </span>
  );
}

export function WatchlistTable({ rows }: { rows: WatchRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "fit", dir: -1 });
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matchTech = (r: WatchRow) => (query ? r.techs.find((t) => t.toLowerCase().includes(query)) : undefined);
  const filtered = query ? rows.filter((r) => r.name.toLowerCase().includes(query) || r.domain.includes(query) || matchTech(r)) : rows;
  const sorted = [...filtered].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
  });
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
        <span className="sr-only">Search companies or technologies</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a company or a technology, e.g. Kubernetes"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint"
        />
      </label>
      <button onClick={() => downloadCsv(sorted)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
        Download CSV
      </button>
      {query && (
        <span className="text-xs text-faint">
          {sorted.length} of {rows.length} match
        </span>
      )}
    </div>
  );
  const th = (key: SortKey, label: string, cls = "") => (
    <th scope="col" className={`px-3 py-2.5 font-medium ${cls}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : key === "name" ? 1 : -1 })}>
        {label}
        <span aria-hidden className="text-faint">
          {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
  );
  return (
    <>
      {/* desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-card md:block">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-base font-semibold tracking-tight text-ink">Watchlist</h2>
          {toolbar}
        </div>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Watchlist companies, sortable</caption>
          <thead className="bg-surface-2/60 text-xs text-muted">
            <tr>
              {th("name", "Company", "pl-5")}
              {th("fit", "Fit")}
              {th("evidence", "Evidence")}
              {th("activity", "Activity")}
              <th scope="col" className="px-3 py-2.5 font-medium">
                Top languages
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Competitor
              </th>
              {th("lastRefreshed", "Freshness")}
              {th("coverage", "Coverage")}
              {th("changes", "Changes")}
              <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="group border-t border-line transition-colors hover:bg-accent-soft/30">
                <td className="py-3 pl-5 pr-3">
                  <Link href={`/company/${r.id}`} className="flex items-center gap-3 text-ink no-underline">
                    <Avatar name={r.name} />
                    <span className="min-w-0">
                      <span className="block font-semibold group-hover:underline">{r.name}</span>
                      <span className="block text-xs text-faint">{r.domain}</span>
                      {matchTech(r) && <span className="mt-0.5 inline-block rounded bg-accent-soft px-1.5 text-[11px] font-medium text-accent-ink">uses {matchTech(r)}</span>}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3" title={r.fitReasons.slice(0, 3).map((x) => `+${x.points} ${x.reason}`).join("\n")}>
                  {r.fit != null ? <FitRing score={r.fit} size={38} /> : <span className="text-faint">–</span>}
                </td>
                <td className="px-3 py-3">
                  <EvidencePill score={r.evidence} label={r.evidenceLabel} />
                </td>
                <td className="px-3 py-3">
                  <LevelPill level={r.activity} kind="activity" />
                </td>
                <td className="px-3 py-3">
                  <span className="flex flex-wrap gap-1">
                    {r.languages.length ? (
                      <>
                        {r.languages.map((l) => (
                          <span key={l} className="whitespace-nowrap rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{l}</span>
                        ))}
                        {r.languagesFrom === "jobs" && <span className="whitespace-nowrap px-0.5 py-0.5 text-[11px] text-faint" title="No public code; these languages come from job posts">from jobs</span>}
                      </>
                    ) : (
                      <span className="whitespace-nowrap text-xs text-faint">No public code</span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs">{r.competitor ? <span className="rounded-full bg-warn/10 px-2 py-0.5 font-medium text-warn">{r.competitor}</span> : <span className="text-faint">None seen</span>}</td>
                <td className="px-3 py-3 text-xs">
                  <span className={r.stale ? "font-medium text-bad" : "text-muted"}>{r.running ? "Refreshing…" : r.lastRefreshedLabel}</span>
                </td>
                <td className="px-3 py-3">
                  <LevelPill level={r.coverage} kind="coverage" />
                </td>
                <td className="px-3 py-3">
                  {r.changes > 0 ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                      {r.changes} new
                    </span>
                  ) : (
                    <span className="text-faint">–</span>
                  )}
                </td>
                <td className="py-3 pl-3 pr-5 text-right">
                  <RowRemove id={r.id} name={r.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* mobile cards */}
      <div className="md:hidden">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold tracking-tight text-ink">Watchlist</h2>
          <label className="flex items-center gap-2 text-xs text-muted">
            Sort
            <select
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split(":");
                setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 });
              }}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-ink"
            >
              <option value="fit:-1">Fit score</option>
            <option value="evidence:-1">Evidence score</option>
              <option value="changes:-1">Changes</option>
              <option value="activity:-1">Activity</option>
              <option value="lastRefreshed:1">Oldest refresh</option>
              <option value="name:1">Name</option>
            </select>
          </label>
        </div>
        <div className="mb-3">{toolbar}</div>
        <ul className="space-y-2.5">
          {sorted.map((r) => (
            <li key={r.id}>
              <Link href={`/company/${r.id}`} className="block rounded-2xl border border-line bg-surface p-4 text-ink no-underline shadow-card">
                <div className="flex items-center gap-3">
                  <Avatar name={r.name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold">
                      {r.name}
                      {r.changes > 0 && <span className="h-2 w-2 rounded-full bg-accent" aria-label={`${r.changes} changes`} />}
                    </p>
                    <p className="truncate text-xs text-faint">{r.domain}</p>
                  </div>
                  {r.fit != null && <FitRing score={r.fit} size={42} />}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <EvidencePill score={r.evidence} label={r.evidenceLabel} />
                  <LevelPill level={r.activity} kind="activity" />
                  <LevelPill level={r.coverage} kind="coverage" />
                  {r.languages.map((l) => (
                    <span key={l} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{l}</span>
                  ))}
                  {r.languagesFrom === "jobs" && <span className="text-[11px] text-faint">from jobs</span>}
                  {!r.languages.length && <span className="text-xs text-faint">No public code</span>}
                </div>
                <p className="mt-2 text-xs">
                  <span className={r.stale ? "font-medium text-bad" : "text-faint"}>{r.running ? "Refreshing…" : `Refreshed ${r.lastRefreshedLabel}`}</span>
                  {r.competitor && <span className="text-warn"> · {r.competitor}</span>}
                </p>
              </Link>
              <div className="-mt-1 flex justify-end px-2 pt-2">
                <RowRemove id={r.id} name={r.name} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** Remove a company straight from the watchlist (two-step confirm; history is kept). */
function RowRemove({ id, name }: { id: number; name: string }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { run, gate, err } = useGuarded();
  if (!confirm)
    return (
      <button
        onClick={() => setConfirm(true)}
        aria-label={`Remove ${name} from the watchlist`}
        className="rounded-lg px-2 py-1 text-xs font-medium text-faint transition-colors hover:bg-bad/10 hover:text-bad"
      >
        Remove
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs">
      <span className="text-muted">Remove {name}?</span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await run(
            () => postJson(`/api/companies/${id}`, undefined, "DELETE"),
            () => router.refresh(),
          );
          setBusy(false);
        }}
        className="rounded-lg bg-bad px-2 py-1 font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Removing…" : "Yes, remove"}
      </button>
      <button onClick={() => setConfirm(false)} className="rounded-lg border border-line px-2 py-1">
        Cancel
      </button>
      {gate}
      {err}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft font-display text-sm font-bold text-accent-ink">
      {name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------
export function EmailDigestForm({ digestId }: { digestId: number }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const { run, gate, err } = useGuarded();
  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setOk(false);
          await run(
            () => postJson(`/api/digests/${digestId}/send`, { email }),
            () => {
              setOk(true);
              setEmail("");
            },
          );
          setBusy(false);
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col text-xs text-muted sm:flex-none">
          <span className="mb-1">Email me this digest</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink sm:w-64" />
        </label>
        <button disabled={busy} className="rounded-lg bg-btn px-3 py-2 text-sm font-medium text-btn-fg disabled:opacity-60">
          {busy ? "Sending" : "Send"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {ok ? "Sent. Check your inbox (and spam folder)." : "Max 3 per address per day. The address is not stored or shown. The demo sender can only deliver to the project owner's inbox; the preview above shows the exact email."}
      </p>
      {gate}
      {err}
    </div>
  );
}

export function BuildDigestButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { run, gate, err } = useGuarded();
  return (
    <div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await run(
            () => postJson("/api/digests/build"),
            (d) => router.push(`/digests/${d.id}`),
          );
          setBusy(false);
        }}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
      >
        {busy ? "Building" : "Build this week's digest now"}
      </button>
      {gate}
      {err}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export function ProfileEditor({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, gate, err } = useGuarded();
  return (
    <div>
      <label htmlFor="profile-json" className="mb-1 block text-xs text-muted">
        Product profile (JSON)
      </label>
      <textarea id="profile-json" value={v} onChange={(e) => setV(e.target.value)} rows={18} spellCheck={false} className="w-full rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed" />
      <button
        className="mt-2 rounded-lg bg-btn px-3 py-2 text-sm font-medium text-btn-fg"
        onClick={async () => {
          setMsg(null);
          let parsed: unknown;
          try {
            parsed = JSON.parse(v);
          } catch {
            setMsg("That is not valid JSON.");
            return;
          }
          await run(
            () => postJson("/api/settings/profile", parsed),
            () => setMsg("Saved. New briefs will use this profile."),
          );
        }}
      >
        Save profile
      </button>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      {gate}
      {err}
    </div>
  );
}

export function VerifyButton({ type, name }: { type: "dictionary" | "competitor"; name: string }) {
  const [done, setDone] = useState(false);
  const router = useRouter();
  const { run, gate, err } = useGuarded();
  if (done) return <span className="text-xs text-good">Verified</span>;
  return (
    <span>
      <button
        className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-surface-2"
        onClick={() =>
          run(
            () => postJson("/api/settings/verify", { type, name }),
            () => {
              setDone(true);
              router.refresh();
            },
          )
        }
      >
        Mark verified
      </button>
      {gate}
      {err}
    </span>
  );
}

export function AutoRunProgress({ runId }: { runId: number }) {
  const [show, setShow] = useState(true);
  if (!show) return null;
  return <RunProgress runId={runId} onFinish={() => setTimeout(() => setShow(false), 5000)} />;
}

export function Collapsible({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm text-muted hover:text-ink">{summary}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Header "Add company": opens a dialog from any page
// ---------------------------------------------------------------------------
export function AddCompanyDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"one" | "several">("one");
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-btn px-3.5 py-2 text-sm font-semibold text-btn-fg shadow-sm transition-opacity hover:opacity-90">
        + Add company
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false); // click on backdrop closes
        }}
        aria-labelledby="add-company-title"
        className="m-auto w-[min(92vw,520px)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      >
        {/* contents stay mounted so router navigation is not cancelled when the dialog closes */}
        <div className="p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="add-company-title" className="font-display text-xl font-bold tracking-tight">
                  Add a company
                </h2>
                <p className="mt-1 text-sm text-muted">Type its website domain. The brief builds in about a minute.</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg px-2 py-1 text-lg leading-none text-faint hover:bg-surface-2 hover:text-ink">
                ×
              </button>
            </div>
            <div role="tablist" aria-label="Add one or several" className="mb-3 inline-flex rounded-lg border border-line p-0.5 text-sm">
              {(["one", "several"] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={"rounded-md px-3 py-1 font-medium " + (mode === m ? "bg-btn text-btn-fg" : "text-muted hover:text-ink")}>
                  {m === "one" ? "One company" : "Several at once"}
                </button>
              ))}
            </div>
            {mode === "one" ? <AddCompanyForm hero autoFocus onAdded={() => setOpen(false)} /> : <BulkAddForm onDone={() => setOpen(false)} />}
            <ul className="mt-4 space-y-1 text-xs text-faint">
              <li>We look for its public GitHub, job board, engineering blog, talks and hosting.</li>
              <li>To remove a company later, use Remove on its row in the watchlist.</li>
            </ul>
          </div>
      </dialog>
    </>
  );
}

/** Add several companies at once (one domain per line). Each is added like a single add; limits still apply. */
export function BulkAddForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ domain: string; ok: boolean; note: string }[]>([]);
  const domains = [...new Set(text.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean))].slice(0, 10);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setResults([]);
        const out: { domain: string; ok: boolean; note: string }[] = [];
        for (const d of domains) {
          const r = await postJson("/api/companies", { domain: d });
          out.push({ domain: d, ok: r.status === 200, note: r.status === 200 ? (r.data.existing ? "already on the watchlist" : "added, brief building") : (r.data.error ?? "failed") });
          setResults([...out]);
        }
        setBusy(false);
        router.refresh();
        if (out.every((x) => x.ok)) setTimeout(() => onDone?.(), 1200);
      }}
    >
      <label className="block text-sm">
        <span className="sr-only">Domains, one per line</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={"sentry.io\nretool.com\nzerodha.com"}
          className="w-full rounded-xl border border-line bg-surface p-3 font-mono text-sm text-ink placeholder:text-faint"
        />
      </label>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-faint">{domains.length ? `${domains.length} domain${domains.length > 1 ? "s" : ""} (max 10)` : "One per line, up to 10"}</span>
        <button disabled={busy || !domains.length} className="rounded-xl bg-btn px-4 py-2.5 text-sm font-semibold text-btn-fg shadow-sm disabled:opacity-50">
          {busy ? `Adding ${results.length + 1} of ${domains.length}…` : "Add all"}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" aria-live="polite">
          {results.map((r) => (
            <li key={r.domain} className="flex justify-between gap-3">
              <span className="font-mono text-xs text-ink">{r.domain}</span>
              <span className={r.ok ? "text-xs text-accent-ink" : "text-xs text-bad"}>{r.note}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** Browser print = free "save as PDF" for a brief. Folded sections are opened first so nothing is hidden. */
export function PrintButton() {
  return (
    <button
      onClick={() => {
        document.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
        window.print();
      }}
      className="no-print rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
    >
      Print / save as PDF
    </button>
  );
}
