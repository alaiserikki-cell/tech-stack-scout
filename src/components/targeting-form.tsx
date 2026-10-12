"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductProfile } from "@/lib/types";
import { LIST_LIMITS, addToList, type KnownNames } from "@/lib/profile-validate";

type Importance = 0 | 1 | 2;
type ListKey = "target_languages" | "target_ci_systems" | "target_clouds" | "target_patterns";

export interface TargetingOptions {
  /** chips shown by default (popular choices); everything in `known` can still be added */
  languages: string[];
  ci: string[];
  clouds: string[];
  themes: string[];
  known: KnownNames;
  components: { key: string; label: string; what: string }[];
}

/** A chip list plus an "add" box with suggestions. Only names the collectors can detect are accepted. */
function ChipList({
  label,
  hint,
  defaults,
  selected,
  known,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  defaults: string[];
  selected: string[];
  known: string[];
  max: number;
  onChange: (next: string[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const options = [...defaults, ...selected.filter((s) => !defaults.includes(s))];
  const add = () => {
    const r = addToList(selected, draft, known, max);
    setError(r.error ?? null);
    if (!r.error) {
      onChange(r.list);
      setDraft("");
    }
  };
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold text-ink">{label}</legend>
      <p className="mb-2 text-xs text-faint">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((x) => x !== o) : selected.length >= max ? selected : [...selected, o])}
              className={
                "rounded-full border px-3 py-1 text-sm transition-colors " +
                (on ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line bg-surface text-muted hover:border-accent/50 hover:text-ink")
              }
            >
              {on ? "✓ " : ""}
              {o}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          list={`${id}-known`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add another…"
          aria-label={`Add to ${label}`}
          aria-invalid={Boolean(error)}
          className="w-52 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
        <datalist id={`${id}-known`}>
          {known
            .filter((k) => !selected.includes(k))
            .map((k) => (
              <option key={k} value={k} />
            ))}
        </datalist>
        <button type="button" onClick={add} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2">
          Add
        </button>
        <span className="text-xs text-faint">
          {selected.length}/{max} selected
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-bad">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Free-text list (buying signals): what Gemini should look for, in your words. */
function TextList({ items, onChange }: { items: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const r = addToList(items, draft, null, LIST_LIMITS.ideal_customer_signals);
    setError(r.error ?? null);
    if (!r.error) {
      onChange(r.list);
      setDraft("");
    }
  };
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold text-ink">Buying signals, in your words</legend>
      <p className="mb-2 text-xs text-faint">Gemini reads these when it writes each opener and summary. They don&apos;t change the fit score.</p>
      <ul className="space-y-1.5">
        {items.map((s) => (
          <li key={s} className="flex items-start justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink">
            <span className="min-w-0">{s}</span>
            <button type="button" onClick={() => onChange(items.filter((x) => x !== s))} aria-label={`Remove ${s}`} className="shrink-0 text-xs text-muted hover:text-bad">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          maxLength={200}
          placeholder="e.g. hiring SREs to fix slow CI"
          aria-label="Add a buying signal"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
        <button type="button" onClick={add} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2">
          Add
        </button>
        <span className="text-xs text-faint">
          {items.length}/{LIST_LIMITS.ideal_customer_signals}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-bad">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function TargetingForm({ profile, options }: { profile: ProductProfile; options: TargetingOptions }) {
  const router = useRouter();
  const [p, setP] = useState<ProductProfile>({ ...profile, target_clouds: profile.target_clouds ?? [], importance: profile.importance ?? {} });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setList = (key: ListKey) => (next: string[]) => {
    setP((cur) => ({ ...cur, [key]: next }));
    setStatus("idle");
  };
  const setImp = (k: string, v: Importance) => setP((cur) => ({ ...cur, importance: { ...(cur.importance ?? {}), [k]: v } }));
  const imp = (k: string): Importance => ((p.importance as Record<string, Importance> | undefined)?.[k] ?? 1) as Importance;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrors({});
    const res = await fetch("/api/settings/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus("saved");
      if (d.profile) setP(d.profile); // server-cleaned values (trimmed, canonical names)
      router.refresh();
    } else {
      setStatus("error");
      setErrors(d.errors ?? { form: d.error ?? "Could not save." });
    }
  }

  const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink";
  const err = (k: string) =>
    errors[k] ? (
      <span role="alert" className="mt-1 block text-xs text-bad">
        {errors[k]}
      </span>
    ) : null;
  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      <section className="space-y-3">
        <h3 className="font-display text-base font-semibold text-ink">1. What you sell</h3>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Product name</span>
          <input className={field} value={p.product_name} onChange={(e) => setP({ ...p, product_name: e.target.value })} maxLength={80} />
          {err("product_name")}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">One-line pitch</span>
          <input className={field} value={p.one_line_pitch} onChange={(e) => setP({ ...p, one_line_pitch: e.target.value })} maxLength={400} />
          {err("one_line_pitch")}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Problem it solves</span>
          <textarea className={field} rows={3} value={p.problem_it_solves} onChange={(e) => setP({ ...p, problem_it_solves: e.target.value })} maxLength={1500} />
          <span className="mt-1 block text-xs text-faint">Openers and briefs are written around this problem (applies on each company&apos;s next refresh).</span>
          {err("problem_it_solves")}
        </label>
      </section>

      <section className="space-y-5">
        <h3 className="font-display text-base font-semibold text-ink">2. Who you target</h3>
        <div>
          <ChipList
            label="Languages your buyers write"
            hint="Matched against the languages of their public code and job posts."
            defaults={options.languages}
            selected={p.target_languages}
            known={options.known.languages}
            max={LIST_LIMITS.target_languages}
            onChange={setList("target_languages")}
          />
          {err("target_languages")}
        </div>
        <div>
          <ChipList
            label="CI systems your product works with"
            hint="Matched against CI configured in their repositories."
            defaults={options.ci}
            selected={p.target_ci_systems}
            known={options.known.ci}
            max={LIST_LIMITS.target_ci_systems}
            onChange={setList("target_ci_systems")}
          />
          {err("target_ci_systems")}
        </div>
        <div>
          <ChipList
            label="Clouds you work best with (optional)"
            hint="Leave empty if cloud doesn't matter; the cloud factor is then ignored."
            defaults={options.clouds}
            selected={p.target_clouds ?? []}
            known={options.known.clouds}
            max={LIST_LIMITS.target_clouds}
            onChange={setList("target_clouds")}
          />
          {err("target_clouds")}
        </div>
        <div>
          <ChipList
            label="Hiring themes that signal a need"
            hint="Matched in engineering job posts (for example a platform team being built)."
            defaults={options.themes}
            selected={p.target_patterns}
            known={options.known.themes}
            max={LIST_LIMITS.target_patterns}
            onChange={setList("target_patterns")}
          />
          {err("target_patterns")}
        </div>
        <div>
          <TextList items={p.ideal_customer_signals} onChange={(next) => setP((cur) => ({ ...cur, ideal_customer_signals: next }))} />
          {err("ideal_customer_signals")}
        </div>
      </section>

      <section>
        <h3 className="mb-1 font-display text-base font-semibold text-ink">3. What matters most</h3>
        <p className="mb-3 text-xs text-faint">Each factor adds to the fit score. Turn one off to ignore it, or set it high to count it double.</p>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {options.components.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{c.label}</p>
                <p className="text-xs text-faint">{c.what}</p>
              </div>
              <div role="radiogroup" aria-label={`Importance of ${c.label}`} className="flex overflow-hidden rounded-lg border border-line text-xs">
                {([0, 1, 2] as Importance[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={imp(c.key) === v}
                    onClick={() => setImp(c.key, v)}
                    className={"px-2.5 py-1.5 font-medium " + (imp(c.key) === v ? "bg-btn text-btn-fg" : "bg-surface text-muted hover:text-ink")}
                  >
                    {v === 0 ? "Off" : v === 1 ? "Normal" : "High"}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={status === "saving"} className="rounded-lg bg-btn px-4 py-2.5 text-sm font-semibold text-btn-fg shadow-sm disabled:opacity-60">
          {status === "saving" ? "Saving…" : "Save and re-rank accounts"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-accent-ink" aria-live="polite">
            Saved. Fit scores are updated everywhere. <a href="/dashboard">See the re-ranked dashboard</a>
          </span>
        )}
        {status === "error" && (
          <span role="alert" className="text-sm text-bad">
            {errors.form ?? "Fix the highlighted fields and save again."}
          </span>
        )}
      </div>
    </form>
  );
}
