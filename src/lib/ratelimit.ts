import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

export const LIMITS = {
  refreshWindowMs: 10 * 60_000, // one refresh per company per 10 minutes (else cached)
  maxActiveCompanies: 40, // keeps the daily refresh inside Vercel Hobby's 300 s budget
} as const;

const DAY = 86_400_000;

function windowStart(windowMs: number): Date {
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
}

/** Increment a fixed-window counter; returns whether the call is within the limit. */
export async function hit(key: string, windowMs: number, max: number): Promise<boolean> {
  const db = getDb();
  const ws = windowStart(windowMs);
  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key, windowStart: ws, count: 1 })
    .onConflictDoUpdate({ target: [schema.rateLimits.key, schema.rateLimits.windowStart], set: { count: sql`${schema.rateLimits.count} + 1` } })
    .returning({ count: schema.rateLimits.count });
  return row.count <= max;
}

/** Read a counter without incrementing. */
export async function peek(key: string, windowMs: number): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: schema.rateLimits.count })
    .from(schema.rateLimits)
    .where(and(eq(schema.rateLimits.key, key), gte(schema.rateLimits.windowStart, windowStart(windowMs))));
  return row?.count ?? 0;
}

export const dayMs = DAY;
