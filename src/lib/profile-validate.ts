import type { ProductProfile } from "./types";

/** Technologies the collectors can detect, per targeting list. Anything else could never affect the fit score. */
export interface KnownNames {
  languages: string[];
  ci: string[];
  clouds: string[];
  themes: string[];
}

export const LIST_LIMITS = { target_languages: 20, target_ci_systems: 15, target_clouds: 10, target_patterns: 15, ideal_customer_signals: 12 } as const;

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** Map what someone typed to the canonical name we detect ("golang" is not one; "go" -> "Go"). */
export function resolveKnown(input: string, known: string[]): string | null {
  const t = tidy(input).toLowerCase();
  if (!t) return null;
  return known.find((k) => k.toLowerCase() === t) ?? null;
}

/** Shared by the form (instant feedback) and the API (the real check): one rule set. */
export function addToList(list: string[], input: string, known: string[] | null, max: number): { list: string[]; error?: string } {
  const value = tidy(input);
  if (!value) return { list, error: "Type something first." };
  if (value.length > (known ? 40 : 200)) return { list, error: `Keep it under ${known ? 40 : 200} characters.` };
  const name = known ? resolveKnown(value, known) : value;
  if (!name) return { list, error: `We can't detect "${value}" yet, so it couldn't change any fit score. Pick one of the suggestions.` };
  if (list.some((x) => x.toLowerCase() === name.toLowerCase())) return { list, error: `"${name}" is already in the list.` };
  if (list.length >= max) return { list, error: `This list holds up to ${max}. Remove one first.` };
  if (!known && value.length < 3) return { list, error: "Write a few words, e.g. “active hiring of platform engineers”." };
  return { list: [...list, name] };
}

export type CleanResult = { ok: true; profile: ProductProfile } | { ok: false; errors: Record<string, string> };

export function cleanProfile(p: ProductProfile, known: KnownNames): CleanResult {
  const errors: Record<string, string> = {};
  const product_name = tidy(p.product_name);
  const one_line_pitch = tidy(p.one_line_pitch);
  const problem_it_solves = p.problem_it_solves.trim();
  if (product_name.length < 2) errors.product_name = "Product name needs at least 2 characters.";
  if (one_line_pitch.length < 10) errors.one_line_pitch = "Describe the product in at least 10 characters.";
  if (problem_it_solves.length < 20) errors.problem_it_solves = "Describe the problem in at least 20 characters; openers are written around it.";

  const lists: [keyof typeof LIST_LIMITS, string[], string[] | null, string][] = [
    ["target_languages", p.target_languages, known.languages, "Languages"],
    ["target_ci_systems", p.target_ci_systems, known.ci, "CI systems"],
    ["target_clouds", p.target_clouds ?? [], known.clouds, "Clouds"],
    ["target_patterns", p.target_patterns, known.themes, "Hiring themes"],
    ["ideal_customer_signals", p.ideal_customer_signals, null, "Buying signals"],
  ];
  const out: Record<string, string[]> = {};
  for (const [key, values, names, label] of lists) {
    let list: string[] = [];
    for (const v of values) {
      const r = addToList(list, v, names, LIST_LIMITS[key]);
      // duplicates are silently merged; anything else is a real problem with that entry
      if (r.error && !/already in the list/.test(r.error)) {
        errors[key] = `${label}: ${r.error}`;
        break;
      }
      list = r.list;
    }
    out[key] = list;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    profile: {
      ...p,
      product_name,
      one_line_pitch,
      problem_it_solves,
      target_languages: out.target_languages,
      target_ci_systems: out.target_ci_systems,
      target_clouds: out.target_clouds,
      target_patterns: out.target_patterns,
      ideal_customer_signals: out.ideal_customer_signals,
    },
  };
}

const NOT_CI = ["Renovate", "Dependabot", "pre-commit", "Codecov", "SonarQube"];
const NOT_CLOUD = ["AWS Lambda", "Amazon ECS", "Amazon EKS", "Google Kubernetes Engine"];

/** The detectable names per list, from the technology dictionary (entries still waiting for verification excluded). */
export function knownFromDictionary(dict: { canonical_name: string; category: string; verify?: boolean }[]): KnownNames {
  const names = (cat: string) => dict.filter((d) => d.category === cat && !d.verify).map((d) => d.canonical_name).sort((a, b) => a.localeCompare(b));
  return {
    languages: names("language"),
    ci: names("ci").filter((n) => !NOT_CI.includes(n)),
    clouds: names("cloud").filter((n) => !NOT_CLOUD.includes(n)),
    themes: names("pattern"),
  };
}
