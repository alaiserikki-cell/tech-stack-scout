import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { ChangeEvent, Computed } from "./compute";

export async function latestSnapshotsByCompany(companyIds?: number[]) {
  const db = getDb();
  const q = db
    .selectDistinctOn([schema.snapshots.companyId], {
      id: schema.snapshots.id,
      companyId: schema.snapshots.companyId,
      fitScore: schema.snapshots.fitScore,
      coverage: schema.snapshots.coverage,
      briefStatus: schema.snapshots.briefStatus,
      computed: schema.snapshots.computed,
      changeEvents: schema.snapshots.changeEvents,
      generatedAt: schema.snapshots.generatedAt,
    })
    .from(schema.snapshots);
  const rows = await (companyIds?.length ? q.where(inArray(schema.snapshots.companyId, companyIds)) : q).orderBy(schema.snapshots.companyId, desc(schema.snapshots.generatedAt));
  return new Map(rows.map((r) => [r.companyId, { ...r, computed: r.computed as Computed, changeEvents: (r.changeEvents as ChangeEvent[]) ?? [] }]));
}

export async function runningRuns() {
  const db = getDb();
  return db
    .select({ id: schema.refreshRuns.id, companyId: schema.refreshRuns.companyId, status: schema.refreshRuns.status, startedAt: schema.refreshRuns.startedAt })
    .from(schema.refreshRuns)
    .where(inArray(schema.refreshRuns.status, ["queued", "running"]));
}

export async function companyRuns(companyId: number, limit = 10) {
  const db = getDb();
  return db.select().from(schema.refreshRuns).where(eq(schema.refreshRuns.companyId, companyId)).orderBy(desc(schema.refreshRuns.startedAt)).limit(limit);
}

export async function recentSnapshots(companyId: number, limit = 6) {
  const db = getDb();
  return db
    .select({ id: schema.snapshots.id, changeEvents: schema.snapshots.changeEvents, generatedAt: schema.snapshots.generatedAt })
    .from(schema.snapshots)
    .where(eq(schema.snapshots.companyId, companyId))
    .orderBy(desc(schema.snapshots.generatedAt))
    .limit(limit);
}

export async function droppedTechs(companyId: number) {
  const db = getDb();
  return db
    .select()
    .from(schema.techState)
    .where(and(eq(schema.techState.companyId, companyId), eq(schema.techState.status, "dropped")));
}
