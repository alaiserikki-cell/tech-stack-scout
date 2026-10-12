import { getDb, schema } from "@/db/client";

export type ActivityType =
  | "company_added"
  | "company_reactivated"
  | "company_removed"
  | "refresh_requested"
  | "refresh_finished"
  | "source_confirmed"
  | "source_edited"
  | "opener_feedback"
  | "profile_saved"
  | "entry_verified"
  | "digest_built"
  | "digest_sent"
  | "cron_run"
  | "cleanup_run";

/** Record an action in the activity log. Never throws: logging must not break the action itself. */
export async function logActivity(
  type: ActivityType,
  summary: string,
  opts: { companyId?: number | null; actor?: "visitor" | "system" | "cron"; detail?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await getDb()
      .insert(schema.activityLog)
      .values({ type, summary: summary.slice(0, 300), companyId: opts.companyId ?? null, actor: opts.actor ?? "visitor", detail: opts.detail ?? {} });
  } catch {
    /* ignore */
  }
}
