"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductProfile } from "@/lib/types";

type Importance = 0 | 1 | 2;

export interface TargetingOptions {
  languages: string[];
  ci: string[];
  clouds: string[];
  themes: string[];
  components: { key: string; label: string; what: string }[];
}

function Chips({ options, selected, onToggle, label }: { options: string[]; selected: string[]; onToggle: (v: string) => void; label: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o)}
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
    </fieldset>
  );
}

export function TargetingForm({ profile, options }: { profile: ProductProfile; options: TargetingOptions }) {
  const router = useRouter();
  const [p, setP] = useState<ProductProfile>({ ...profile, target_clouds: profile.target_clouds ?? [], importance: profile.importance ?? {} });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const toggle = (key: "target_languages" | "target_ci_systems" | "target_clouds" | "target_patterns") => (v: string) =>
    setP((cur) => {
      const list = (cur[key] as string[] | undefined) ?? [];
      return { ...cur, [key]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] };
    });
  const setImp = (k: string, v: Importance) => setP((cur) => ({ ...cur, importance: { ...(cur.importance ?? {}), [k]: v } }));
  const imp = (k: string): Importance => ((p.importance as Record<string, Importance> | undefined)?.[k] ?? 1) as Importance;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    const res = await fetch("/api/settings/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus("saved");
      router.refresh();
    } else {
      setStatus("error");
      setError(d.error ?? "Could not save.");
    }
  }

  const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink";
  return (
    <form onSubmit={save} className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-display text-base font-semibold text-ink">1. What you sell</h3>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Product name</span>
          <input className={field} value={p.product_name} onChange={(e) => setP({ ...p, product_name: e.target.value })} required maxLength={80} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">One-line pitch</span>
          <input className={field} value={p.one_line_pitch} onChange={(e) => setP({ ...p, one_line_pitch: e.target.value })} required maxLength={400} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Problem it solves</span>
          <textarea className={field} rows={3} value={p.problem_it_solves} onChange={(e) => setP({ ...p, problem_it_solves: e.target.value })} required maxLength={1500} />
          <span className="mt-1 block text-xs text-faint">Openers and briefs are written around this problem (applies on each company&apos;s next refresh).</span>
        </label>
      </section>

      <section className="space-y-4">
        <h3 className="font-display text-base font-semibold text-ink">2. Who you target</h3>
        <Chips label="Languages your buyers write" options={options.languages} selected={p.target_languages} onToggle={toggle("target_languages")} />
        <Chips label="CI systems your product plugs into" options={options.ci} selected={p.target_ci_systems} onToggle={toggle("target_ci_systems")} />
        <Chips label="Clouds you work best with (optional)" options={options.clouds} selected={p.target_clouds ?? []} onToggle={toggle("target_clouds")} />
        <Chips label="Hiring themes that signal a need" options={options.themes} selected={p.target_patterns} onToggle={toggle("target_patterns")} />
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
        {error && (
          <span role="alert" className="text-sm text-bad">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
