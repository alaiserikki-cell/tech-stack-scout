import type { Computed, EvidenceScore, FitReason } from "./compute";
import { evidenceScore, fitScore } from "./compute";
import type { ProductProfile } from "./types";

export interface LiveScores {
  fit: { score: number; reasons: FitReason[] };
  evidence: EvidenceScore;
}

/**
 * Both scores are recomputed at read time from the stored computed fields, so changing the targeting
 * profile in Settings re-ranks every account immediately (code only, no Gemini call).
 */
export function liveScores(
  computed: Computed,
  profile: ProductProfile,
  company: { githubOrgVerified: boolean; atsVerified: boolean; blogVerified: boolean; lastRefreshedAt: Date | null },
  now = new Date(),
): LiveScores {
  return {
    fit: fitScore(computed, profile),
    evidence: evidenceScore(computed, { github: company.githubOrgVerified, jobs: company.atsVerified, blog: company.blogVerified }, company.lastRefreshedAt, now),
  };
}
