// Builds this week's digest and emails it to DIGEST_TO (same code path as the Monday cron).
// Usage: npx tsx scripts/send-digest.ts
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import { buildDigest, sendDigest } from "../src/lib/digest";

async function main() {
  const to = process.env.DIGEST_TO;
  if (!to) throw new Error("DIGEST_TO is not set");
  const d = await buildDigest();
  const status = await sendDigest(d.id, to);
  await getDb().update(schema.digests).set({ emailStatus: status }).where(eq(schema.digests.id, d.id));
  console.log(`digest ${d.id} (week of ${d.weekOf}, ${(d.rankedAccounts as unknown[]).length} accounts): ${status}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
