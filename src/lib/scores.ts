import type { Computed, EvidenceScore, FitReason } from "./compute";
import { evidenceScore, fitScore } from "./compute";
import type { ProductProfile } from "./types";

export interface LiveScores {
  fit: { score: number; reasons: FitReason[] };
  evidence: EvidenceScore;
}

/**
 * Both scores use verified sources only and are recomputed at read time from the stored computed fields, so changing the targeting
 * profile in Settings re-ranks every account immediately (code only, no Gemini call).
 */
type Flags = { githubOrgVerified: boolean; atsVerified: boolean; blogVerified: boolean };

/**
 * What the scores are computed from: only verified sources. A snapshot taken while a source was unverified stores a
 * verified-only copy; once every excluded source has since been confirmed, the full fields are used again.
 */
export function scoringBasis(computed: Computed, company: Flags): Computed {
  const excluded = computed.excludedSources ?? [];
  if (!computed.verifiedOnly || excluded.length === 0) return computed;
  const ok = { github: company.githubOrgVerified, jobs: company.atsVerified, blog: company.blogVerified };
  return excluded.every((s) => ok[s]) ? computed : (computed.verifiedOnly as Computed);
}

export function liveScores(
  computed: Computed,
  profile: ProductProfile,
  company: Flags & { lastRefreshedAt: Date | null },
  now = new Date(),
): LiveScores {
  const basis = scoringBasis(computed, company);
  return {
    fit: fitScore(basis, profile),
    evidence: evidenceScore(computed, { github: company.githubOrgVerified, jobs: company.atsVerified, blog: company.blogVerified }, company.lastRefreshedAt, now, basis),
  };
}
