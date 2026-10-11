import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { DictEntry, KvCache, ProductProfile } from "./types";
import profileJson from "../../data/product-profile.json";
import dictJson from "../../data/tech-dictionary.json";

export async function loadProfile(): Promise<ProductProfile> {
  const db = getDb();
  const [row] = await db.select().from(schema.productProfile).orderBy(desc(schema.productProfile.id)).limit(1);
  return (row?.data as ProductProfile) ?? (profileJson as ProductProfile);
}

export async function loadDictionary(): Promise<DictEntry[]> {
  const db = getDb();
  const rows = await db.select().from(schema.techDictionary);
  if (!rows.length) return dictJson as DictEntry[];
  return rows.map((r) => ({
    canonical_name: r.canonicalName,
    category: r.category as DictEntry["category"],
    aliases: r.aliases,
    detection_files: r.detectionFiles,
    dependency_names: r.dependencyNames,
    verify: r.verify,
  }));
}

export const dbCache: KvCache = {
  async get(key) {
    const db = getDb();
    const [r] = await db.select().from(schema.httpCache).where(eq(schema.httpCache.url, key)).limit(1);
    return r ? { etag: r.etag, body: r.body } : null;
  },
  async set(key, etag, body) {
    const db = getDb();
    await db
      .insert(schema.httpCache)
      .values({ url: key, etag, body })
      .onConflictDoUpdate({ target: schema.httpCache.url, set: { etag, body, updatedAt: sql`now()` } });
  },
};

export async function logLlmCall(v: { task: string; model: string; inputTokens: number; outputTokens: number; status: string; companyId: number | null }) {
  const db = getDb();
  await db.insert(schema.llmCalls).values(v);
}

export async function latestSnapshot(companyId: number) {
  const db = getDb();
  const [s] = await db.select().from(schema.snapshots).where(eq(schema.snapshots.companyId, companyId)).orderBy(desc(schema.snapshots.generatedAt)).limit(1);
  return s ?? null;
}
