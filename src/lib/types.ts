export type Source = "github" | "jobs" | "blog" | "hn" | "talks" | "hosting";
export type Category =
  | "language"
  | "framework"
  | "cloud"
  | "infra"
  | "ci"
  | "test_framework"
  | "data"
  | "observability"
  | "pattern";
export type Confidence = "high" | "medium" | "low";
export type RequirementLevel = "requirement" | "nice_to_have";

export interface DictEntry {
  canonical_name: string;
  category: Category;
  aliases: string[];
  detection_files: string[];
  dependency_names: string[];
  verify: boolean;
}

export interface Competitor {
  name: string;
  detection: string[];
  verify: boolean;
}

export interface ProductProfile {
  product_name: string;
  one_line_pitch: string;
  problem_it_solves: string;
  ideal_customer_signals: string[];
  target_languages: string[];
  target_ci_systems: string[];
  target_patterns: string[];
  competitors_and_adjacent: Competitor[];
  proof_points: string[];
}

/** A fact collected deterministically in code. */
export interface Signal {
  id?: number;
  source: Source;
  kind: string;
  name: string;
  detail: Record<string, unknown>;
  requirementLevel?: RequirementLevel | null;
  confidence?: Confidence | null;
  evidenceUrl: string | null;
  observedAt: string; // ISO
}

export interface CompanyInput {
  id: number;
  companyName: string;
  domain: string;
  githubOrg: string | null;
  githubOrgVerified: boolean;
  atsProvider: string | null;
  atsSlug: string | null;
  atsVerified: boolean;
  blogFeedUrl: string | null;
  blogVerified: boolean;
}

export type CompanyUpdates = Partial<
  Pick<
    CompanyInput,
    "githubOrg" | "githubOrgVerified" | "atsProvider" | "atsSlug" | "atsVerified" | "blogFeedUrl" | "blogVerified"
  >
>;

export interface BlogExtraction {
  topic: string;
  tech_mentions: { name: string; quote: string }[];
}

export interface KvCache {
  get(key: string): Promise<{ etag: string | null; body: unknown } | null>;
  set(key: string, etag: string | null, body: unknown): Promise<void>;
}

export interface CollectorContext {
  company: CompanyInput;
  dict: DictEntry[];
  profile: ProductProfile;
  fetch: typeof fetch;
  env: { GITHUB_TOKEN?: string };
  cache: KvCache;
  seenBlogUrls: Set<string>;
  extractBlog?: (title: string, text: string) => Promise<BlogExtraction | null>;
  now: Date;
}

export interface CollectorResult {
  signals: Signal[];
  updates?: CompanyUpdates;
  checked: string[]; // human readable list of what was looked at (for honest empty states)
  error?: string; // non-fatal: partial results were returned
}

export interface Collector {
  name: Source;
  step: string;
  timeoutMs: number;
  collect(ctx: CollectorContext): Promise<CollectorResult>;
}
