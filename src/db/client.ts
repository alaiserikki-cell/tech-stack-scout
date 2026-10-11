import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// One retry on transient failures (Neon compute waking from scale-to-zero).
neonConfig.fetchFunction = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const res = await fetch(input, init);
    if (res.status >= 500) throw new Error(`neon http ${res.status}`);
    return res;
  } catch {
    await new Promise((r) => setTimeout(r, 800));
    return fetch(input, init);
  }
};

type DB = ReturnType<typeof drizzle<typeof schema>>;
let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _db = drizzle(neon(url), { schema });
  return _db;
}

export { schema };
