import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Retries transient failures (Neon compute waking from scale-to-zero, a dropped connection): 3 tries over ~4 s.
neonConfig.fetchFunction = async (input: RequestInfo | URL, init?: RequestInit) => {
  const waits = [700, 2500];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.status >= 500 && attempt < waits.length) throw new Error(`neon http ${res.status}`);
      return res;
    } catch (e) {
      if (attempt >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
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
