import type { Computed, FitReason, InfoScore } from "./compute";
import { fitScore, infoScore } from "./compute";
import type { ProductProfile } from "./types";

export interface LiveScores {
  fit: { score: number; reasons: FitReason[] };
  info: InfoScore;
}

/**
 * Both scores are computed from verified sources only (unverified sources never reach the snapshot) and are
 * recomputed at read time, so changing the targeting in Settings re-ranks every account immediately.
 */
export function liveScores(computed: Computed, profile: ProductProfile, company: { lastRefreshedAt: Date | null }, now = new Date()): LiveScores {
  return { fit: fitScore(computed, profile), info: infoScore(computed, company.lastRefreshedAt, now) };
}
