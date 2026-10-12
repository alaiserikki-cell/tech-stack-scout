import type { Category, DictEntry } from "./types";
import { boundaryRegex } from "./text";

/** Entries with verify:true are excluded from matching until marked verified in /settings. */
export function activeEntries(dict: DictEntry[]): DictEntry[] {
  return dict.filter((e) => !e.verify);
}

export interface TextMatch {
  entry: DictEntry;
  alias: string;
}

const regexCache = new Map<string, RegExp>();
function aliasRe(alias: string): RegExp {
  let r = regexCache.get(alias);
  if (!r) {
    r = boundaryRegex(alias);
    regexCache.set(alias, r);
  }
  return r;
}

/** Find dictionary technologies mentioned in free text, using word-boundary alias matches. */
export function matchText(text: string, dict: DictEntry[], categories?: Category[]): TextMatch[] {
  const out: TextMatch[] = [];
  const lower = text.toLowerCase();
  for (const e of activeEntries(dict)) {
    if (categories && !categories.includes(e.category)) continue;
    for (const a of e.aliases) {
      if (!lower.includes(a)) continue; // cheap prefilter
      if (aliasRe(a).test(text)) {
        out.push({ entry: e, alias: a });
        break;
      }
    }
  }
  return out;
}

export function textMentions(text: string, entry: DictEntry): boolean {
  const lower = text.toLowerCase();
  return entry.aliases.some((a) => lower.includes(a) && aliasRe(a).test(text));
}

/** Resolve a free-form name (from Gemini) to a dictionary entry by canonical name or alias. */
export function resolveName(name: string, dict: DictEntry[]): DictEntry | null {
  const n = name.trim().toLowerCase();
  for (const e of activeEntries(dict)) {
    if (e.canonical_name.toLowerCase() === n || e.aliases.includes(n)) return e;
  }
  return null;
}

function globToRegex(glob: string): RegExp {
  const re = glob
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${re}$`, "i");
}

/**
 * Match a repository path against a detection_files pattern.
 * Patterns containing "/" are anchored at the repo root; others match the basename at any depth.
 */
export function pathMatches(path: string, pattern: string): boolean {
  if (pattern.includes("/")) return globToRegex(pattern).test(path);
  const base = path.split("/").pop() ?? path;
  return globToRegex(pattern).test(base);
}

export interface FileMatch {
  entry: DictEntry;
  path: string;
}

export function matchFiles(paths: string[], dict: DictEntry[]): FileMatch[] {
  const out: FileMatch[] = [];
  for (const e of activeEntries(dict)) {
    if (!e.detection_files.length) continue;
    const hit = paths.find((p) => e.detection_files.some((pat) => pathMatches(p, pat)));
    if (hit) out.push({ entry: e, path: hit });
  }
  return out;
}

/** Dependency-name match: exact, npm scope wildcard (@aws-sdk/*), Go module prefix, Maven group prefix. */
export function depMatches(dep: string, pattern: string): boolean {
  const d = dep.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.endsWith("/*")) return d.startsWith(p.slice(0, -1));
  if (d === p) return true;
  if (p.includes("/") && d.startsWith(p + "/")) return true; // go module subpaths, @scope/pkg/sub
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(p) && (d.startsWith(p + ".") || d.startsWith(p + ":"))) return true; // maven groups
  return false;
}

export interface DepMatch {
  entry: DictEntry;
  dep: string;
}

export function matchDependencies(deps: string[], dict: DictEntry[]): DepMatch[] {
  const out: DepMatch[] = [];
  for (const e of activeEntries(dict)) {
    if (!e.dependency_names.length) continue;
    const hit = deps.find((d) => e.dependency_names.some((p) => depMatches(d, p)));
    if (hit) out.push({ entry: e, dep: hit });
  }
  return out;
}

export function byName(dict: DictEntry[]): Map<string, DictEntry> {
  return new Map(dict.map((e) => [e.canonical_name, e]));
}
