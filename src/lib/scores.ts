import type { Computed, FitReason } from "./compute";
import { fitScore } from "./compute";
import type { ProductProfile } from "./types";

export interface LiveScores {
  fit: { score: number; reasons: FitReason[] };
}

/**
 * The fit score is computed from verified sources only (unverified sources never reach the snapshot) and is
 * recomputed at read time, so changing the targeting re-ranks every account immediately.
 */
export function liveScores(computed: Computed, profile: ProductProfile, _company?: unknown, _now?: Date): LiveScores {
  return { fit: fitScore(computed, profile) };
}
